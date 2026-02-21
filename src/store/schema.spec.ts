import { describe, expect, it } from 'bun:test';
import { files, symbols, relations, watcherOwner } from './schema';

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
