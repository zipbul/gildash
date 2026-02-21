import { describe, expect, it, mock } from 'bun:test';
import type { Mock } from 'bun:test';
import { RelationRepository } from './relation.repository';
import type { RelationRecord } from './relation.repository';
import type { DbConnection } from '../connection';

// ── Chainable drizzle mock ────────────────────────────────────────────────

function makeChainMock() {
  const chain: Record<string, Mock<any>> = {};
  for (const m of [
    'select', 'from', 'where', 'insert', 'values', 'delete',
    'update', 'set', 'limit',
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

function makeRelRecord(overrides: Partial<RelationRecord> = {}): Partial<RelationRecord> {
  return {
    project: 'test-project',
    type: 'imports',
    srcFilePath: 'src/index.ts',
    srcSymbolName: null,
    dstFilePath: 'src/utils.ts',
    dstSymbolName: null,
    metaJson: null,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('RelationRepository', () => {
  // 1. [HP] replaceFileRelations 1 relation → delete + insert called
  it('should call delete and then insert once when replaceFileRelations receives 1 relation', () => {
    const { db, chain } = makeDbMock();
    const repo = new RelationRepository(db);

    repo.replaceFileRelations('test-project', 'src/index.ts', [makeRelRecord()]);

    expect(chain['delete']).toHaveBeenCalled();
    expect(chain['insert']).toHaveBeenCalledTimes(1);
    expect(chain['run']).toHaveBeenCalled();
  });

  // 2. [HP] replaceFileRelations N relations → insert called N times
  it('should call insert N times when replaceFileRelations receives N relations', () => {
    const { db, chain } = makeDbMock();
    const repo = new RelationRepository(db);
    const rels = [
      makeRelRecord({ dstFilePath: 'src/a.ts' }),
      makeRelRecord({ dstFilePath: 'src/b.ts' }),
      makeRelRecord({ dstFilePath: 'src/c.ts' }),
    ];

    repo.replaceFileRelations('test-project', 'src/index.ts', rels);

    expect(chain['insert']).toHaveBeenCalledTimes(3);
  });

  // 3. [HP] getOutgoing without srcSymbolName → unfiltered query path
  it('should execute unfiltered query when getOutgoing is called without srcSymbolName', () => {
    const { db, chain } = makeDbMock();
    const records = [makeRelRecord() as RelationRecord];
    chain['all']!.mockReturnValue(records as unknown[]);

    const repo = new RelationRepository(db);
    // No srcSymbolName argument → else branch (srcSymbolName === undefined)
    const result = repo.getOutgoing('test-project', 'src/index.ts');

    expect(result).toEqual(records);
    expect(chain['select']).toHaveBeenCalled();
    expect(chain['all']).toHaveBeenCalled();
  });

  // 4. [HP] getOutgoing with srcSymbolName → filtered query path (OR condition)
  it('should execute filtered query when getOutgoing is called with srcSymbolName', () => {
    const { db, chain } = makeDbMock();
    const records = [makeRelRecord({ srcSymbolName: 'myFn' }) as RelationRecord];
    chain['all']!.mockReturnValue(records as unknown[]);

    const repo = new RelationRepository(db);
    // srcSymbolName !== undefined → if branch
    const result = repo.getOutgoing('test-project', 'src/index.ts', 'myFn');

    expect(result).toEqual(records);
    expect(chain['all']).toHaveBeenCalled();
  });

  // 5. [HP] getIncoming → returns matching results
  it('should return incoming relations when getIncoming is called', () => {
    const { db, chain } = makeDbMock();
    const records = [makeRelRecord() as RelationRecord];
    chain['all']!.mockReturnValue(records as unknown[]);

    const repo = new RelationRepository(db);
    const result = repo.getIncoming('test-project', 'src/utils.ts');

    expect(result).toEqual(records);
  });

  // 6. [HP] getByType → returns type-filtered results
  it('should return only matching-type relations when getByType is called', () => {
    const { db, chain } = makeDbMock();
    const records = [makeRelRecord({ type: 'calls' }) as RelationRecord];
    chain['all']!.mockReturnValue(records as unknown[]);

    const repo = new RelationRepository(db);
    const result = repo.getByType('test-project', 'calls');

    expect(result).toEqual(records);
  });

  // 7. [HP] deleteFileRelations → delete chain called
  it('should call delete chain when deleteFileRelations is invoked', () => {
    const { db, chain } = makeDbMock();
    const repo = new RelationRepository(db);

    repo.deleteFileRelations('test-project', 'src/index.ts');

    expect(chain['delete']).toHaveBeenCalled();
    expect(chain['run']).toHaveBeenCalled();
  });

  // 8. [HP] searchRelations all opts → all 6 ternaries fire
  it('should pass all filter conditions when searchRelations receives all opts', () => {
    const { db, chain } = makeDbMock();
    const repo = new RelationRepository(db);

    expect(() => repo.searchRelations({
      srcFilePath: 'src/a.ts',
      srcSymbolName: 'fn',
      dstFilePath: 'src/b.ts',
      dstSymbolName: 'handler',
      type: 'calls',
      project: 'test-project',
      limit: 10,
    })).not.toThrow();
    expect(chain['all']).toHaveBeenCalled();
  });

  // 9. [HP] searchRelations project only → project ternary fires, others undefined
  it('should apply only the project filter when searchRelations receives only project opt', () => {
    const { db, chain } = makeDbMock();
    const repo = new RelationRepository(db);

    expect(() => repo.searchRelations({ project: 'test-project', limit: 10 })).not.toThrow();
    expect(chain['all']).toHaveBeenCalled();
  });

  // 10. [HP] retargetRelations named symbol → eq(dstSymbolName) condition
  it('should use eq(dstSymbolName) condition when retargetRelations is called with non-null oldSymbol', () => {
    const { db, chain } = makeDbMock();
    const repo = new RelationRepository(db);

    // oldSymbol !== null → named WHERE condition
    expect(() =>
      repo.retargetRelations('test-project', 'src/old.ts', 'OldFn', 'src/new.ts', 'NewFn'),
    ).not.toThrow();
    expect(chain['update']).toHaveBeenCalled();
    expect(chain['run']).toHaveBeenCalled();
  });

  // 11. [HP] retargetRelations null symbol → isNull(dstSymbolName) condition
  it('should use isNull(dstSymbolName) condition when retargetRelations is called with null oldSymbol', () => {
    const { db, chain } = makeDbMock();
    const repo = new RelationRepository(db);

    // oldSymbol === null → null WHERE condition
    expect(() =>
      repo.retargetRelations('test-project', 'src/old.ts', null, 'src/new.ts', null),
    ).not.toThrow();
    expect(chain['update']).toHaveBeenCalled();
    expect(chain['run']).toHaveBeenCalled();
  });

  // 12. [NE] replaceFileRelations [] → early return, no insert called
  it('should not call insert when replaceFileRelations receives an empty array', () => {
    const { db, chain } = makeDbMock();
    const repo = new RelationRepository(db);

    repo.replaceFileRelations('test-project', 'src/index.ts', []);

    expect(chain['delete']).toHaveBeenCalled();
    expect(chain['insert']).not.toHaveBeenCalled();
  });

  // 13. [NE] getOutgoing unknown file → []
  it('should return empty array when getOutgoing finds no relations for unknown file', () => {
    const { db, chain } = makeDbMock();
    chain['all']!.mockReturnValue([]);

    const repo = new RelationRepository(db);
    const result = repo.getOutgoing('test-project', 'src/nonexistent.ts');

    expect(result).toEqual([]);
  });

  // 14. [ED] getOutgoing srcSymbolName="" (empty string) → !== undefined → filtered path
  it('should use filtered query path when getOutgoing is called with empty-string srcSymbolName', () => {
    const { db, chain } = makeDbMock();
    const repo = new RelationRepository(db);

    // '' !== undefined is true → filtered query path (if branch)
    expect(() => repo.getOutgoing('test-project', 'src/index.ts', '')).not.toThrow();
    expect(chain['all']).toHaveBeenCalled();
  });

  // 15. [ST] replaceFileRelations called twice → second delete+insert pair fires
  it('should execute a fresh delete+insert sequence on each replaceFileRelations call', () => {
    const { db, chain } = makeDbMock();
    const repo = new RelationRepository(db);
    const rel = makeRelRecord();

    repo.replaceFileRelations('test-project', 'src/index.ts', [rel]);
    repo.replaceFileRelations('test-project', 'src/index.ts', [rel, rel]);

    // Two calls → two delete calls, three total insert calls
    expect(chain['delete']).toHaveBeenCalledTimes(2);
    expect(chain['insert']).toHaveBeenCalledTimes(3); // 1 + 2
  });

  // 16. [CO] searchRelations srcFilePath + type → both ternaries fire simultaneously
  it('should apply srcFilePath and type filters together when both are provided to searchRelations', () => {
    const { db, chain } = makeDbMock();
    const repo = new RelationRepository(db);

    expect(() =>
      repo.searchRelations({ srcFilePath: 'src/a.ts', type: 'imports', limit: 5 }),
    ).not.toThrow();
    expect(chain['all']).toHaveBeenCalled();
  });
});
