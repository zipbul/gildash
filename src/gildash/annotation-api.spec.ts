import { describe, it, expect, mock } from 'bun:test';
import { GildashError } from '../errors';
import type { GildashContext } from './context';
import { searchAnnotations } from './annotation-api';

// ─── Fixtures ───────────────────────────────────────────────────────

function makeCtx(overrides?: Partial<GildashContext>): GildashContext {
  return {
    closed: false,
    defaultProject: 'default',
    projectRoot: '/project',
    annotationRepo: null,
    annotationSearchFn: null,
    logger: { error: () => {} } as any,
    ...overrides,
  } as unknown as GildashContext;
}

// ─── searchAnnotations ──────────────────────────────────────────────

describe('searchAnnotations', () => {
  it('should delegate query to annotationSearchFn', () => {
    const results = [
      {
        tag: 'TODO',
        value: 'fix this',
        source: 'comment',
        filePath: 'src/a.ts',
        symbolName: null,
        span: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
      },
    ];
    const searchFn = mock(() => results);
    const annotationRepo = {} as any;
    const ctx = makeCtx({
      annotationRepo,
      annotationSearchFn: searchFn as any,
    });

    const query = { tag: 'TODO' };
    const result = searchAnnotations(ctx, query);

    expect(result).toBe(results as any);
    expect(searchFn).toHaveBeenCalledWith({
      annotationRepo,
      project: 'default',
      query,
    });
  });

  it('should throw GildashError when instance is closed', () => {
    const ctx = makeCtx({ closed: true });

    expect(() => searchAnnotations(ctx, {})).toThrow(GildashError);
  });

  it('should return empty array when annotationRepo is null', () => {
    const ctx = makeCtx({
      annotationRepo: null,
      annotationSearchFn: mock(() => []) as any,
    });

    const result = searchAnnotations(ctx, { tag: 'TODO' });

    expect(result).toEqual([]);
  });

  it('should return empty array when annotationSearchFn is null', () => {
    const ctx = makeCtx({
      annotationRepo: {} as any,
      annotationSearchFn: null,
    });

    const result = searchAnnotations(ctx, { tag: 'TODO' });

    expect(result).toEqual([]);
  });

  it('should use query.project over defaultProject when provided', () => {
    const searchFn = mock(() => []);
    const annotationRepo = {} as any;
    const ctx = makeCtx({
      annotationRepo,
      annotationSearchFn: searchFn as any,
      defaultProject: 'default',
    });

    searchAnnotations(ctx, { project: 'custom' });

    expect(searchFn).toHaveBeenCalledWith(
      expect.objectContaining({ project: 'custom' }),
    );
  });

  it('should use defaultProject when query.project is absent', () => {
    const searchFn = mock(() => []);
    const annotationRepo = {} as any;
    const ctx = makeCtx({
      annotationRepo,
      annotationSearchFn: searchFn as any,
      defaultProject: 'my-project',
    });

    searchAnnotations(ctx, { tag: 'FIXME' });

    expect(searchFn).toHaveBeenCalledWith(
      expect.objectContaining({ project: 'my-project' }),
    );
  });
});
