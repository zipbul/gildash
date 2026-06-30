import { describe, it, expect, mock } from 'bun:test';
import { SemanticProjectRouter } from './project-router';
import { SemanticProjectResolver } from './project-resolver';

/** Minimal fake layer recording which file it was asked about. */
function fakeLayer(tag: string) {
  return {
    getFileBindings: mock((fp: string) => [{ tag, fp }] as any),
    getStandaloneFileBindings: mock((fp: string, _c: string) => [{ tag, standalone: fp }] as any),
    isTypeAssignableTo: mock(() => true),
    isFileInSemanticProgram: mock((_fp: string) => true),
    dispose: mock(() => {}),
    isDisposed: false,
  };
}

function setup(opts: { fail?: string } = {}) {
  const resolver = new SemanticProjectResolver([
    { configPath: '/repo/tsconfig.json', dir: '/repo' },
    { configPath: '/repo/apps/web/tsconfig.json', dir: '/repo/apps/web' },
  ]);
  const created: Record<string, ReturnType<typeof fakeLayer>> = {};
  const createLayer = mock((configPath: string) => {
    if (opts.fail && configPath === opts.fail) throw new Error('bad tsconfig');
    const l = fakeLayer(configPath);
    created[configPath] = l;
    return l as any;
  });
  const router = new SemanticProjectRouter(resolver, createLayer as any);
  return { router, createLayer, created };
}

describe('SemanticProjectRouter', () => {
  it('should route a query to the layer of the file\'s nearest-up config', () => {
    const { router } = setup();
    const r = router.getFileBindings('/repo/apps/web/src/a.ts') as any;
    expect(r[0].tag).toBe('/repo/apps/web/tsconfig.json');
  });

  it('should route a file outside the nested project to the root layer', () => {
    const { router } = setup();
    const r = router.getFileBindings('/repo/lib/b.ts') as any;
    expect(r[0].tag).toBe('/repo/tsconfig.json');
  });

  it('should create each config layer at most once (lazy + cached)', () => {
    const { router, createLayer } = setup();
    router.getFileBindings('/repo/apps/web/src/a.ts');
    router.getFileBindings('/repo/apps/web/src/c.ts');
    const webCreations = createLayer.mock.calls.filter((c) => c[0] === '/repo/apps/web/tsconfig.json').length;
    expect(webCreations).toBe(1);
  });

  it('should not create layers for configs that were never queried', () => {
    const { router, createLayer } = setup();
    router.getFileBindings('/repo/lib/b.ts');
    expect(createLayer.mock.calls.some((c) => c[0] === '/repo/apps/web/tsconfig.json')).toBe(false);
  });

  it('should isolate a failed config so its files degrade without throwing', () => {
    const { router } = setup({ fail: '/repo/apps/web/tsconfig.json' });
    expect(() => router.getFileBindings('/repo/apps/web/src/a.ts')).not.toThrow();
    expect(router.getFileBindings('/repo/apps/web/src/a.ts')).toEqual([]);
  });

  it('should keep other projects working when one config fails to create', () => {
    const { router } = setup({ fail: '/repo/apps/web/tsconfig.json' });
    const r = router.getFileBindings('/repo/lib/b.ts') as any;
    expect(r[0].tag).toBe('/repo/tsconfig.json');
  });

  it('should not retry a failed config on every call', () => {
    const { router, createLayer } = setup({ fail: '/repo/apps/web/tsconfig.json' });
    router.getFileBindings('/repo/apps/web/src/a.ts');
    router.getFileBindings('/repo/apps/web/src/a.ts');
    const tries = createLayer.mock.calls.filter((c) => c[0] === '/repo/apps/web/tsconfig.json').length;
    expect(tries).toBe(1);
  });

  it('should report availability true for a file in a healthy project', () => {
    const { router } = setup();
    expect(router.isFileInSemanticProgram('/repo/apps/web/src/a.ts')).toBe(true);
  });

  it('should report availability false for a file whose config failed to create', () => {
    const { router } = setup({ fail: '/repo/apps/web/tsconfig.json' });
    expect(router.isFileInSemanticProgram('/repo/apps/web/src/a.ts')).toBe(false);
  });

  it('should report availability false for a file under no discovered config', () => {
    const { router } = setup();
    expect(router.isFileInSemanticProgram('/other/x.ts')).toBe(false);
  });

  it('should return empty bindings (not throw) for a file under no config', () => {
    const { router } = setup();
    expect(router.getFileBindings('/other/x.ts')).toEqual([]);
  });

  it('should resolve standalone bindings for an unowned file via the root config layer', () => {
    const { router } = setup();
    const r = router.getStandaloneFileBindings('/other/x.ts', 'const a = 1;') as any;
    expect(r[0].standalone).toBe('/other/x.ts');
  });

  it('should delegate two-file isTypeAssignableTo when both files share a project', () => {
    const { router } = setup();
    expect(router.isTypeAssignableTo('/repo/lib/a.ts', 0, '/repo/lib/b.ts', 0)).toBe(true);
  });

  it('should return null for cross-project two-file isTypeAssignableTo', () => {
    const { router } = setup();
    expect(router.isTypeAssignableTo('/repo/lib/a.ts', 0, '/repo/apps/web/src/b.ts', 0)).toBeNull();
  });

  it('should not create new layers or answer queries after dispose', () => {
    const { router, createLayer } = setup();
    router.dispose();
    const callsBefore = createLayer.mock.calls.length;
    expect(router.getFileBindings('/repo/apps/web/src/a.ts')).toEqual([]);
    expect(router.isFileInSemanticProgram('/repo/apps/web/src/a.ts')).toBe(false);
    expect(createLayer.mock.calls.length).toBe(callsBefore);
  });

  it('should dispose every created layer exactly once', () => {
    const { router, created } = setup();
    router.getFileBindings('/repo/apps/web/src/a.ts');
    router.getFileBindings('/repo/lib/b.ts');
    router.dispose();
    expect(created['/repo/apps/web/tsconfig.json']!.dispose).toHaveBeenCalledTimes(1);
    expect(created['/repo/tsconfig.json']!.dispose).toHaveBeenCalledTimes(1);
  });
});
