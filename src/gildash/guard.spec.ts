import { describe, it, expect } from 'bun:test';
import { GildashError } from '../errors';
import type { GildashContext } from './context';
import { assertOpen, guard, guardAsync } from './guard';

function ctx(closed: boolean): GildashContext {
  return { closed } as GildashContext;
}

describe('assertOpen', () => {
  it('should return normally when the instance is open', () => {
    expect(() => assertOpen(ctx(false))).not.toThrow();
  });

  it('should throw a GildashError of type "closed" when the instance is closed', () => {
    try {
      assertOpen(ctx(true));
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GildashError);
      expect((e as GildashError).type).toBe('closed');
    }
  });
});

describe('guard', () => {
  it('should run fn and return its value when open', () => {
    expect(guard(ctx(false), 'search', 'op', () => 42)).toBe(42);
  });

  it('should reject use after close before running fn', () => {
    let ran = false;
    expect(() => guard(ctx(true), 'search', 'op', () => { ran = true; return 1; })).toThrow(GildashError);
    expect(ran).toBe(false);
  });

  it('should wrap a raw thrown error as a GildashError of the given type with "<op> failed"', () => {
    const raw = new Error('boom');
    try {
      guard(ctx(false), 'store', 'doThing', () => { throw raw; });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GildashError);
      expect((e as GildashError).type).toBe('store');
      expect((e as GildashError).message).toBe('Gildash: doThing failed');
      expect((e as GildashError).cause).toBe(raw);
    }
  });

  it('should pass a thrown GildashError through untouched', () => {
    const original = new GildashError('validation', 'nope');
    expect(() => guard(ctx(false), 'store', 'doThing', () => { throw original; })).toThrow(original);
  });
});

describe('guardAsync', () => {
  it('should await fn and return its resolved value when open', async () => {
    expect(await guardAsync(ctx(false), 'search', 'op', async () => 7)).toBe(7);
  });

  it('should reject use after close', async () => {
    await expect(guardAsync(ctx(true), 'search', 'op', async () => 1)).rejects.toThrow(GildashError);
  });

  it('should wrap a rejected raw error as a GildashError of the given type', async () => {
    const raw = new Error('async boom');
    try {
      await guardAsync(ctx(false), 'index', 'reindex', async () => { throw raw; });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GildashError);
      expect((e as GildashError).type).toBe('index');
      expect((e as GildashError).message).toBe('Gildash: reindex failed');
      expect((e as GildashError).cause).toBe(raw);
    }
  });

  it('should pass a rejected GildashError through untouched', async () => {
    const original = new GildashError('semantic', 'nope');
    await expect(guardAsync(ctx(false), 'index', 'reindex', async () => { throw original; })).rejects.toThrow(original);
  });
});
