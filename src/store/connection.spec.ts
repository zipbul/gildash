import { beforeEach, describe, expect, it, mock } from 'bun:test';

// ── Module-level mock state ────────────────────────────────────────────────
// Controls per-test Database constructor behavior without hand-rolled counters.
// Call counts are verified via bun:test mock APIs (toHaveBeenCalledTimes).

let dbErrors: Array<Error | null> = [null];
let dbCallIdx = 0;
// eslint-disable-next-line prefer-const
let lastDbInst: InstanceType<typeof MockDatabase> | null = null;

const mockMkdirSync = mock((path: string, opts?: unknown) => {});
const mockExistsSync = mock((path: string): boolean => true);
const mockUnlinkSync = mock((path: string) => {});

const mockDrizzleDb: Record<string, ReturnType<typeof mock>> = (() => {
  const chain: Record<string, ReturnType<typeof mock>> = {};
  for (const m of ['select', 'from', 'where', 'insert', 'values', 'delete', 'update', 'set', 'get', 'all', 'run']) {
    chain[m] = mock(() => chain as unknown);
  }
  chain['get'] = mock(() => null as unknown);
  chain['all'] = mock(() => [] as unknown[]);
  chain['run'] = mock(() => {});
  return chain;
})();

const mockDrizzleFn = mock((client: unknown, opts?: unknown) => mockDrizzleDb);
const mockMigrateFn = mock((db: unknown, opts?: unknown) => {});

// ── Module mocks (bun:test hoists these before static imports) ─────────────

mock.module('node:fs', () => ({
  mkdirSync: mockMkdirSync,
  existsSync: mockExistsSync,
  unlinkSync: mockUnlinkSync,
}));

mock.module('drizzle-orm/bun-sqlite', () => ({
  drizzle: mockDrizzleFn,
}));

mock.module('drizzle-orm/bun-sqlite/migrator', () => ({
  migrate: mockMigrateFn,
}));

class MockDatabase {
  readonly close = mock(() => {});
  readonly run = mock((sql: string) => {});
  readonly query = mock((sql: string) => ({ all: mock(() => [] as unknown[]) }));
  readonly transaction = mock((fn: Function) => () => fn());
  prepare(sql: string) {
    return {
      run: mock((...args: unknown[]) => {}),
      get: mock((...args: unknown[]) => null as unknown),
      all: mock((...args: unknown[]) => [] as unknown[]),
    };
  }
  constructor(path: string) {
    const idx = dbCallIdx++;
    const err = dbErrors[idx] ?? null;
    // Cast to allow assignment in constructor
    (this.constructor as unknown as { lastInst: MockDatabase }).lastInst = this;
    lastDbInst = this;
    if (err) throw err;
  }
}

mock.module('bun:sqlite', () => ({ Database: MockDatabase }));

// Static import after mock.module registration (bun hoists mock.module above imports)
import { DbConnection } from './connection';
import { StoreError } from '../errors';

// ── Helpers ────────────────────────────────────────────────────────────────

