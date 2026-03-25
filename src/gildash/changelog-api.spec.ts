import { describe, it, expect, mock } from 'bun:test';
import { GildashError } from '../errors';
import type { GildashContext } from './context';
import { getSymbolChanges, pruneChangelog } from './changelog-api';

// ─── Fixtures ───────────────────────────────────────────────────────

function makeCtx(overrides?: Partial<GildashContext>): GildashContext {
  return {
    closed: false,
    defaultProject: 'default',
    projectRoot: '/project',
    changelogRepo: null,
    boundaries: [],
    logger: { error: () => {} } as any,
    ...overrides,
  } as unknown as GildashContext;
}

function makeRecord(overrides?: Record<string, unknown>) {
  return {
    changeType: 'added',
    symbolName: 'Foo',
    symbolKind: 'function',
    filePath: 'src/a.ts',
    oldName: null,
    oldFilePath: null,
    fingerprint: 'fp1',
    changedAt: '2026-01-01T00:00:00.000Z',
    isFullIndex: 0,
    indexRunId: 'run-1',
    ...overrides,
  };
}

// ─── getSymbolChanges ───────────────────────────────────────────────

describe('getSymbolChanges', () => {
  it('should delegate to changelogRepo.getSince with correct parameters', () => {
    const records = [makeRecord()];
    const getSince = mock(() => records);
    const ctx = makeCtx({ changelogRepo: { getSince } as any });

    const result = getSymbolChanges(ctx, '2026-01-01T00:00:00.000Z');

    expect(getSince).toHaveBeenCalledWith({
      project: 'default',
      since: '2026-01-01T00:00:00.000Z',
      symbolName: undefined,
      changeTypes: undefined,
      filePath: undefined,
      includeFullIndex: undefined,
      indexRunId: undefined,
      afterId: undefined,
      limit: 1000,
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.symbolName).toBe('Foo');
  });

  it('should throw GildashError when instance is closed', () => {
    const ctx = makeCtx({ closed: true });

    expect(() => getSymbolChanges(ctx, '2026-01-01')).toThrow(GildashError);
  });

  it('should return empty array when changelogRepo is null', () => {
    const ctx = makeCtx({ changelogRepo: null });

    const result = getSymbolChanges(ctx, '2026-01-01');

    expect(result).toEqual([]);
  });

  it('should convert Date to ISO string for since parameter', () => {
    const getSince = mock(() => []);
    const ctx = makeCtx({ changelogRepo: { getSince } as any });
    const date = new Date('2026-03-15T12:00:00.000Z');

    getSymbolChanges(ctx, date);

    expect(getSince).toHaveBeenCalledWith(
      expect.objectContaining({ since: '2026-03-15T12:00:00.000Z' }),
    );
  });

  it('should pass string since parameter as-is', () => {
    const getSince = mock(() => []);
    const ctx = makeCtx({ changelogRepo: { getSince } as any });

    getSymbolChanges(ctx, '2026-01-01');

    expect(getSince).toHaveBeenCalledWith(
      expect.objectContaining({ since: '2026-01-01' }),
    );
  });

  it('should use default limit 1000 when options.limit is absent', () => {
    const getSince = mock(() => []);
    const ctx = makeCtx({ changelogRepo: { getSince } as any });

    getSymbolChanges(ctx, '2026-01-01', { symbolName: 'Foo' });

    expect(getSince).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 1000 }),
    );
  });

  it('should pass all options fields', () => {
    const getSince = mock(() => []);
    const ctx = makeCtx({ changelogRepo: { getSince } as any });

    getSymbolChanges(ctx, '2026-01-01', {
      symbolName: 'Bar',
      changeTypes: ['added', 'modified'],
      filePath: 'src/b.ts',
      includeFullIndex: true,
      indexRunId: 'run-42',
      afterId: 100,
      limit: 50,
      project: 'custom',
    });

    expect(getSince).toHaveBeenCalledWith({
      project: 'custom',
      since: '2026-01-01',
      symbolName: 'Bar',
      changeTypes: ['added', 'modified'],
      filePath: 'src/b.ts',
      includeFullIndex: true,
      indexRunId: 'run-42',
      afterId: 100,
      limit: 50,
    });
  });

  it('should map isFullIndex from number (1) to boolean (true)', () => {
    const getSince = mock(() => [makeRecord({ isFullIndex: 1 })]);
    const ctx = makeCtx({ changelogRepo: { getSince } as any });

    const result = getSymbolChanges(ctx, '2026-01-01');

    expect(result[0]!.isFullIndex).toBe(true);
  });

  it('should map isFullIndex from number (0) to boolean (false)', () => {
    const getSince = mock(() => [makeRecord({ isFullIndex: 0 })]);
    const ctx = makeCtx({ changelogRepo: { getSince } as any });

    const result = getSymbolChanges(ctx, '2026-01-01');

    expect(result[0]!.isFullIndex).toBe(false);
  });

  it('should use defaultProject when options.project is absent', () => {
    const getSince = mock(() => []);
    const ctx = makeCtx({
      changelogRepo: { getSince } as any,
      defaultProject: 'my-project',
    });

    getSymbolChanges(ctx, '2026-01-01');

    expect(getSince).toHaveBeenCalledWith(
      expect.objectContaining({ project: 'my-project' }),
    );
  });
});

