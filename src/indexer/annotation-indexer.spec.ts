import { describe, expect, it, mock, beforeEach } from 'bun:test';
import type { ParsedFile } from '../parser/types';
import { parseSource } from '../parser/parse-source';
import { isErr } from '@zipbul/result';
import { indexFileAnnotations } from './annotation-indexer';

function parse(source: string): ParsedFile {
  const result = parseSource('/test.ts', source);
  if (isErr(result)) throw result.data;
  return result;
}

function makeAnnotationRepo() {
  return {
    deleteFileAnnotations: mock((p: string, f: string) => {}),
    insertBatch: mock((p: string, f: string, rows: any[]) => {}),
  };
}

describe('indexFileAnnotations', () => {
  it('should return count of extracted annotations', () => {
    const parsed = parse(`
/** @deprecated Use newFn */
function oldFn() {}
`);
    const repo = makeAnnotationRepo();
    const count = indexFileAnnotations({ parsed, project: 'p', filePath: 'a.ts', annotationRepo: repo });
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('should call deleteFileAnnotations before insert', () => {
    const parsed = parse(`
/** @todo fix */
function fn() {}
`);
    const repo = makeAnnotationRepo();
    indexFileAnnotations({ parsed, project: 'p', filePath: 'a.ts', annotationRepo: repo });
    expect(repo.deleteFileAnnotations).toHaveBeenCalledWith('p', 'a.ts');
    expect(repo.insertBatch).toHaveBeenCalled();

    // delete should be called before insert
    const deleteOrder = repo.deleteFileAnnotations.mock.invocationCallOrder[0]!;
    const insertOrder = repo.insertBatch.mock.invocationCallOrder[0]!;
    expect(deleteOrder).toBeLessThan(insertOrder);
  });

  it('should return 0 and not call insertBatch when no annotations found', () => {
    const parsed = parse(`function fn() {}`);
    const repo = makeAnnotationRepo();
    const count = indexFileAnnotations({ parsed, project: 'p', filePath: 'a.ts', annotationRepo: repo });
    expect(count).toBe(0);
    expect(repo.deleteFileAnnotations).toHaveBeenCalled();
    expect(repo.insertBatch).not.toHaveBeenCalled();
  });

  it('should pass correct fields to insertBatch', () => {
    const parsed = parse(`
/** @deprecated old */
function fn() {}
`);
    const repo = makeAnnotationRepo();
    indexFileAnnotations({ parsed, project: 'myProject', filePath: 'src/file.ts', annotationRepo: repo });

    const [project, filePath, rows] = repo.insertBatch.mock.calls[0]!;
    expect(project).toBe('myProject');
    expect(filePath).toBe('src/file.ts');
    expect(rows.length).toBeGreaterThanOrEqual(1);

    const row = rows[0]!;
    expect(row.project).toBe('myProject');
    expect(row.filePath).toBe('src/file.ts');
    expect(row.tag).toBe('deprecated');
    expect(row.source).toBe('jsdoc');
    expect(typeof row.startLine).toBe('number');
    expect(typeof row.indexedAt).toBe('string');
  });

  it('should pass line comment annotations to insertBatch', () => {
    const parsed = parse(`
// @todo fix this later
function fn() {}
`);
    const repo = makeAnnotationRepo();
    const count = indexFileAnnotations({ parsed, project: 'p', filePath: 'a.ts', annotationRepo: repo });
    expect(count).toBeGreaterThanOrEqual(1);
    expect(repo.insertBatch).toHaveBeenCalled();

    const [, , rows] = repo.insertBatch.mock.calls[0]!;
    const lineRow = rows.find((r: any) => r.source === 'line');
    expect(lineRow).toBeDefined();
    expect(lineRow!.tag).toBe('todo');
  });

  it('should pass block comment annotations to insertBatch', () => {
    const parsed = parse(`
/* @note important detail */
function fn() {}
`);
    const repo = makeAnnotationRepo();
    const count = indexFileAnnotations({ parsed, project: 'p', filePath: 'a.ts', annotationRepo: repo });
    expect(count).toBeGreaterThanOrEqual(1);
    expect(repo.insertBatch).toHaveBeenCalled();

    const [, , rows] = repo.insertBatch.mock.calls[0]!;
    const blockRow = rows.find((r: any) => r.source === 'block');
    expect(blockRow).toBeDefined();
    expect(blockRow!.tag).toBe('note');
  });

  it('should handle annotation with null symbolName', () => {
    // Annotation not followed by any symbol within the gap threshold
    const parsed = parse(`
// @todo orphan annotation
`);
    const repo = makeAnnotationRepo();
    const count = indexFileAnnotations({ parsed, project: 'p', filePath: 'a.ts', annotationRepo: repo });
    expect(count).toBeGreaterThanOrEqual(1);
    expect(repo.insertBatch).toHaveBeenCalled();

    const [, , rows] = repo.insertBatch.mock.calls[0]!;
    const row = rows.find((r: any) => r.tag === 'todo');
    expect(row).toBeDefined();
    expect(row!.symbolName).toBeNull();
  });
});

const mockExtractAnnotations = mock(() => [] as any[]);

function makeParsedFile(): any {
  return { filePath: '/p/src/Foo.vue', program: { body: [] }, errors: [], comments: [], sourceText: '', module: {} };
}

describe('indexFileAnnotations — span remapping (plugin-transformed files)', () => {
  beforeEach(() => {
    // setup.ts restores real modules after every test — apply the local mock.
    mock.module('../extractor/annotation-extractor', () => ({ extractAnnotations: mockExtractAnnotations }));
    mockExtractAnnotations.mockReset();
  });

  it('should store remapped raw spans when a remapSpan fn is provided', () => {
    const repo = { deleteFileAnnotations: mock(() => {}), insertBatch: mock(() => {}) };
    mockExtractAnnotations.mockReturnValue([{
      tag: 'todo', value: 'x', source: 'comment', symbolName: null,
      span: { start: { line: 1, column: 3 }, end: { line: 1, column: 8 } },
    }]);

    indexFileAnnotations({
      parsed: makeParsedFile(), project: 'p', filePath: 'src/Foo.vue',
      annotationRepo: repo as any,
      remapSpan: (span) => ({
        start: { line: span.start.line + 4, column: span.start.column },
        end: { line: span.end.line + 4, column: span.end.column },
      }),
    });

    const rows = (repo.insertBatch.mock.calls[0] as any[])[2];
    expect(rows[0]).toMatchObject({ startLine: 5, endLine: 5 });
  });

  it('should skip annotations whose span cannot be remapped and not count them', () => {
    const repo = { deleteFileAnnotations: mock(() => {}), insertBatch: mock(() => {}) };
    mockExtractAnnotations.mockReturnValue([{
      tag: 'todo', value: 'x', source: 'comment', symbolName: null,
      span: { start: { line: 1, column: 0 }, end: { line: 1, column: 4 } },
    }]);

    const count = indexFileAnnotations({
      parsed: makeParsedFile(), project: 'p', filePath: 'src/Foo.vue',
      annotationRepo: repo as any,
      remapSpan: () => null,
    });

    expect(count).toBe(0);
    expect(repo.insertBatch).not.toHaveBeenCalled();
  });
});
