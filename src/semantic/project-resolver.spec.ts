import { describe, it, expect } from 'bun:test';
import { SemanticProjectResolver, type SemanticProjectEntry } from './project-resolver';

function resolver(...dirs: string[]): SemanticProjectResolver {
  const entries: SemanticProjectEntry[] = dirs.map((dir) => ({
    dir,
    configPath: `${dir}/tsconfig.json`,
  }));
  return new SemanticProjectResolver(entries);
}

describe('SemanticProjectResolver', () => {
  it('should route every file to the only config when a single root config exists', () => {
    const r = resolver('/repo');
    expect(r.resolve('/repo/src/a.ts')).toBe('/repo/tsconfig.json');
  });

  it('should route a file to the nearest-up config when nested configs exist', () => {
    const r = resolver('/repo', '/repo/apps/web');
    expect(r.resolve('/repo/apps/web/src/main.ts')).toBe('/repo/apps/web/tsconfig.json');
  });

  it('should route a file outside the nested config to the root config', () => {
    const r = resolver('/repo', '/repo/apps/web');
    expect(r.resolve('/repo/lib/util.ts')).toBe('/repo/tsconfig.json');
  });

  it('should pick the deepest config when a file is under multiple ancestor configs', () => {
    const r = resolver('/repo', '/repo/apps', '/repo/apps/web');
    expect(r.resolve('/repo/apps/web/src/a.ts')).toBe('/repo/apps/web/tsconfig.json');
  });

  it('should resolve a file located directly in a config directory', () => {
    const r = resolver('/repo', '/repo/apps/web');
    expect(r.resolve('/repo/apps/web/main.ts')).toBe('/repo/apps/web/tsconfig.json');
  });

  it('should return null when no config is an ancestor of the file', () => {
    const r = resolver('/repo/packages/core');
    expect(r.resolve('/repo/apps/web/main.ts')).toBeNull();
  });

  it('should not treat a sibling dir with a shared name prefix as an ancestor', () => {
    // '/repo/app' must not match a file under '/repo/app-extra'
    const r = resolver('/repo/app');
    expect(r.resolve('/repo/app-extra/main.ts')).toBeNull();
  });
});