beforeEach(() => {
  dbCallIdx = 0;
  dbErrors = [null]; // default: first call succeeds
  lastDbInst = null;
  // Clear call history only — preserve original implementations
  mockMkdirSync.mockClear();
  mockExistsSync.mockClear();
  mockUnlinkSync.mockClear();
  mockDrizzleFn.mockClear();
  mockMigrateFn.mockClear();
  // Re-set implementations in case a previous test overrode them
  mockExistsSync.mockImplementation((_: string) => true);
  mockDrizzleFn.mockImplementation((client: unknown, opts?: unknown) => mockDrizzleDb);
  mockMigrateFn.mockImplementation(() => {});
  // test/setup.ts global afterEach restores node:fs after each test.
  // Re-apply the mock so our mockMkdirSync/mockExistsSync/mockUnlinkSync stay active.
  mock.module('node:fs', () => ({
    mkdirSync: mockMkdirSync,
    existsSync: mockExistsSync,
    unlinkSync: mockUnlinkSync,
  }));
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe('DbConnection', () => {
  // 1. [HP] open() succeeds → mkdirSync called, Database constructor called (via lastDbInst), migrate called
  it('should call mkdirSync and migrate when open() succeeds normally', () => {
    const db = new DbConnection({ projectRoot: '/fake' });
    db.open();

    expect(mockMkdirSync).toHaveBeenCalledTimes(1);
    expect(mockDrizzleFn).toHaveBeenCalledTimes(1);
    expect(mockMigrateFn).toHaveBeenCalledTimes(1);
    expect(lastDbInst).not.toBeNull();
  });

  // 2. [HP] close() calls client.close()
  it('should call client.close() when DbConnection.close() is invoked', () => {
    const db = new DbConnection({ projectRoot: '/fake' });
    db.open();
    const capturedInst = lastDbInst!;

    db.close();

    expect(capturedInst.close).toHaveBeenCalledTimes(1);
  });

  // 3. [HP] transaction() depth=0 → calls bun native .transaction() on client
  it('should invoke the bun-native client.transaction() when txDepth is 0', () => {
    const db = new DbConnection({ projectRoot: '/fake' });
    db.open();
    const capturedInst = lastDbInst!;
    const fn = mock((tx: DbConnection) => 'result');

    const result = db.transaction(fn);

    expect(result).toBe('result');
    expect(capturedInst.transaction).toHaveBeenCalled();
  });

  // 4. [HP] transaction() fn return value propagated
  it('should return the fn return value when transaction() succeeds', () => {
    const db = new DbConnection({ projectRoot: '/fake' });
    db.open();

    const actual = db.transaction(() => 42);

    expect(actual).toBe(42);
  });

  // 5. [HP] immediateTransaction() success → fn result returned
  it('should return the fn result when immediateTransaction() fn succeeds', () => {
    const db = new DbConnection({ projectRoot: '/fake' });
    db.open();
    // immediateTransaction calls client.run('BEGIN IMMEDIATE') then fn()

    const result = db.immediateTransaction(() => 'imt-result');

    expect(result).toBe('imt-result');
  });

  // 6. [NE] open() throws 'malformed database schema' → retries (MISS-5: 'malformed')
  it('should retry open() when Database throws containing "malformed" error message', () => {
    dbErrors = [new Error('malformed database schema'), null];

    const db = new DbConnection({ projectRoot: '/fake' });
    expect(() => db.open()).not.toThrow();

    expect(mockMkdirSync).toHaveBeenCalledTimes(2); // initial + retry
    expect(mockUnlinkSync).toHaveBeenCalled();
    expect(mockDrizzleFn).toHaveBeenCalledTimes(1); // only on success
  });

  // 7. [NE] open() throws 'corrupt' → retries (MISS-5: 'corrupt')
  it('should retry open() when Database throws containing "corrupt" error message', () => {
    dbErrors = [new Error('database disk image is corrupt'), null];

    const db = new DbConnection({ projectRoot: '/fake' });
    expect(() => db.open()).not.toThrow();

    expect(mockMkdirSync).toHaveBeenCalledTimes(2);
    expect(mockUnlinkSync).toHaveBeenCalled();
  });

  // 8. [NE] open() throws 'not a database' → retries (MISS-5: 'not a database')
  it('should retry open() when Database throws containing "not a database" error message', () => {
    dbErrors = [new Error('file is not a database'), null];

    const db = new DbConnection({ projectRoot: '/fake' });
    expect(() => db.open()).not.toThrow();

    expect(mockMkdirSync).toHaveBeenCalledTimes(2);
    expect(mockUnlinkSync).toHaveBeenCalled();
  });

  // 9. [NE] open() throws 'disk i/o error' → retries (MISS-5: 'disk i/o error')
  it('should retry open() when Database throws containing "disk i/o error" error message', () => {
    dbErrors = [new Error('disk I/O error during read'), null];

    const db = new DbConnection({ projectRoot: '/fake' });
    expect(() => db.open()).not.toThrow();

    expect(mockMkdirSync).toHaveBeenCalledTimes(2);
    expect(mockUnlinkSync).toHaveBeenCalled();
  });

  // 10. [NE] open() throws 'sqlite_corrupt' → retries (MISS-5: 'sqlite_corrupt')
  it('should retry open() when Database throws containing "sqlite_corrupt" error message', () => {
    dbErrors = [new Error('SQLITE_CORRUPT: malformed result'), null];

    const db = new DbConnection({ projectRoot: '/fake' });
    expect(() => db.open()).not.toThrow();

    expect(mockMkdirSync).toHaveBeenCalledTimes(2);
    expect(mockUnlinkSync).toHaveBeenCalled();
  });

  // 11. [NE] open() non-corruption error → propagates without retry
  it('should propagate as StoreError without retry when Database throws a non-corruption error', () => {
    dbErrors = [new Error('ENOMEM: out of memory')];

    const db = new DbConnection({ projectRoot: '/fake' });
    expect(() => db.open()).toThrow(StoreError);

    // Only one mkdirSync call (no retry)
    expect(mockMkdirSync).toHaveBeenCalledTimes(1);
    expect(mockUnlinkSync).not.toHaveBeenCalled();
  });

  // 12. [NE] immediateTransaction() fn throws → ROLLBACK + error rethrown
  it('should rollback and rethrow when immediateTransaction() fn throws', () => {
    const db = new DbConnection({ projectRoot: '/fake' });
    db.open();
    const capturedInst = lastDbInst!;

    expect(() => db.immediateTransaction(() => { throw new Error('tx error'); })).toThrow('tx error');

    const runs = (capturedInst.run.mock.calls as [string][]).map(([sql]) => sql);
    expect(runs.some((sql) => sql?.includes('ROLLBACK'))).toBe(true);
  });

  // 13. [ED] open() corruption + existsSync=false for db path → no retry, StoreError thrown
  it('should throw StoreError without retry when db file does not exist during corruption recovery', () => {
    dbErrors = [new Error('malformed database schema')];
    // existsSync returns false for ALL paths → no recovery
    mockExistsSync.mockImplementation((_: string) => false);

    const db = new DbConnection({ projectRoot: '/fake' });
    expect(() => db.open()).toThrow(StoreError);

    expect(mockUnlinkSync).not.toHaveBeenCalled();
    expect(mockMkdirSync).toHaveBeenCalledTimes(1); // no retry
  });

  // 14. [ED] open() corruption recovery complete → no error, second Database created (MISS-6)
  it('should recover from corruption by deleting the file and retrying open() successfully', () => {
    dbErrors = [new Error('corrupt: database image is malformed'), null];

    const db = new DbConnection({ projectRoot: '/fake' });
    expect(() => db.open()).not.toThrow();

    // db file deleted during recovery
    expect(mockUnlinkSync).toHaveBeenCalled();
    // retry: mkdirSync + Database ctor called twice total
    expect(mockMkdirSync).toHaveBeenCalledTimes(2);
    // drizzle + migrate called once (on successful retry)
    expect(mockDrizzleFn).toHaveBeenCalledTimes(1);
    expect(mockMigrateFn).toHaveBeenCalledTimes(1);
  });

  // 15. [CO] transaction() nested (depth > 0) → SAVEPOINT SQL executed
  it('should use SAVEPOINT when transaction() is called while already inside a transaction', () => {
    const db = new DbConnection({ projectRoot: '/fake' });
    db.open();
    const capturedInst = lastDbInst!;

    db.transaction((tx) => {
      // txDepth is 1 here → nested call takes the SAVEPOINT path
      tx.transaction(() => 'inner-result');
      return 'outer-result';
    });

    const runs = (capturedInst.run.mock.calls as [string][]).map(([sql]) => sql);
    expect(runs.some((sql) => sql?.includes('SAVEPOINT'))).toBe(true);
  });
});
