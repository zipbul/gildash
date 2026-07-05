import { describe, it, expect } from 'bun:test';
import { EMPTY_MODULE, buildVirtualModule, memoizeByRaw } from './virtual-module';

describe('buildVirtualModule', () => {
  it('should yield an empty module with an empty map when there are no blocks', () => {
    const { parseText, map } = buildVirtualModule([]);

    expect(parseText).toBe(EMPTY_MODULE);
    expect(map.toRaw(0)).toBeNull();
  });

  it('should map a single block exactly onto its raw offset', () => {
    const { parseText, map } = buildVirtualModule([{ rawStart: 42, content: 'const a = 1;' }]);

    expect(parseText).toBe('const a = 1;');
    expect(map.toRaw(0)).toBe(42);
    expect(map.toRaw('const '.length)).toBe(42 + 'const '.length);
  });

  it('should join multiple blocks with a newline and map each to its own raw offset', () => {
    const { parseText, map } = buildVirtualModule([
      { rawStart: 10, content: 'const a = 1;' },
      { rawStart: 80, content: 'const b = 2;' },
    ]);

    expect(parseText).toBe('const a = 1;\nconst b = 2;');
    expect(map.toRaw(parseText.indexOf('a'))).toBe(10 + 'const '.length);
    expect(map.toRaw(parseText.indexOf('b'))).toBe(80 + 'const '.length);
  });

  it('should ignore a prelude when there are no blocks (empty module wins)', () => {
    const { parseText, map } = buildVirtualModule([], 'type T = unknown;\n');

    expect(parseText).toBe(EMPTY_MODULE);
    expect(map.toRaw(0)).toBeNull();
  });

  it('should prepend an UNMAPPED prelude so real block positions stay exact', () => {
    const prelude = 'type T = unknown;\n';
    const { parseText, map } = buildVirtualModule([{ rawStart: 5, content: 'let x: T;' }], prelude);

    // Prelude occupies the head of the virtual text but contributes no segment.
    expect(parseText.startsWith(prelude)).toBe(true);
    expect(map.toRaw(0)).toBeNull();
    // The block, separated from the prelude by a newline, still maps to raw.
    const blockVirtual = parseText.indexOf('let x: T;');
    expect(map.toRaw(blockVirtual)).toBe(5);
  });
});

describe('memoizeByRaw', () => {
  it('should compute once and reuse the result for the same raw input', () => {
    let calls = 0;
    const memoized = memoizeByRaw((raw: string) => { calls += 1; return raw.length; });

    expect(memoized('abc')).toBe(3);
    expect(memoized('abc')).toBe(3);
    expect(calls).toBe(1);
  });

  it('should recompute when the raw input changes', () => {
    let calls = 0;
    const memoized = memoizeByRaw((raw: string) => { calls += 1; return raw.length; });

    memoized('abc');
    memoized('abcd');
    memoized('abc'); // last input was 'abcd' — memo only caches the LAST input

    expect(calls).toBe(3);
  });
});
