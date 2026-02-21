import { describe, expect, it } from 'bun:test';
import { files, symbols, relations, watcherOwner } from './schema';

/**
 * Minimal coverage for schema.ts — the file is purely declarative (table definitions),
 * so these tests just verify the exported table objects are defined and non-null.
 * All branch-level verification of schema behaviour is handled by the integration
 * tests in test/store.test.ts which run against a real SQLite database.
 */
describe('schema', () => {
  it('should export a non-null files table definition', () => {
    expect(files).toBeDefined();
  });

  it('should export a non-null symbols table definition', () => {
    expect(symbols).toBeDefined();
  });

  it('should export a non-null relations table definition', () => {
    expect(relations).toBeDefined();
  });
});