// ─── pruneChangelog ─────────────────────────────────────────────────

describe('pruneChangelog', () => {
  it('should return total pruned count across all projects', () => {
    const pruneOlderThan = mock(() => 5);
    const ctx = makeCtx({
      changelogRepo: { pruneOlderThan } as any,
      defaultProject: 'default',
      boundaries: [
        { project: 'pkg-a' } as any,
        { project: 'pkg-b' } as any,
      ],
    });

    const result = pruneChangelog(ctx, '2026-01-01');

    expect(result).toBe(15); // 5 * 3 projects
    expect(pruneOlderThan).toHaveBeenCalledTimes(3);
  });

  it('should throw GildashError when instance is closed', () => {
    const ctx = makeCtx({ closed: true });

    expect(() => pruneChangelog(ctx, '2026-01-01')).toThrow(GildashError);
  });

  it('should return 0 when changelogRepo is null', () => {
    const ctx = makeCtx({ changelogRepo: null });

    const result = pruneChangelog(ctx, '2026-01-01');

    expect(result).toBe(0);
  });

  it('should convert Date to ISO string for before parameter', () => {
    const pruneOlderThan = mock(() => 0);
    const ctx = makeCtx({ changelogRepo: { pruneOlderThan } as any });
    const date = new Date('2026-03-15T12:00:00.000Z');

    pruneChangelog(ctx, date);

    expect(pruneOlderThan).toHaveBeenCalledWith('default', '2026-03-15T12:00:00.000Z');
  });

  it('should deduplicate projects from boundaries', () => {
    const pruneOlderThan = mock(() => 1);
    const ctx = makeCtx({
      changelogRepo: { pruneOlderThan } as any,
      defaultProject: 'default',
      boundaries: [
        { project: 'default' } as any, // duplicate of defaultProject
        { project: 'pkg-a' } as any,
      ],
    });

    const result = pruneChangelog(ctx, '2026-01-01');

    expect(pruneOlderThan).toHaveBeenCalledTimes(2); // 'default' + 'pkg-a'
    expect(result).toBe(2);
  });

  it('should call pruneOlderThan for each unique project', () => {
    const pruneOlderThan = mock(() => 0);
    const ctx = makeCtx({
      changelogRepo: { pruneOlderThan } as any,
      defaultProject: 'root',
      boundaries: [
        { project: 'pkg-a' } as any,
        { project: 'pkg-b' } as any,
      ],
    });

    pruneChangelog(ctx, '2026-01-01');

    expect(pruneOlderThan).toHaveBeenCalledWith('root', '2026-01-01');
    expect(pruneOlderThan).toHaveBeenCalledWith('pkg-a', '2026-01-01');
    expect(pruneOlderThan).toHaveBeenCalledWith('pkg-b', '2026-01-01');
  });
});
