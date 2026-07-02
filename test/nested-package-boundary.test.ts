import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Gildash } from '../src/gildash';

/**
 * Nested package.json boundary handling (customer regression):
 * a package.json under projectRoot — even inside an ignorePatterns-matched
 * fixture dir — must never silently empty the main project's symbol/relation
 * queries, and ignored paths must not reshape the boundary set.
 */

let root: string;

function makeRepo(opts: { fixturePackageJson: boolean }): void {
  root = mkdtempSync(join(tmpdir(), 'gildash-nested-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'test/__fixtures__/a.dir'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'main-repo' }));
  writeFileSync(join(root, 'src/util.ts'), 'export const util = 1;\n');
  writeFileSync(join(root, 'src/index.ts'), "import { util } from './util';\nexport const x = util;\n");
  writeFileSync(join(root, 'test/__fixtures__/a.dir/mod.ts'), 'export const fixtureExport = 1;\n');
  if (opts.fixturePackageJson) {
    writeFileSync(join(root, 'test/__fixtures__/a.dir/package.json'), JSON.stringify({ name: 'fixture-pkg' }));
  }
}

async function open(ignorePatterns?: string[]) {
  return Gildash.open({
    projectRoot: root,
    watchMode: false,
    extensions: ['.ts'],
    ...(ignorePatterns ? { ignorePatterns } : {}),
  });
}

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('nested package.json boundaries', () => {
  it('should keep main-project queries populated even when a nested package splits the boundaries (F1)', async () => {
    // No ignorePatterns: the nested package IS a boundary — but the default
    // project must stay the root, so main queries never silently empty.
    makeRepo({ fixturePackageJson: true });
    const g = await open();

    expect(g.projects.length).toBe(2);
    expect(g.defaultProject).toBe('main-repo');
    expect(g.searchRelations({ type: 'imports' }).length).toBeGreaterThan(0);
    expect(g.searchSymbols({ isExported: true }).length).toBeGreaterThan(0);

    await g.close({ cleanup: true });
  });

  it('should not create a boundary for a package.json under an ignored directory (F2)', async () => {
    makeRepo({ fixturePackageJson: true });
    const g = await open(['**/__fixtures__/**']);

    expect(g.projects.map((b) => b.project)).toEqual(['main-repo']);
    expect(g.searchRelations({ type: 'imports' }).length).toBeGreaterThan(0);
    expect(g.searchSymbols({ isExported: true }).length).toBeGreaterThan(0);

    await g.close({ cleanup: true });
  });

  it('should scope queries to another boundary via query.project (F3)', async () => {
    makeRepo({ fixturePackageJson: true });
    const g = await open();

    const fixtureSymbols = g.searchSymbols({ isExported: true, project: 'fixture-pkg' });
    expect(fixtureSymbols.some((s) => s.name === 'fixtureExport')).toBe(true);
    // Default scope must not contain the fixture package's symbols.
    expect(g.searchSymbols({ isExported: true }).some((s) => s.name === 'fixtureExport')).toBe(false);

    await g.close({ cleanup: true });
  });

  it('should garbage-collect rows of renamed projects on reopen (no double counting)', async () => {
    // Boundary/project renames (and upgrades changing attribution) must not
    // leave orphan rows double-counting in cross-project queries.
    makeRepo({ fixturePackageJson: false });
    let g = await open();
    const before = g.searchAllSymbols({ isExported: true }).length;
    expect(before).toBeGreaterThan(0);
    await g.close(); // keep the DB

    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'renamed-repo' }));
    g = await open();

    expect(g.defaultProject).toBe('renamed-repo');
    // Without GC the old project's rows survive and every symbol double-counts.
    expect(g.searchAllSymbols({ isExported: true }).length).toBe(before);

    await g.close({ cleanup: true });
  });

  it('should behave identically for a repo without any nested package.json (baseline)', async () => {
    makeRepo({ fixturePackageJson: false });
    const g = await open();

    expect(g.projects.map((b) => b.project)).toEqual(['main-repo']);
    expect(g.defaultProject).toBe('main-repo');
    expect(g.searchRelations({ type: 'imports' }).length).toBeGreaterThan(0);

    await g.close({ cleanup: true });
  });
});
