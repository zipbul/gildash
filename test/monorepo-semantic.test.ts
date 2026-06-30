import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Gildash } from '../src/gildash';

/**
 * Multi-tsconfig monorepo support: each file is resolved under the program of
 * its governing tsconfig, a broken config degrades only its own project, and
 * `open` never fails because one sub-project's config cannot build.
 */

const APP_FILE = 'apps/web/src/app.component.ts';
const APP_SRC = `import { Component } from '@angular/core';
@Component({ selector: 'app-root', template: '<div></div>' })
export class AppComponent {
  title = 'demo';
  greet(name: string) {
    const message = 'hi ' + name;
    return message;
  }
}
`;

const APP_TSCONFIG = JSON.stringify({
  compilerOptions: { experimentalDecorators: true, target: 'es2020', module: 'esnext' },
  include: ['src'],
});

let root: string;

function makeMonorepo(rootTsconfig: string): string {
  root = mkdtempSync(join(tmpdir(), 'gildash-mono-'));
  mkdirSync(join(root, 'packages/lib/src'), { recursive: true });
  mkdirSync(join(root, 'apps/web/src'), { recursive: true });
  writeFileSync(join(root, 'packages/lib/src/index.ts'), 'export const lib = 1;\n');
  writeFileSync(join(root, APP_FILE), APP_SRC);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'root' }));
  writeFileSync(join(root, 'packages/lib/package.json'), JSON.stringify({ name: '@x/lib' }));
  writeFileSync(join(root, 'apps/web/package.json'), JSON.stringify({ name: '@x/web' }));
  writeFileSync(join(root, 'tsconfig.json'), rootTsconfig);
  writeFileSync(join(root, 'apps/web/tsconfig.json'), APP_TSCONFIG);
  return root;
}

async function open() {
  return Gildash.open({ projectRoot: root, watchMode: false, semantic: true } as any);
}

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('monorepo multi-tsconfig semantic support', () => {
  it('should resolve bindings for a sub-app file under a solution-style root config', async () => {
    makeMonorepo(JSON.stringify({ files: [], references: [{ path: './apps/web' }, { path: './packages/lib' }] }));
    const g = await open();

    const appAbs = join(root, APP_FILE);
    expect(g.isFileInSemanticProgram(appAbs)).toBe(true);
    expect(g.getFileBindings(appAbs).length).toBeGreaterThan(0);

    await g.close();
  });

  it('should resolve bindings for a sub-app file even when the root config only includes the lib', async () => {
    makeMonorepo(JSON.stringify({ compilerOptions: { target: 'es2020' }, include: ['packages/lib/src'] }));
    const g = await open();

    expect(g.getFileBindings(join(root, APP_FILE)).length).toBeGreaterThan(0);

    await g.close();
  });

  it('should report a file as unavailable when it is under a config but not in the program', async () => {
    // A path under a healthy config's directory that was never indexed/fed is not
    // in the program; availability must be false (not a false positive) so callers
    // can degrade — even though its config layer builds fine.
    makeMonorepo(JSON.stringify({ compilerOptions: { target: 'es2020' }, include: ['packages/lib/src'] }));
    const g = await open();

    const ghost = join(root, 'packages/lib/src/never-indexed.ts');
    expect(g.isFileInSemanticProgram(ghost)).toBe(false);
    expect(g.getFileBindings(ghost).length).toBe(0);

    await g.close();
  });

  it('should open successfully and keep the app project working when the root tsconfig is broken', async () => {
    // Root extends a missing base -> its program cannot build. Open must not throw;
    // the app project (own tsconfig) keeps working, the root project degrades.
    makeMonorepo(JSON.stringify({ extends: './does-not-exist.json', include: ['packages/lib/src'] }));

    const g = await open();

    const appAbs = join(root, APP_FILE);
    expect(g.isFileInSemanticProgram(appAbs)).toBe(true);
    expect(g.getFileBindings(appAbs).length).toBeGreaterThan(0);

    // The broken root project degrades: its files are not in any program.
    expect(g.isFileInSemanticProgram(join(root, 'packages/lib/src/index.ts'))).toBe(false);

    await g.close();
  });
});
