import { describe, it, expect } from 'bun:test';
import { isErr } from '@zipbul/result';
import { SemanticLayer } from './index';
import { LanguagePluginRegistry } from '../lang/registry';
import { createVuePlugin } from '../lang/vue-plugin';

const TSCONFIG = '/proj/tsconfig.json';
const VALID = JSON.stringify({ compilerOptions: { strict: true, module: 'esnext', target: 'es2022' } });
const FAKE_LIB = '// lib\nexport {};\n';

function makeLayer(): SemanticLayer {
  const result = SemanticLayer.create(TSCONFIG, {
    readConfigFile: (p) => (p === TSCONFIG ? VALID : undefined),
    resolveNonTrackedFile: (p) => (p.includes('lib.') && p.endsWith('.d.ts') ? FAKE_LIB : undefined),
    registry: new LanguagePluginRegistry([createVuePlugin()]),
  });
  if (isErr(result)) throw new Error(result.data.message);
  return result;
}

describe('SemanticLayer — language plugin forwarding', () => {
  it('should forward the registry so a notified SFC lands in the program as a virtual file', () => {
    const layer = makeLayer();
    layer.notifyFileChanged('/proj/Foo.vue', `<script setup lang="ts">\nexport const msg = 'hi';\n</script>\n`);

    expect(layer.isFileInSemanticProgram('/proj/Foo.vue.__sfc__.ts')).toBe(true);
  });
});

// ── North-star pin: every public surface speaks RAW coordinates for SFCs ──

const NS_FILE = '/proj/Counter.vue';
const NS_SFC = `<template>
  <p>🚀 {{ msg }}</p>
</template>
<script lang="ts">
export const legacyShared: string = 'old';
</script>
<script setup lang="ts">
export const msg: string = 'hi';
const localCount = 1;
export const doubled = localCount + localCount;
</script>
`;

function makeNorthStarLayer(): SemanticLayer {
  const layer = makeLayer();
  layer.notifyFileChanged(NS_FILE, NS_SFC);
  layer.notifyFileChanged('/proj/consumer.ts', `import { msg } from './Counter.vue';\nexport const echoed = msg;\n`);
  return layer;
}

/** Raw offset of the first occurrence of `needle` (optionally after a marker). */
function rawOffset(needle: string, after = 0): number {
  const idx = NS_SFC.indexOf(needle, after);
  if (idx < 0) throw new Error(`fixture missing: ${needle}`);
  return idx;
}

describe('SemanticLayer — raw-coordinate surfaces for SFCs (north star)', () => {
  it('should report the raw .vue path as semantically available', () => {
    const layer = makeNorthStarLayer();
    expect(layer.isFileInSemanticProgram(NS_FILE)).toBe(true);
  });

  it('should return file bindings keyed to the RAW file with RAW declaration positions', () => {
    const layer = makeNorthStarLayer();
    const bindings = layer.getFileBindings(NS_FILE);

    expect(bindings.length).toBeGreaterThan(0);
    const local = bindings.find((b) => b.declaration.name === 'localCount')!;
    expect(local.declaration.filePath).toBe(NS_FILE);
    expect(local.declaration.position).toBe(rawOffset('localCount'));
    // Every in-file reference must carry raw path + raw offsets.
    for (const ref of local.references) {
      expect(ref.filePath).toBe(NS_FILE);
      expect(NS_SFC.slice(ref.position, ref.position + 'localCount'.length)).toBe('localCount');
    }
  });

  it('should map bindings from BOTH script blocks to raw coordinates', () => {
    const layer = makeNorthStarLayer();
    const bindings = layer.getFileBindings(NS_FILE);

    const legacy = bindings.find((b) => b.declaration.name === 'legacyShared')!;
    expect(legacy.declaration.position).toBe(rawOffset('legacyShared'));
  });

  it('should accept RAW positions for enriched reference queries', () => {
    const layer = makeNorthStarLayer();
    const refs = layer.findEnrichedReferences(NS_FILE, rawOffset('localCount'));

    expect(refs.length).toBeGreaterThanOrEqual(2);
    for (const ref of refs) {
      expect(ref.filePath).toBe(NS_FILE);
      expect(NS_SFC.slice(ref.position, ref.position + 'localCount'.length)).toBe('localCount');
    }
  });

  it('should accept a RAW position for type queries', () => {
    const layer = makeNorthStarLayer();
    const t = layer.collectTypeAt(NS_FILE, rawOffset('msg', rawOffset('script setup')));

    expect(t?.text).toBe('string');
  });

  it('should report diagnostics at RAW line numbers', () => {
    const layer = makeLayer();
    const broken = NS_SFC.replace("export const msg: string = 'hi';", "export const msg: number = 'hi';");
    layer.notifyFileChanged(NS_FILE, broken);

    const diags = layer.getDiagnostics(NS_FILE);
    expect(diags.length).toBeGreaterThan(0);
    const rawLine = broken.slice(0, broken.indexOf("export const msg")).split('\n').length;
    expect(diags[0]!.filePath).toBe(NS_FILE);
    expect(diags[0]!.line).toBe(rawLine);
  });

  it('should convert RAW line/column to a RAW offset', () => {
    const layer = makeNorthStarLayer();
    const msgRaw = rawOffset('msg', rawOffset('script setup'));
    const line = NS_SFC.slice(0, msgRaw).split('\n').length;
    const column = msgRaw - NS_SFC.lastIndexOf('\n', msgRaw - 1) - 1;

    expect(layer.lineColumnToPosition(NS_FILE, line, column)).toBe(msgRaw);
  });

  it('should resolve cross-file references INTO the SFC with raw coordinates', () => {
    const layer = makeNorthStarLayer();
    const refs = layer.findReferences('/proj/consumer.ts', 'import { msg }'.indexOf('msg'));

    const inVue = refs.filter((r) => r.filePath === NS_FILE);
    expect(inVue.length).toBeGreaterThan(0);
    for (const ref of inVue) {
      expect(NS_SFC.slice(ref.position, ref.position + 3)).toBe('msg');
    }
  });
});

describe('SemanticLayer — getStandaloneFileBindings for plugin files', () => {
  const SFC = `<template><p>{{ msg }}</p></template>
<script setup lang="ts">
const msg = 1;
const doubled = msg + msg;
</script>
`;

  it('should extract local bindings from a raw .vue source (not tag soup)', () => {
    const layer = makeLayer();
    const bindings = layer.getStandaloneFileBindings('/proj/Foo.vue', SFC);

    expect(bindings.map((b) => b.declaration.name).sort()).toContain('msg');
  });

  it('should report declaration + reference positions in RAW .vue coordinates', () => {
    const layer = makeLayer();
    const bindings = layer.getStandaloneFileBindings('/proj/Foo.vue', SFC);

    const msg = bindings.find((b) => b.declaration.name === 'msg')!;
    expect(msg.declaration.filePath).toBe('/proj/Foo.vue');
    expect(SFC.slice(msg.declaration.position, msg.declaration.position + 3)).toBe('msg');
    for (const ref of msg.references) {
      expect(SFC.slice(ref.position, ref.position + 3)).toBe('msg');
    }
  });

  it('should still resolve plain .ts content standalone (identity path unchanged)', () => {
    const layer = makeLayer();
    const bindings = layer.getStandaloneFileBindings('/proj/x.ts', `const a = 1;\nconst b = a;\n`);

    expect(bindings.some((b) => b.declaration.name === 'a')).toBe(true);
  });
});
