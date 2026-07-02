import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Gildash } from '../src/gildash';

/**
 * Frontend framework support (PR-A): React/JSX files are first-class —
 * indexed by default, import graph resolves extensionless `.tsx` targets,
 * JSX component usage lands as `calls` relations, and the semantic layer
 * answers on `.tsx` under the project's own `jsx` compiler option.
 * Angular (plain `.ts` + decorators) is pinned as a regression net.
 */

let root: string;

function write(rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('React/JSX first-class support', () => {
  async function openReactRepo() {
    root = mkdtempSync(join(tmpdir(), 'gildash-react-'));
    write('package.json', JSON.stringify({ name: 'react-app' }));
    write('tsconfig.json', JSON.stringify({
      compilerOptions: { jsx: 'react-jsx', target: 'es2022', module: 'esnext', strict: true },
      include: ['src'],
    }));
    write('src/button.tsx', `export function Button({ label }: { label: string }) {\n  return <button>{label}</button>;\n}\n`);
    write('src/app.tsx', `import { Button } from './button';\nexport const App = () => <Button label="go" />;\n`);
    return Gildash.open({ projectRoot: root, watchMode: false, semantic: true });
  }

  it('should index .tsx files by default and extract their symbols', async () => {
    const g = await openReactRepo();

    const names = g.searchSymbols({ isExported: true }).map((s) => s.name);
    expect(names).toContain('Button');
    expect(names).toContain('App');

    await g.close({ cleanup: true });
  });

  it('should resolve an extensionless import to its .tsx target', async () => {
    const g = await openReactRepo();

    const imports = g.searchRelations({ type: 'imports' });
    expect(imports.some((r) => r.srcFilePath.endsWith('app.tsx') && r.dstFilePath?.endsWith('button.tsx'))).toBe(true);

    await g.close({ cleanup: true });
  });

  it('should capture JSX component usage as a calls relation with jsx metadata', async () => {
    const g = await openReactRepo();

    const calls = g.searchRelations({ type: 'calls' });
    const render = calls.find((r) => r.dstSymbolName === 'Button');
    expect(render).toBeDefined();
    expect(render!.dstFilePath?.endsWith('button.tsx')).toBe(true);
    expect(JSON.parse(render!.metaJson ?? '{}')).toMatchObject({ syntax: 'jsx' });

    await g.close({ cleanup: true });
  });

  it('should answer semantic queries on .tsx files under the project jsx option', async () => {
    const g = await openReactRepo();

    const appAbs = join(root, 'src/app.tsx');
    expect(g.isFileInSemanticProgram(appAbs)).toBe(true);
    expect(g.getFileBindings(appAbs).length).toBeGreaterThan(0);

    await g.close({ cleanup: true });
  });
});

describe('Angular regression net', () => {
  it('should extract decorated components with their decorator arguments', async () => {
    root = mkdtempSync(join(tmpdir(), 'gildash-ng-'));
    write('package.json', JSON.stringify({ name: 'ng-app' }));
    write('tsconfig.json', JSON.stringify({
      compilerOptions: { experimentalDecorators: true, target: 'es2022', module: 'esnext' },
      include: ['src'],
    }));
    write('src/app.component.ts', `import { Component } from '@angular/core';\n@Component({ selector: 'app-root', templateUrl: './app.component.html' })\nexport class AppComponent {\n  title = 'ng';\n}\n`);

    const g = await Gildash.open({ projectRoot: root, watchMode: false, semantic: true });

    const cmp = g.searchSymbols({ text: 'AppComponent', exact: true });
    expect(cmp.length).toBe(1);
    const full = g.getFullSymbol('AppComponent', 'src/app.component.ts');
    expect(full?.decorators?.some((d) => d.name === 'Component')).toBe(true);
    expect(g.isFileInSemanticProgram(join(root, 'src/app.component.ts'))).toBe(true);

    await g.close({ cleanup: true });
  });
});
