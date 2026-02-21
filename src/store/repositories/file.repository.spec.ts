import { describe, expect, it, mock } from 'bun:test';
import type { Mock } from 'bun:test';
import { FileRepository } from './file.repository';
import type { FileRecord } from './file.repository';
import type { DbConnection } from '../connection';

// ── Chainable drizzle mock ────────────────────────────────────────────────

function makeChainMock() {
  const chain: Record<string, Mock<any>> = {};
  for (const m of [
    'select', 'from', 'where', 'insert', 'values', 'onConflictDoUpdate',
    'delete', 'update', 'set',
  ]) {
    chain[m] = mock(() => chain);
  }
  chain['get'] = mock(() => null as unknown);
  chain['all'] = mock(() => [] as unknown[]);
  chain['run'] = mock(() => {});
  return chain;
}

function makeDbMock() {
  const chain = makeChainMock();
  const db = { drizzleDb: chain } as unknown as DbConnection;
  return { db, chain };
}

// ── Fixtures ──────────────────────────────────────────────────────────────

function makeFileRecord(overrides: Partial<FileRecord> = {}): FileRecord {
  return {
    project: 'test-project',
    filePath: 'src/index.ts',
    mtimeMs: 1_000_000,
    size: 100,
    contentHash: 'abc123',
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('FileRepository', () => {
  // 1. [HP] getFile returns FileRecord when drizzle.get() returns record
  it('should return FileRecord when getFile finds matching record', () => {
    const { db, chain } = makeDbMock();
    const record = makeFileRecord();
    chain['get']!.mockReturnValue(record as unknown);

    const repo = new FileRepository(db);
    const result = repo.getFile('test-project', 'src/index.ts');

    expect(result).toEqual(record);
    expect(chain['select']).toHaveBeenCalled();
    expect(chain['where']).toHaveBeenCalled();
    expect(chain['get']).toHaveBeenCalled();
  });

  // 2. [HP] upsertFile calls insert chain with all fields
  it('should call insert chain with all record fields when upsertFile is invoked', () => {
    const { db, chain } = makeDbMock();
    const record = makeFileRecord({ filePath: 'src/utils.ts', contentHash: 'xyz789' });

    const repo = new FileRepository(db);
    repo.upsertFile(record);

    expect(chain['insert']).toHaveBeenCalled();
    expect(chain['values']).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: 'src/utils.ts',
        contentHash: 'xyz789',
        project: 'test-project',
      }),
    );
    expect(chain['run']).toHaveBeenCalled();
  });

  // 3. [HP] getAllFiles returns array from drizzle.all()
  it('should return all file records when getAllFiles is called', () => {
    const { db, chain } = makeDbMock();
    const records = [makeFileRecord({ filePath: 'src/a.ts' }), makeFileRecord({ filePath: 'src/b.ts' })];
    chain['all']!.mockReturnValue(records as unknown[]);

    const repo = new FileRepository(db);
    const result = repo.getAllFiles('test-project');

    expect(result).toEqual(records);
    expect(chain['all']).toHaveBeenCalled();
  });

  // 4. [HP] getFilesMap with 3 records → Map with 3 entries keyed by filePath
  it('should return Map with 3 entries keyed by filePath when getFilesMap is called with 3 records', () => {
    const { db, chain } = makeDbMock();
    const records = [
      makeFileRecord({ filePath: 'src/a.ts' }),
      makeFileRecord({ filePath: 'src/b.ts' }),
      makeFileRecord({ filePath: 'src/c.ts' }),
    ];
    chain['all']!.mockReturnValue(records as unknown[]);

    const repo = new FileRepository(db);
    const map = repo.getFilesMap('test-project');

    expect(map.size).toBe(3);
    expect(map.get('src/a.ts')).toEqual(records[0]);
    expect(map.get('src/b.ts')).toEqual(records[1]);
    expect(map.get('src/c.ts')).toEqual(records[2]);
  });

  // 5. [HP] deleteFile calls delete chain
  it('should call delete chain when deleteFile is invoked', () => {
    const { db, chain } = makeDbMock();

    const repo = new FileRepository(db);
    repo.deleteFile('test-project', 'src/index.ts');

    expect(chain['delete']).toHaveBeenCalled();
    expect(chain['where']).toHaveBeenCalled();
    expect(chain['run']).toHaveBeenCalled();
  });

  // 6. [NE] getFile not found → drizzle returns undefined → returns null
  it('should return null when getFile does not find a matching record', () => {
    const { db, chain } = makeDbMock();
    chain['get']!.mockReturnValue(undefined as unknown);

    const repo = new FileRepository(db);
    const result = repo.getFile('test-project', 'src/missing.ts');

    expect(result).toBeNull();
  });

  // 7. [NE] getAllFiles no records → returns []
  it('should return empty array when getAllFiles finds no records', () => {
    const { db, chain } = makeDbMock();
    chain['all']!.mockReturnValue([]);

    const repo = new FileRepository(db);
    const result = repo.getAllFiles('unknown-project');

    expect(result).toEqual([]);
  });

  // 8. [ED] getFilesMap 0 records → returns empty Map (size 0)
  it('should return empty Map when getFilesMap finds no records', () => {
    const { db, chain } = makeDbMock();
    chain['all']!.mockReturnValue([]);

    const repo = new FileRepository(db);
    const map = repo.getFilesMap('test-project');

    expect(map.size).toBe(0);
    expect(map).toBeInstanceOf(Map);
  });

  // 9. [ED] getFilesMap 1 record → Map with exactly 1 entry
  it('should return Map with exactly 1 entry when getFilesMap receives 1 record', () => {
    const { db, chain } = makeDbMock();
    const record = makeFileRecord({ filePath: 'src/only.ts' });
    chain['all']!.mockReturnValue([record as unknown]);

    const repo = new FileRepository(db);
    const map = repo.getFilesMap('test-project');

    expect(map.size).toBe(1);
    expect(map.get('src/only.ts')).toEqual(record);
  });

  // 10. [CO] upsertFile then getFile on same repo — two sequential chain calls work
  it('should support sequential upsertFile then getFile calls on the same repository instance', () => {
    const { db, chain } = makeDbMock();
    const record = makeFileRecord();

    const repo = new FileRepository(db);
    repo.upsertFile(record); // uses insert chain

    chain['get']!.mockReturnValue(record as unknown);
    const fetched = repo.getFile('test-project', 'src/index.ts'); // uses select chain

    expect(fetched).toEqual(record);
    expect(chain['insert']).toHaveBeenCalled();
    expect(chain['select']).toHaveBeenCalled();
  });

  // 11. [ST] same FileRepository instance can call multiple methods sequentially
  it('should not throw when multiple methods are called on the same FileRepository instance', () => {
    const { db, chain } = makeDbMock();
    chain['all']!.mockReturnValue([makeFileRecord() as unknown]);

    const repo = new FileRepository(db);
    expect(() => repo.getAllFiles('test-project')).not.toThrow();
    expect(() => repo.deleteFile('test-project', 'src/index.ts')).not.toThrow();
    expect(() => repo.upsertFile(makeFileRecord())).not.toThrow();
  });
});
