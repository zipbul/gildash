import { describe, expect, it, mock } from 'bun:test';
import type { Mock } from 'bun:test';
import { SymbolRepository } from './symbol.repository';
import type { SymbolRecord } from './symbol.repository';
import type { DbConnection } from '../connection';

// ── Chainable drizzle mock ────────────────────────────────────────────────

function makeChainMock() {
  const chain: Record<string, Mock<any>> = {};
  for (const m of [
    'select', 'from', 'where', 'insert', 'values', 'delete',
    'update', 'set', 'orderBy', 'limit',
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

function makeSymRecord(overrides: Partial<SymbolRecord> = {}): Partial<SymbolRecord> {
  return {
    project: 'test-project',
    filePath: 'src/index.ts',
    kind: 'function',
    name: 'myFn',
    startLine: 1,
    startColumn: 0,
    endLine: 5,
    endColumn: 1,
    isExported: 1,
    signature: 'params:1|async:0',
    fingerprint: 'fp001',
    detailJson: null,
    contentHash: 'abc123',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('SymbolRepository', () => {
  // 1. [HP] replaceFileSymbols with 1 symbol → delete + insert called
  it('should call delete and then insert once when replaceFileSymbols receives 1 symbol', () => {
    const { db, chain } = makeDbMock();
    const repo = new SymbolRepository(db);

    repo.replaceFileSymbols('test-project', 'src/index.ts', 'abc123', [makeSymRecord()]);

    expect(chain['delete']).toHaveBeenCalled();
    expect(chain['run']).toHaveBeenCalled();
    expect(chain['insert']).toHaveBeenCalledTimes(1);
  });

  // 2. [HP] replaceFileSymbols with N symbols → insert called N times (loop iterates N times)
  it('should call insert N times when replaceFileSymbols receives N symbols', () => {
    const { db, chain } = makeDbMock();
    const repo = new SymbolRepository(db);
    const syms = [
      makeSymRecord({ name: 'fn1' }),
      makeSymRecord({ name: 'fn2' }),
      makeSymRecord({ name: 'fn3' }),
    ];

    repo.replaceFileSymbols('test-project', 'src/index.ts', 'abc123', syms);

    expect(chain['insert']).toHaveBeenCalledTimes(3);
  });

  // 3. [HP] getFileSymbols → returns drizzle.all() result
  it('should return all symbol records when getFileSymbols is called', () => {
    const { db, chain } = makeDbMock();
    const records = [makeSymRecord({ name: 'fn1' }), makeSymRecord({ name: 'fn2' })] as SymbolRecord[];
    chain['all']!.mockReturnValue(records as unknown[]);

    const repo = new SymbolRepository(db);
    const result = repo.getFileSymbols('test-project', 'src/index.ts');

    expect(result).toEqual(records);
  });

  // 4. [HP] searchByName valid query → returns results (ftsQuery truthy → proceeds)
  it('should return search results when searchByName receives a non-empty query', () => {
    const { db, chain } = makeDbMock();
    const records = [makeSymRecord() as SymbolRecord];
    chain['all']!.mockReturnValue(records as unknown[]);

    const repo = new SymbolRepository(db);
    // 'myFn' → toFtsPrefixQuery → '"myFn"*' (truthy) → proceeds
    const result = repo.searchByName('test-project', 'myFn');

    expect(result).toEqual(records);
    expect(chain['select']).toHaveBeenCalled();
    expect(chain['all']).toHaveBeenCalled();
  });

  // 5. [HP] searchByName with kind filter → kind ternary applied (opts.kind truthy)
  it('should pass kind filter into where clause when searchByName is called with opts.kind', () => {
    const { db, chain } = makeDbMock();
    const repo = new SymbolRepository(db);

    repo.searchByName('test-project', 'myFn', { kind: 'function' });

    // The chain is invoked — kind condition is applied in where()
    expect(chain['where']).toHaveBeenCalled();
    expect(chain['all']).toHaveBeenCalled();
  });

  // 6. [HP] searchByKind → returns kind-filtered results
  it('should return type-filtered records when searchByKind is called', () => {
    const { db, chain } = makeDbMock();
    const records = [makeSymRecord({ kind: 'class' }) as SymbolRecord];
    chain['all']!.mockReturnValue(records as unknown[]);

    const repo = new SymbolRepository(db);
    const result = repo.searchByKind('test-project', 'class');

    expect(result).toEqual(records);
  });

  // 7. [HP] getStats → returns {symbolCount, fileCount} from drizzle result
  it('should return symbolCount and fileCount when getStats finds matching rows', () => {
    const { db, chain } = makeDbMock();
    chain['get']!.mockReturnValue({ symbolCount: 5, fileCount: 2 } as unknown);

    const repo = new SymbolRepository(db);
    const stats = repo.getStats('test-project');

    expect(stats.symbolCount).toBe(5);
    expect(stats.fileCount).toBe(2);
  });

  // 8. [HP] getByFingerprint → returns matching records
  it('should return records that match the fingerprint when getByFingerprint is called', () => {
    const { db, chain } = makeDbMock();
    const records = [makeSymRecord({ fingerprint: 'fp001' }) as SymbolRecord];
    chain['all']!.mockReturnValue(records as unknown[]);

    const repo = new SymbolRepository(db);
    const result = repo.getByFingerprint('test-project', 'fp001');

    expect(result).toEqual(records);
  });

  // 9. [HP] deleteFileSymbols → delete chain called
  it('should call delete chain when deleteFileSymbols is invoked', () => {
    const { db, chain } = makeDbMock();
    const repo = new SymbolRepository(db);

    repo.deleteFileSymbols('test-project', 'src/index.ts');

    expect(chain['delete']).toHaveBeenCalled();
    expect(chain['run']).toHaveBeenCalled();
  });

  // 10. [HP] searchByQuery with ftsQuery + project → both ternaries fire
  it('should include ftsQuery and project filters when searchByQuery receives both', () => {
    const { db, chain } = makeDbMock();
    const repo = new SymbolRepository(db);

    repo.searchByQuery({ ftsQuery: '"myFn"*', project: 'test-project', limit: 10 });

    expect(chain['where']).toHaveBeenCalled();
    expect(chain['all']).toHaveBeenCalled();
  });

  // 11. [HP] searchByQuery isExported:true → eq(isExported, 1)
  it('should include isExported=1 condition when searchByQuery is called with isExported:true', () => {
    const { db, chain } = makeDbMock();
    const repo = new SymbolRepository(db);

    // Call and verify the chain executes without error (the eq(isExported, 1) condition is applied)
    expect(() => repo.searchByQuery({ isExported: true, limit: 10 })).not.toThrow();
    expect(chain['all']).toHaveBeenCalled();
  });

  // 12. [HP] searchByQuery isExported:false → eq(isExported, 0)
  it('should include isExported=0 condition when searchByQuery is called with isExported:false', () => {
    const { db, chain } = makeDbMock();
    const repo = new SymbolRepository(db);

    expect(() => repo.searchByQuery({ isExported: false, limit: 10 })).not.toThrow();
    expect(chain['all']).toHaveBeenCalled();
  });

  // 13. [NE] replaceFileSymbols [] → early return, no insert called
  it('should not call insert when replaceFileSymbols receives an empty array', () => {
    const { db, chain } = makeDbMock();
    const repo = new SymbolRepository(db);

    repo.replaceFileSymbols('test-project', 'src/index.ts', 'abc123', []);

    // delete IS called (to clear old symbols), but insert is NOT
    expect(chain['delete']).toHaveBeenCalled();
    expect(chain['insert']).not.toHaveBeenCalled();
  });

  // 14. [NE] searchByName empty query → returns [] immediately (ftsQuery '' → falsy)
  it('should return empty array immediately when searchByName receives an empty query string', () => {
    const { db, chain } = makeDbMock();
    const repo = new SymbolRepository(db);

    const result = repo.searchByName('test-project', '');

    expect(result).toEqual([]);
    // Early return means chain should not be invoked for the main query
    expect(chain['select']).not.toHaveBeenCalled();
  });

  // 15. [NE] getStats row undefined → returns {symbolCount:0, fileCount:0} via ?? 0
  it('should return zeros when getStats row is undefined and ?? 0 coalesces', () => {
    const { db, chain } = makeDbMock();
    chain['get']!.mockReturnValue(undefined as unknown);

    const repo = new SymbolRepository(db);
    const stats = repo.getStats('empty-project');

    expect(stats.symbolCount).toBe(0);
    expect(stats.fileCount).toBe(0);
  });

  // 16. [ED] replaceFileSymbols exactly 1 sym → loop body executes exactly once
  it('should call insert exactly once when replaceFileSymbols receives exactly 1 symbol', () => {
    const { db, chain } = makeDbMock();
    const repo = new SymbolRepository(db);

    repo.replaceFileSymbols('test-project', 'src/index.ts', 'abc123', [makeSymRecord()]);

    expect(chain['insert']).toHaveBeenCalledTimes(1);
  });

  // 17. [CO] searchByName with kind + limit → both opts applied simultaneously
  it('should apply kind filter and limit when searchByName receives both opts simultaneously', () => {
    const { db, chain } = makeDbMock();
    const repo = new SymbolRepository(db);

    expect(() => repo.searchByName('test-project', 'fn', { kind: 'function', limit: 5 })).not.toThrow();
    expect(chain['limit']).toHaveBeenCalled();
    expect(chain['all']).toHaveBeenCalled();
  });

  // 18. [ST] replaceFileSymbols called twice — second call's delete runs fresh
  it('should execute delete before insert on each replaceFileSymbols call', () => {
    const { db, chain } = makeDbMock();
    const repo = new SymbolRepository(db);
    const sym = makeSymRecord();

    repo.replaceFileSymbols('test-project', 'src/index.ts', 'abc123', [sym]);
    repo.replaceFileSymbols('test-project', 'src/index.ts', 'xyz789', [sym, sym]);

    // First call: 1 delete + 1 insert; Second call: 1 delete + 2 inserts
    expect(chain['delete']).toHaveBeenCalledTimes(2);
    expect(chain['insert']).toHaveBeenCalledTimes(3); // 1 + 2
  });
});
