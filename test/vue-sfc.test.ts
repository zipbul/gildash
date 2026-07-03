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
});
