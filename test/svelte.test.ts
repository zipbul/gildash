import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Gildash, createSveltePlugin } from '../src/index';

/**
 * Svelte support (facade acceptance) — proves the language-plugin architecture
 * is framework-agnostic: a .svelte file is indexed at RAW coordinates, joins the
 * import graph, and answers semantic queries (cross-file included).
 */

let root: string;

const SFC = `<script lang="ts">
export const msg: string = 'hi';
export function greet(name: string) {
  return msg + name;
}
</script>
<button>{msg} 🚀</button>
`;

async function openSvelteRepo() {
  root = mkdtempSync(join(tmpdir(), 'gildash-svelte-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'svelte-app' }));
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { strict: true, module: 'esnext', target: 'es2022' },
    include: ['src'],
  }));
  writeFileSync(join(root, 'src/Counter.svelte'), SFC);
  writeFileSync(join(root, 'src/app.ts'), `import { msg } from './Counter.svelte';\nexport const echoed = msg;\n`);
  return Gildash.open({
    projectRoot: root, watchMode: false, semantic: true,
    extensions: ['.ts', '.svelte'], plugins: [createSveltePlugin()],
  });
}

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('Svelte support (facade acceptance)', () => {
  it('should index component symbols at RAW line numbers', async () => {
    const g = await openSvelteRepo();

    const symbols = g.searchSymbols({ isExported: true });
    const msg = symbols.find((s) => s.name === 'msg' && s.filePath.endsWith('Counter.svelte'))!;
    expect(msg).toBeDefined();
    const rawLine = SFC.slice(0, SFC.indexOf('export const msg')).split('\n').length;
    expect(msg.span.start.line).toBe(rawLine);

    await g.close({ cleanup: true });
  });

  it('should resolve the import graph across the .svelte boundary', async () => {
    const g = await openSvelteRepo();

    const imports = g.searchRelations({ type: 'imports' });
    expect(imports.some((r) => r.srcFilePath.endsWith('app.ts') && r.dstFilePath?.endsWith('Counter.svelte'))).toBe(true);

    await g.close({ cleanup: true });
  });

  it('should resolve cross-file semantic references from app.ts into the component with raw positions', async () => {
    const g = await openSvelteRepo();

    const appAbs = join(root, 'src/app.ts');
    const appSource = `import { msg } from './Counter.svelte';\nexport const echoed = msg;\n`;
    const refs = g.getEnrichedReferencesAtPosition(appAbs, appSource.indexOf('msg'));

    const svelteAbs = join(root, 'src/Counter.svelte');
    const inComponent = refs.filter((r) => r.filePath === svelteAbs);
    expect(inComponent.length).toBeGreaterThan(0);
    expect(SFC.slice(inComponent[0]!.position, inComponent[0]!.position + 3)).toBe('msg');

    await g.close({ cleanup: true });
  });

  it('should index a script-block annotation at its RAW .svelte coordinate', async () => {
    root = mkdtempSync(join(tmpdir(), 'gildash-svelte-anno-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { strict: true, module: 'esnext', target: 'es2022' }, include: ['src'],
    }));
    const sfc = `<script lang="ts">\n/** @deprecated legacy store */\nexport const store = 1;\n</script>\n<p>x</p>\n`;
    writeFileSync(join(root, 'src/Store.svelte'), sfc);
    const g = await Gildash.open({
      projectRoot: root, watchMode: false, semantic: true,
      extensions: ['.ts', '.svelte'], plugins: [createSveltePlugin()],
    });

    const annotations = g.searchAnnotations({ tag: 'deprecated' }).filter((a) => a.filePath.endsWith('Store.svelte'));
    expect(annotations.length).toBe(1);
    const rawLine = sfc.slice(0, sfc.indexOf('@deprecated')).split('\n').length;
    expect(annotations[0]!.span.start.line).toBe(rawLine);

    await g.close({ cleanup: true });
  });

  it('should keep RAW positions exact for a .svelte with CRLF line endings', async () => {
    root = mkdtempSync(join(tmpdir(), 'gildash-svelte-crlf-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { strict: true, module: 'esnext', target: 'es2022' }, include: ['src'],
    }));
    const sfc = `<script lang="ts">\r\nexport const count = 0;\r\nexport const label = 'x';\r\n</script>\r\n<p>{count}</p>\r\n`;
    writeFileSync(join(root, 'src/Crlf.svelte'), sfc);
    const g = await Gildash.open({
      projectRoot: root, watchMode: false, semantic: true,
      extensions: ['.ts', '.svelte'], plugins: [createSveltePlugin()],
    });

    const label = g.getSymbolsByFile('src/Crlf.svelte').find((s) => s.name === 'label')!;
    expect(label).toBeDefined();
    // Raw line 3 (1: <script>, 2: count, 3: label) — CRLF must not shift it.
    expect(label.span.start.line).toBe(3);

    await g.close({ cleanup: true });
  });

  it('should resolve a tsconfig path-alias import of a .svelte (baseUrl + paths)', async () => {
    root = mkdtempSync(join(tmpdir(), 'gildash-svelte-alias-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        strict: true, module: 'esnext', target: 'es2022', moduleResolution: 'bundler',
        baseUrl: '.', paths: { '$lib/*': ['src/*'] },
      },
      include: ['src'],
    }));
    writeFileSync(join(root, 'src/Counter.svelte'), SFC);
    writeFileSync(join(root, 'src/app.ts'), `import { msg } from '$lib/Counter.svelte';\nexport const echoed = msg;\n`);
    const g = await Gildash.open({
      projectRoot: root, watchMode: false, semantic: true,
      extensions: ['.ts', '.svelte'], plugins: [createSveltePlugin()],
    });

    const diags = g.getSemanticDiagnostics(join(root, 'src/app.ts'));
    expect(diags.filter((d) => d.code === 2307 || d.code === 2792)).toEqual([]);

    await g.close({ cleanup: true });
  });

  // Regression: a malformed `generics` prelude produces a syntax error in the
  // virtual module, which makes the oxc indexer drop EVERY symbol of the
  // component (silent data loss). Each of these is valid Svelte 5 that a naive
  // prelude synthesizer breaks — const/variance modifiers, extends+default, and
  // whitespace-separated `extends`.
  it.each([
    ['const modifier', 'const T'],
    ['variance modifiers', 'in T, out U'],
    ['extends + default', 'T extends string = number'],
    ['tab-separated extends', `T\textends string`],
  ])('should still index component symbols when generics use %s', async (_label, generics) => {
    root = mkdtempSync(join(tmpdir(), 'gildash-svelte-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { strict: true, module: 'esnext', target: 'es2022' }, include: ['src'],
    }));
    writeFileSync(join(root, 'src/Generic.svelte'),
      `<script lang="ts" generics="${generics}">\nexport let value: T;\nexport const seen = value;\n</script>\n<p>{seen}</p>\n`);
    const g = await Gildash.open({
      projectRoot: root, watchMode: false, semantic: true,
      extensions: ['.ts', '.svelte'], plugins: [createSveltePlugin()],
    });

    const names = g.getSymbolsByFile('src/Generic.svelte').map((s) => s.name).sort();
    expect(names).toEqual(['seen', 'value']);

    await g.close({ cleanup: true });
  });
});
