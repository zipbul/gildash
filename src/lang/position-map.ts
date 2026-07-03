/**
 * position-map — exact offset mapping between a raw framework file (e.g. `.vue`)
 * and the virtual TS text extracted from it.
 *
 * The virtual text is a concatenation of contiguous **slices** of the raw file
 * (script blocks), so every mapped offset is exact by construction and encoding-
 * agnostic: both sides index the same character sequence, no unit conversion.
 *
 * Offsets outside every segment (template markup, block boundaries) map to
 * `null` — callers degrade explicitly rather than receiving approximate
 * positions (span APIs require exact offsets).
 */

export interface PositionSegment {
  /** Offset of this slice's first character in the RAW file. */
  rawStart: number;
  /** Offset of this slice's first character in the VIRTUAL text. */
  virtualStart: number;
  /** Slice length (identical on both sides). */
  length: number;
}

export class PositionMap {
  /** Segments sorted by virtualStart (equivalently rawStart — slices are ordered). */
  readonly #segments: PositionSegment[];

  constructor(segments: PositionSegment[]) {
    this.#segments = [...segments].sort((a, b) => a.virtualStart - b.virtualStart);
    // Invariant: segments are disjoint on BOTH axes — overlap would make the
    // mapping ambiguous and silently corrupt every downstream position.
    const byRaw = [...this.#segments].sort((a, b) => a.rawStart - b.rawStart);
    for (let i = 1; i < this.#segments.length; i++) {
      const pv = this.#segments[i - 1]!;
      const cv = this.#segments[i]!;
      if (cv.virtualStart < pv.virtualStart + pv.length) {
        throw new Error('PositionMap: overlapping segments on the virtual axis');
      }
      const pr = byRaw[i - 1]!;
      const cr = byRaw[i]!;
      if (cr.rawStart < pr.rawStart + pr.length) {
        throw new Error('PositionMap: overlapping segments on the raw axis');
      }
    }
  }

  /** Virtual offset → raw offset. `null` when the offset lies in no segment. */
  toRaw(virtualOffset: number): number | null {
    const seg = this.#segments.find(
      (s) => virtualOffset >= s.virtualStart && virtualOffset < s.virtualStart + s.length,
    );
    return seg ? seg.rawStart + (virtualOffset - seg.virtualStart) : null;
  }

  /** Raw offset → virtual offset. `null` when the offset lies in no segment. */
  toVirtual(rawOffset: number): number | null {
    const seg = this.#segments.find(
      (s) => rawOffset >= s.rawStart && rawOffset < s.rawStart + s.length,
    );
    return seg ? seg.virtualStart + (rawOffset - seg.rawStart) : null;
  }

  /**
   * Virtual END offset (exclusive) → raw end offset. An end offset may equal a
   * segment's exclusive upper bound, which `toRaw` would reject.
   */
  toRawEnd(virtualEnd: number): number | null {
    const seg = this.#segments.find(
      (s) => virtualEnd > s.virtualStart && virtualEnd <= s.virtualStart + s.length,
    );
    return seg ? seg.rawStart + (virtualEnd - seg.virtualStart) : null;
  }

  /** Raw END offset (exclusive) → virtual end offset. */
  toVirtualEnd(rawEnd: number): number | null {
    const seg = this.#segments.find(
      (s) => rawEnd > s.rawStart && rawEnd <= s.rawStart + s.length,
    );
    return seg ? seg.virtualStart + (rawEnd - seg.rawStart) : null;
  }
}
