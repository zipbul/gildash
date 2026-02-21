import { describe, it, expect } from 'bun:test';
import { ParseCache } from './parse-cache';
import type { ParsedFile } from './types';

function makeParsedFile(filePath: string): ParsedFile {
  return {
    filePath,
    program: { type: 'Program', body: [], sourceType: 'module' } as any,
    errors: [],
    comments: [],
    sourceText: '',
  };
}

describe('ParseCache', () => {
  // HP
  it('should store and retrieve a ParsedFile when filePath is used as key', () => {
    // Arrange
    const cache = new ParseCache(10);
    const file = makeParsedFile('/project/a.ts');
    // Act
    cache.set('/project/a.ts', file);
    const result = cache.get('/project/a.ts');
    // Assert
    expect(result).toBe(file);
  });

  it('should return undefined when filePath was never set', () => {
    const cache = new ParseCache(10);
    expect(cache.get('/project/nonexistent.ts')).toBeUndefined();
  });

  it('should report size 0 when empty', () => {
    const cache = new ParseCache(10);
    expect(cache.size()).toBe(0);
  });

  it('should increment size when set is called', () => {
    const cache = new ParseCache(10);
    cache.set('/project/a.ts', makeParsedFile('/project/a.ts'));
    expect(cache.size()).toBe(1);
  });

  it('should overwrite existing entry when set is called with duplicate key', () => {
    const cache = new ParseCache(10);
    const first = makeParsedFile('/project/a.ts');
    const second = makeParsedFile('/project/a.ts');
    cache.set('/project/a.ts', first);
    cache.set('/project/a.ts', second);
    expect(cache.get('/project/a.ts')).toBe(second);
    expect(cache.size()).toBe(1);
  });

  // NE — invalidate
  it('should return undefined when entry is invalidated', () => {
    const cache = new ParseCache(10);
    cache.set('/project/a.ts', makeParsedFile('/project/a.ts'));
    cache.invalidate('/project/a.ts');
    expect(cache.get('/project/a.ts')).toBeUndefined();
  });

  it('should not throw when invalidating a non-existent entry', () => {
    const cache = new ParseCache(10);
    expect(() => cache.invalidate('/project/nonexistent.ts')).not.toThrow();
  });

  // NE — invalidateAll
  it('should clear all entries when invalidateAll is called', () => {
    const cache = new ParseCache(10);
    cache.set('/project/a.ts', makeParsedFile('/project/a.ts'));
    cache.set('/project/b.ts', makeParsedFile('/project/b.ts'));
    cache.invalidateAll();
    expect(cache.size()).toBe(0);
    expect(cache.get('/project/a.ts')).toBeUndefined();
    expect(cache.get('/project/b.ts')).toBeUndefined();
  });

  // ED — capacity eviction
  it('should evict the least recently used entry when capacity is exceeded', () => {
    const cache = new ParseCache(2);
    const a = makeParsedFile('/project/a.ts');
    const b = makeParsedFile('/project/b.ts');
    const c = makeParsedFile('/project/c.ts');
    cache.set('/project/a.ts', a);
    cache.set('/project/b.ts', b);
    // Access a to make it recently used
    cache.get('/project/a.ts');
    // Adding c should evict b (LRU)
    cache.set('/project/c.ts', c);
    expect(cache.get('/project/b.ts')).toBeUndefined();
    expect(cache.get('/project/a.ts')).toBe(a);
    expect(cache.get('/project/c.ts')).toBe(c);
  });

  it('should retain only the most recent entry when capacity is 1', () => {
    const cache = new ParseCache(1);
    const a = makeParsedFile('/project/a.ts');
    const b = makeParsedFile('/project/b.ts');
    cache.set('/project/a.ts', a);
    cache.set('/project/b.ts', b);
    expect(cache.get('/project/a.ts')).toBeUndefined();
    expect(cache.get('/project/b.ts')).toBe(b);
  });

  // ST
  it('should allow re-insertion when entry is invalidated first', () => {
    const cache = new ParseCache(10);
    const original = makeParsedFile('/project/a.ts');
    cache.set('/project/a.ts', original);
    cache.invalidate('/project/a.ts');
    const updated = makeParsedFile('/project/a.ts');
    cache.set('/project/a.ts', updated);
    expect(cache.get('/project/a.ts')).toBe(updated);
  });

  it('should allow re-use when cache was reset with invalidateAll', () => {
    const cache = new ParseCache(10);
    cache.set('/project/a.ts', makeParsedFile('/project/a.ts'));
    cache.invalidateAll();
    const fresh = makeParsedFile('/project/a.ts');
    cache.set('/project/a.ts', fresh);
    expect(cache.get('/project/a.ts')).toBe(fresh);
    expect(cache.size()).toBe(1);
  });

  // ID
  it('should return the same value when get is called repeatedly', () => {
    const cache = new ParseCache(10);
    const file = makeParsedFile('/project/a.ts');
    cache.set('/project/a.ts', file);
    expect(cache.get('/project/a.ts')).toBe(cache.get('/project/a.ts'));
  });
});
