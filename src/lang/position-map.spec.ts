import { describe, it, expect } from 'bun:test';
import { PositionMap } from './position-map';

/**
 * PositionMap maps offsets between a raw SFC file and its virtual TS text.
 * Virtual text is built from contiguous SLICES of the raw file, so mapping is
 * exact by construction (same encoding on both sides — no unit conversion).
 */
describe('PositionMap', () => {
  // raw:     0123456789...
  // virtual = raw[10..20) + raw[40..55)
  const map = new PositionMap([
    { rawStart: 10, virtualStart: 0, length: 10 },
    { rawStart: 40, virtualStart: 10, length: 15 },
  ]);

  it('should map a virtual offset back to its raw offset within a segment', () => {
    expect(map.toRaw(0)).toBe(10);
    expect(map.toRaw(9)).toBe(19);
    expect(map.toRaw(10)).toBe(40);
    expect(map.toRaw(24)).toBe(54);
  });

  it('should map a raw offset to its virtual offset within a segment', () => {
    expect(map.toVirtual(10)).toBe(0);
    expect(map.toVirtual(19)).toBe(9);
    expect(map.toVirtual(40)).toBe(10);
    expect(map.toVirtual(54)).toBe(24);
  });

  it('should return null for offsets outside every segment', () => {
    expect(map.toRaw(25)).toBeNull();
    expect(map.toVirtual(5)).toBeNull();
    expect(map.toVirtual(30)).toBeNull();
    expect(map.toVirtual(55)).toBeNull();
  });

  it('should map the exclusive end offset of a segment (span end semantics)', () => {
    // A span covering the whole first segment ends at virtual 10 — as an END
    // offset it must map to raw 20 (segment end), not the next segment's start.
    expect(map.toRawEnd(10)).toBe(20);
    expect(map.toVirtualEnd(20)).toBe(10);
    expect(map.toRawEnd(25)).toBe(55);
  });

  it('should return null for end offsets outside every segment', () => {
    expect(map.toRawEnd(26)).toBeNull(); // beyond the last virtual segment
    expect(map.toVirtualEnd(56)).toBeNull(); // beyond the last raw segment
    expect(map.toVirtualEnd(30)).toBeNull(); // end offset inside the raw gap [20, 40)
  });

  it('should round-trip every offset inside segments', () => {
    for (let v = 0; v < 25; v++) {
      const raw = map.toRaw(v)!;
      expect(map.toVirtual(raw)).toBe(v);
    }
  });

  it('should handle an identity-like single segment starting at zero', () => {
    const id = new PositionMap([{ rawStart: 0, virtualStart: 0, length: 100 }]);
    expect(id.toRaw(42)).toBe(42);
    expect(id.toVirtual(42)).toBe(42);
  });
});

describe('PositionMap — segment invariants', () => {
  it('should reject overlapping segments on the virtual axis', () => {
    expect(() => new PositionMap([
      { rawStart: 0, virtualStart: 0, length: 10 },
      { rawStart: 50, virtualStart: 5, length: 10 },
    ])).toThrow();
  });

  it('should reject overlapping segments on the raw axis', () => {
    expect(() => new PositionMap([
      { rawStart: 0, virtualStart: 0, length: 10 },
      { rawStart: 5, virtualStart: 20, length: 10 },
    ])).toThrow();
  });
});
