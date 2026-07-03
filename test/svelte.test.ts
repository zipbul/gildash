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
});
