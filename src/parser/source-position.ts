import type { SourcePosition } from './types';

export function buildLineOffsets(sourceText: string): number[] {
  const offsets: number[] = [0];
  for (let i = 0; i < sourceText.length; i++) {
    if (sourceText[i] === '\n') {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

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
