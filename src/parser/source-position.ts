import type { SourcePosition } from './types';

/**
 * Builds a lookup table of character offsets where each line starts.
 * Called ONCE per file for O(1) setup; subsequent getLineColumn calls are O(log n).
 *
 * @param sourceText - The full source text of a file.
 * @returns Array where index i holds the character offset at which line (i+1) begins.
 */
export function buildLineOffsets(sourceText: string): number[] {
  const offsets: number[] = [0];
  for (let i = 0; i < sourceText.length; i++) {
    if (sourceText[i] === '\n') {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

/**
 * Converts a character offset into a 1-based line and 0-based column position
 * using a pre-built line offsets table (binary search).
 *
 * @param offsets - Table produced by buildLineOffsets().
 * @param offset  - Character offset within the source text.
 * @returns { line, column } with 1-based line and 0-based column.
 */
export function getLineColumn(offsets: number[], offset: number): SourcePosition {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid]! <= offset) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return { line: lo + 1, column: offset - offsets[lo]! };
}
