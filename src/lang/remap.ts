/**
 * remap — store-boundary span translation for plugin-transformed files.
 *
 * The extractor computes line/column spans over the VIRTUAL parse text; the DB
 * and every public surface hold RAW file coordinates (the position invariant).
 * This is the single conversion choke point on the indexing side: virtual
 * line/column → virtual offset → {@link PositionMap} → raw offset → raw
 * line/column. Spans that fall outside every mapped segment (synthetic text,
 * e.g. the empty-module placeholder) return `null` — callers skip those records
 * rather than storing approximate positions.
 */

import { buildLineOffsets, getLineColumn } from '../parser/source-position';
import type { SourceSpan } from '../parser/types';
import type { PositionMap } from './position-map';

export type SpanRemapper = (span: SourceSpan) => SourceSpan | null;

/** Inverse of `getLineColumn`: 1-based line / 0-based column → offset. */
function toOffset(lineOffsets: number[], line: number, column: number): number | null {
  const lineStart = lineOffsets[line - 1];
  return lineStart === undefined ? null : lineStart + column;
}

export function createSpanRemapper(
  map: PositionMap,
  virtualText: string,
  rawText: string,
): SpanRemapper {
  const virtualLines = buildLineOffsets(virtualText);
  const rawLines = buildLineOffsets(rawText);

  return (span) => {
    const startVirtual = toOffset(virtualLines, span.start.line, span.start.column);
    const endVirtual = toOffset(virtualLines, span.end.line, span.end.column);
    if (startVirtual === null || endVirtual === null) return null;

    const startRaw = map.toRaw(startVirtual);
    const endRaw = map.toRawEnd(endVirtual);
    if (startRaw === null || endRaw === null) return null;

    return {
      start: getLineColumn(rawLines, startRaw),
      end: getLineColumn(rawLines, endRaw),
    };
  };
}
