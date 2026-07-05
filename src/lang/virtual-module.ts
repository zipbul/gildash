/**
 * virtual-module — shared assembly of a virtual TS module from raw script blocks.
 *
 * Language plugins (Vue SFC, Svelte) differ only in HOW they locate script blocks
 * in a raw file; once located, concatenating those raw slices into one parseable
 * TS module with an exact raw↔virtual {@link PositionMap} is identical. This owns
 * that framework-agnostic assembly (and the last-input memo the pipeline relies
 * on), so each plugin contributes only its parser-specific block extraction.
 */

import { PositionMap, type PositionSegment } from './position-map';

/** Placeholder body for a component with no script block (a valid empty TS module). */
export const EMPTY_MODULE = 'export {};\n';

/** A raw script block: its start offset in the raw file and its verbatim text. */
export interface VirtualScriptBlock {
  rawStart: number;
  content: string;
}

/**
 * Concatenate raw script `blocks` (in the given order) into one virtual TS module,
 * recording an exact raw↔virtual {@link PositionMap}. An optional `prelude` (e.g.
 * Svelte generics aliases) is prepended UNMAPPED, so real script positions still
 * translate exactly. With no blocks, yields {@link EMPTY_MODULE} (empty map).
 */
export function buildVirtualModule(
  blocks: VirtualScriptBlock[],
  prelude = '',
): { parseText: string; map: PositionMap } {
  if (blocks.length === 0) return { parseText: EMPTY_MODULE, map: new PositionMap([]) };

  const segments: PositionSegment[] = [];
  let parseText = prelude;
  for (const block of blocks) {
    if (parseText.length > 0) parseText += '\n';
    segments.push({ rawStart: block.rawStart, virtualStart: parseText.length, length: block.content.length });
    parseText += block.content;
  }
  return { parseText, map: new PositionMap(segments) };
}

/**
 * Memoize a raw-source transform on its LAST input. The pipeline calls a plugin's
 * `transform` (syntax) and `virtualFiles` (semantics) with identical content, so
 * this runs the underlying parser once per content version, not twice.
 */
export function memoizeByRaw<T>(compute: (raw: string) => T): (raw: string) => T {
  let last: { raw: string; result: T } | null = null;
  return (raw) => {
    if (last?.raw === raw) return last.result;
    const result = compute(raw);
    last = { raw, result };
    return result;
  };
}
