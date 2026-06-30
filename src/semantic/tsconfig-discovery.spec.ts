import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { discoverTsconfigs } from './tsconfig-discovery';

let root: string;

function write(rel: string, content: string) {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

/** Discovered config paths relative to root, sorted, for stable assertions. */
function rels(entries: { configPath: string }[]): string[] {
  return entries.map((e) => path.relative(root, e.configPath)).sort();
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'tsdisc-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('discoverTsconfigs', () => {
  it('should discover the single root tsconfig when only one exists', () => {
    write('tsconfig.json', '{"compilerOptions":{"strict":true}}');
    write('src/a.ts', 'export const a = 1;');

    expect(rels(discoverTsconfigs(root))).toEqual(['tsconfig.json']);
  });

  it('should discover nested tsconfigs by scanning when each is named tsconfig.json', () => {
    write('tsconfig.json', '{"include":["packages"]}');
    write('apps/web/tsconfig.json', '{"compilerOptions":{"jsx":"react"}}');

    expect(rels(discoverTsconfigs(root))).toEqual([
      'apps/web/tsconfig.json',
      'tsconfig.json',
    ]);
  });

  it('should follow project references from a solution-style root config', () => {
    write('tsconfig.json', '{"files":[],"references":[{"path":"./apps/web"}]}');
    write('apps/web/tsconfig.json', '{"compilerOptions":{"jsx":"react"}}');

    expect(rels(discoverTsconfigs(root))).toContain('apps/web/tsconfig.json');
  });

  it('should follow a reference that points to a non-standard config filename', () => {
    write('tsconfig.json', '{"files":[],"references":[{"path":"./apps/web/tsconfig.app.json"}]}');
    write('apps/web/tsconfig.app.json', '{"compilerOptions":{"experimentalDecorators":true}}');

    expect(rels(discoverTsconfigs(root))).toContain('apps/web/tsconfig.app.json');
  });

  it('should exclude configs under ignored directories', () => {
    write('tsconfig.json', '{}');
    write('node_modules/dep/tsconfig.json', '{}');

    expect(rels(discoverTsconfigs(root, { ignorePatterns: ['**/node_modules/**'] }))).toEqual([
      'tsconfig.json',
    ]);
  });

  it('should use only the explicit configs (plus their references) when provided', () => {
    write('tsconfig.json', '{}');
    write('apps/web/tsconfig.json', '{"references":[{"path":"./tsconfig.app.json"}]}');
    write('apps/web/tsconfig.app.json', '{}');

    const out = rels(discoverTsconfigs(root, { explicit: [path.join(root, 'apps/web/tsconfig.json')] }));
    expect(out).toEqual(['apps/web/tsconfig.app.json', 'apps/web/tsconfig.json']);
  });

  it('should keep the given (symlinked) root path so routing matches query paths', () => {
    // Query paths arrive as path.resolve(projectRoot, file) — not realpath. When
    // the root is reached via a symlink, discovered dirs must stay under the
    // symlink path, else nearest-up routing never matches.
    write('tsconfig.json', '{}');
    const link = `${root}-link`;
    symlinkSync(root, link, 'dir');
    try {
      const out = discoverTsconfigs(link);
      expect(out.map((e) => e.dir)).toContain(link);
    } finally {
      rmSync(link, { force: true });
    }
  });

  it('should deduplicate a config reachable both by scan and by reference', () => {
    write('tsconfig.json', '{"files":[],"references":[{"path":"./apps/web"}]}');
    write('apps/web/tsconfig.json', '{}');

    const out = discoverTsconfigs(root);
    const webCount = out.filter((e) => e.configPath.endsWith('apps/web/tsconfig.json')).length;
    expect(webCount).toBe(1);
  });
});
