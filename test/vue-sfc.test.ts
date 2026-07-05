import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Gildash, createVuePlugin } from '../src/index';

/**
 * Vue SFC acceptance (PR-B north star at the facade level): a .vue file is
 * indexed with RAW coordinates, participates in the import graph, and answers
 * semantic queries — cross-file included — through the public API.
 */

let root: string;

const SFC = `<template>
  <p>🚀 {{ msg }}</p>
</template>
<script setup lang="ts">
export const msg: string = 'hi';
export function greet(name: string) {
  return msg + name;
}
</script>
`;

async function openVueRepo() {
  root = mkdtempSync(join(tmpdir(), 'gildash-vue-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'vue-app' }));
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { strict: true, module: 'esnext', target: 'es2022' },
    include: ['src'],
  }));
  writeFileSync(join(root, 'src/Counter.vue'), SFC);
  writeFileSync(join(root, 'src/app.ts'), `import { msg } from './Counter.vue';\nexport const echoed = msg;\n`);
  return Gildash.open({
    projectRoot: root,
    watchMode: false,
    semantic: true,
    extensions: ['.ts', '.vue'],
    plugins: [createVuePlugin()],
  });
}

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('Vue SFC support (facade acceptance)', () => {
  it('should index SFC symbols at RAW line numbers', async () => {
    const g = await openVueRepo();

    const symbols = g.searchSymbols({ isExported: true });
    const msg = symbols.find((s) => s.name === 'msg' && s.filePath.endsWith('Counter.vue'))!;
    expect(msg).toBeDefined();
    const rawLine = SFC.slice(0, SFC.indexOf('export const msg')).split('\n').length;
    expect(msg.span.start.line).toBe(rawLine);

    await g.close({ cleanup: true });
  });

  it('should resolve the import graph across the .vue boundary', async () => {
    const g = await openVueRepo();

    const imports = g.searchRelations({ type: 'imports' });
    expect(imports.some((r) => r.srcFilePath.endsWith('app.ts') && r.dstFilePath?.endsWith('Counter.vue'))).toBe(true);

    await g.close({ cleanup: true });
  });

  it('should answer semantic bindings for the RAW .vue path with RAW positions', async () => {
    const g = await openVueRepo();

    const vueAbs = join(root, 'src/Counter.vue');
    expect(g.isFileInSemanticProgram(vueAbs)).toBe(true);
    const bindings = g.getFileBindings(vueAbs);
    const msg = bindings.find((b) => b.declaration.name === 'msg')!;
    expect(msg.declaration.filePath).toBe(vueAbs);
    expect(SFC.slice(msg.declaration.position, msg.declaration.position + 3)).toBe('msg');

    await g.close({ cleanup: true });
  });

  it('should keep RAW positions exact across multibyte script content (byte vs UTF-16)', async () => {
    root = mkdtempSync(join(tmpdir(), 'gildash-vue-mb-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'vue-mb' }));
    writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { strict: true, module: 'esnext', target: 'es2022' }, include: ['src'],
    }));
    const mb = `<template><p>x</p></template>\n<script setup lang="ts">\nconst counter = 1;\nconst doubled = /*\u{1F680}\uD55C\uAE00*/ counter + counter;\n</script>\n`;
    writeFileSync(join(root, 'src/Mb.vue'), mb);
    const g = await Gildash.open({
      projectRoot: root, watchMode: false, semantic: true,
      extensions: ['.ts', '.vue'], plugins: [createVuePlugin()],
    });

    const vueAbs = join(root, 'src/Mb.vue');
    const counter = g.getFileBindings(vueAbs).find((b) => b.declaration.name === 'counter')!;
    for (const ref of counter.references) {
      expect(mb.slice(ref.position, ref.position + 'counter'.length)).toBe('counter');
    }

    await g.close({ cleanup: true });
  });

  it('should resolve cross-file semantic references from app.ts into the SFC', async () => {
    const g = await openVueRepo();

    const appAbs = join(root, 'src/app.ts');
    const appSource = `import { msg } from './Counter.vue';\nexport const echoed = msg;\n`;
    const refs = g.getEnrichedReferencesAtPosition(appAbs, appSource.indexOf('msg'));

    const vueAbs = join(root, 'src/Counter.vue');
    const inVue = refs.filter((r) => r.filePath === vueAbs);
    expect(inVue.length).toBeGreaterThan(0);
    expect(SFC.slice(inVue[0]!.position, inVue[0]!.position + 3)).toBe('msg');

    await g.close({ cleanup: true });
  });

  it('should resolve a tsconfig path-alias import of a .vue (baseUrl + paths)', async () => {
    root = mkdtempSync(join(tmpdir(), 'gildash-vue-alias-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        strict: true, module: 'esnext', target: 'es2022', moduleResolution: 'bundler',
        baseUrl: '.', paths: { '@/*': ['src/*'] },
      },
      include: ['src'],
    }));
    writeFileSync(join(root, 'src/Counter.vue'), SFC);
    writeFileSync(join(root, 'src/app.ts'), `import { msg } from '@/Counter.vue';\nexport const echoed = msg;\n`);
    const g = await Gildash.open({
      projectRoot: root, watchMode: false, semantic: true,
      extensions: ['.ts', '.vue'], plugins: [createVuePlugin()],
    });

    // The alias `@/Counter.vue` must resolve to the SFC's virtual module — no
    // "cannot find module" (2307/2792), same as a relative `./Counter.vue`.
    const diags = g.getSemanticDiagnostics(join(root, 'src/app.ts'));
    expect(diags.filter((d) => d.code === 2307 || d.code === 2792)).toEqual([]);

    await g.close({ cleanup: true });
  });

  it('should pick the longest-matching path pattern when several alias patterns overlap', async () => {
    root = mkdtempSync(join(tmpdir(), 'gildash-vue-longest-'));
    mkdirSync(join(root, 'src', 'components'), { recursive: true });
    writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        strict: true, module: 'esnext', target: 'es2022', moduleResolution: 'bundler', baseUrl: '.',
        // Both patterns match `@/components/Counter.vue`; only the longer one maps
        // to the real location, so longest-prefix must win.
        paths: { '@/*': ['nowhere/*'], '@/components/*': ['src/components/*'] },
      },
      include: ['src'],
    }));
    writeFileSync(join(root, 'src/components/Counter.vue'), SFC);
    writeFileSync(join(root, 'src/app.ts'), `import { msg } from '@/components/Counter.vue';\nexport const echoed = msg;\n`);
    const g = await Gildash.open({
      projectRoot: root, watchMode: false, semantic: true,
      extensions: ['.ts', '.vue'], plugins: [createVuePlugin()],
    });

    const diags = g.getSemanticDiagnostics(join(root, 'src/app.ts'));
    expect(diags.filter((d) => d.code === 2307 || d.code === 2792)).toEqual([]);

    // The import-relation graph must resolve the SAME (longest) pattern as the
    // semantic layer — not the shorter `@/*` that maps nowhere.
    const imports = g.searchRelations({ type: 'imports' });
    const rel = imports.find((r) => r.srcFilePath.endsWith('app.ts'));
    expect(rel?.dstFilePath?.endsWith('src/components/Counter.vue')).toBe(true);

    await g.close({ cleanup: true });
  });

  it('should index a script-block annotation at its RAW .vue coordinate', async () => {
    root = mkdtempSync(join(tmpdir(), 'gildash-vue-anno-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { strict: true, module: 'esnext', target: 'es2022' }, include: ['src'],
    }));
    // Annotation sits after a multibyte template, so a byte/UTF-16 or raw/virtual
    // mix-up would surface as a wrong line.
    const sfc = `<template><p>🚀 hi</p></template>\n<script setup lang="ts">\n/** @deprecated use the new API */\nexport const legacy = 1;\n</script>\n`;
    writeFileSync(join(root, 'src/Widget.vue'), sfc);
    const g = await Gildash.open({
      projectRoot: root, watchMode: false, semantic: true,
      extensions: ['.ts', '.vue'], plugins: [createVuePlugin()],
    });

    const annotations = g.searchAnnotations({ tag: 'deprecated' }).filter((a) => a.filePath.endsWith('Widget.vue'));
    expect(annotations.length).toBe(1);
    const rawLine = sfc.slice(0, sfc.indexOf('@deprecated')).split('\n').length;
    expect(annotations[0]!.span.start.line).toBe(rawLine);

    await g.close({ cleanup: true });
  });

  it('should not expose a plugin file\'s virtual parse through getParsedAst', async () => {
    const g = await openVueRepo();

    // The indexer parses a .vue's EXTRACTED script (virtual coordinates); exposing
    // that ParsedFile through getParsedAst under the raw .vue path would leak
    // virtual positions, breaking the raw-coordinate invariant every other public
    // API upholds (e.g. extractSymbols(getParsedAst('x.vue'))). Plain .ts is cached.
    expect(g.getParsedAst('src/Counter.vue')).toBeUndefined();
    expect(g.getParsedAst('src/app.ts')).toBeDefined();

    await g.close({ cleanup: true });
  });
});
