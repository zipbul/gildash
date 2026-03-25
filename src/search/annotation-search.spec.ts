import { describe, expect, it, mock } from 'bun:test';
import { annotationSearch } from './annotation-search';
import type { IAnnotationRepo } from './annotation-search';

function makeRepo(records: any[] = []): IAnnotationRepo {
  return {
    search: mock(() => records),
  };
}

describe('annotationSearch', () => {
  it('should pass query filters to repo.search', () => {
    const repo = makeRepo();
    annotationSearch({
      annotationRepo: repo,
      project: 'proj',
      query: { tag: 'todo', filePath: 'a.ts', source: 'line', limit: 50 },
    });

    expect(repo.search).toHaveBeenCalledWith(expect.objectContaining({
      project: 'proj',
      tag: 'todo',
      filePath: 'a.ts',
      source: 'line',
      limit: 50,
    }));
  });

  it('should pass limit=undefined when not specified', () => {
    const repo = makeRepo();
    annotationSearch({ annotationRepo: repo, query: {} });
    expect(repo.search).toHaveBeenCalledWith(expect.objectContaining({ limit: undefined }));
  });

  it('should map records to AnnotationSearchResult', () => {
    const repo = makeRepo([
      { id: 1, project: 'p', filePath: 'a.ts', tag: 'todo', value: 'fix', source: 'line',
        symbolName: 'fn', startLine: 5, startColumn: 3, endLine: 5, endColumn: 20, indexedAt: '2024-01-01' },
    ]);

    const results = annotationSearch({ annotationRepo: repo, query: {} });
    expect(results.length).toBe(1);
    expect(results[0]!.tag).toBe('todo');
    expect(results[0]!.value).toBe('fix');
    expect(results[0]!.source).toBe('line');
    expect(results[0]!.filePath).toBe('a.ts');
    expect(results[0]!.symbolName).toBe('fn');
    expect(results[0]!.span.start.line).toBe(5);
    expect(results[0]!.span.start.column).toBe(3);
  });

  it('should use query.project over default project', () => {
    const repo = makeRepo();
    annotationSearch({
      annotationRepo: repo,
      project: 'default',
      query: { project: 'override' },
    });
    expect(repo.search).toHaveBeenCalledWith(expect.objectContaining({ project: 'override' }));
  });

  it('should generate FTS query for text search', () => {
    const repo = makeRepo();
    annotationSearch({
      annotationRepo: repo,
      query: { text: 'implement' },
    });
    expect(repo.search).toHaveBeenCalledWith(expect.objectContaining({
      ftsQuery: expect.any(String),
    }));
  });

  it('should return empty array when repo returns empty', () => {
    const results = annotationSearch({ annotationRepo: makeRepo([]), query: {} });
    expect(results).toEqual([]);
  });

  it('should not pass ftsQuery when text is whitespace-only', () => {
    const repo = makeRepo();
    annotationSearch({
      annotationRepo: repo,
      query: { text: '   ' },
    });
    expect(repo.search).toHaveBeenCalledWith(expect.objectContaining({
      ftsQuery: undefined,
    }));
  });

  it('should not pass ftsQuery when text is empty string', () => {
    const repo = makeRepo();
    annotationSearch({
      annotationRepo: repo,
      query: { text: '' },
    });
    expect(repo.search).toHaveBeenCalledWith(expect.objectContaining({
      ftsQuery: undefined,
    }));
  });

  it('should pass ftsQuery when text has actual content after trimming', () => {
    const repo = makeRepo();
    annotationSearch({
      annotationRepo: repo,
      query: { text: '  todo  ' },
    });
    const call = (repo.search as any).mock.calls[0][0];
    expect(call.ftsQuery).toBeTruthy();
    expect(typeof call.ftsQuery).toBe('string');
    expect(call.ftsQuery.length).toBeGreaterThan(0);
  });

  it('should not pass ftsQuery when text is tab and newline only', () => {
    const repo = makeRepo();
    annotationSearch({
      annotationRepo: repo,
      query: { text: '\t\n  \t' },
    });
    expect(repo.search).toHaveBeenCalledWith(expect.objectContaining({
      ftsQuery: undefined,
    }));
  });

  // --- Filter combination tests ---

  it('should pass both tag and filePath to searchByQuery when both are set', () => {
    const repo = makeRepo();
    annotationSearch({
      annotationRepo: repo,
      query: { tag: 'todo', filePath: 'src/index.ts' },
    });
    expect(repo.search).toHaveBeenCalledWith(expect.objectContaining({
      tag: 'todo',
      filePath: 'src/index.ts',
    }));
  });

  it('should pass both tag and source to searchByQuery when both are set', () => {
    const repo = makeRepo();
    annotationSearch({
      annotationRepo: repo,
      query: { tag: 'deprecated', source: 'jsdoc' },
    });
    expect(repo.search).toHaveBeenCalledWith(expect.objectContaining({
      tag: 'deprecated',
      source: 'jsdoc',
    }));
  });

  it('should pass tag, filePath, and symbolName to searchByQuery when all are set', () => {
    const repo = makeRepo();
    annotationSearch({
      annotationRepo: repo,
      query: { tag: 'todo', filePath: 'src/utils.ts', symbolName: 'helperFn' },
    });
    expect(repo.search).toHaveBeenCalledWith(expect.objectContaining({
      tag: 'todo',
      filePath: 'src/utils.ts',
      symbolName: 'helperFn',
    }));
  });
});
