import { describe, it, expect } from 'bun:test';
import { createSpanRemapper } from './remap';
import { PositionMap } from './position-map';

/**
 * Store-boundary remapping: extractor spans are line/column over the VIRTUAL
 * parse text; the DB must hold RAW file coordinates (the position invariant).
 */
describe('createSpanRemapper', () => {
  // raw file: 3 header lines (template), then the script content verbatim.
  const raw = `<template>\n<p>🚀 hi</p>\n</template>\n<script setup lang="ts">\nexport const msg = 'x';\nfunction inc() {}\n</script>\n`;
  const scriptStart = raw.indexOf('\nexport const') + 1;
  const virtualText = raw.slice(scriptStart, raw.indexOf('</script>'));
  const map = new PositionMap([{ rawStart: scriptStart, virtualStart: 0, length: virtualText.length }]);
  const remap = createSpanRemapper(map, virtualText, raw);

  it('should translate a virtual span to the exact raw line/column', () => {
    // `msg` sits on virtual line 1; in the raw file it is line 5.
    const out = remap({ start: { line: 1, column: 13 }, end: { line: 1, column: 16 } })!;
    expect(out.start).toEqual({ line: 5, column: 13 });
    expect(out.end).toEqual({ line: 5, column: 16 });
  });

  it('should translate a span on a later virtual line (multiline, after multibyte template)', () => {
    // `inc` on virtual line 2 → raw line 6.
    const out = remap({ start: { line: 2, column: 9 }, end: { line: 2, column: 12 } })!;
    expect(out.start).toEqual({ line: 6, column: 9 });
  });

  it('should return null for spans outside every mapped segment', () => {
    const synthetic = createSpanRemapper(new PositionMap([]), 'export {};\n', raw);
    expect(synthetic({ start: { line: 1, column: 0 }, end: { line: 1, column: 6 } })).toBeNull();
  });

  it('should map a span whose end is the exclusive segment boundary to the raw boundary', () => {
    // End at the very end of the virtual text (exclusive) → the raw offset just
    // before `</script>`, which begins its own line in the raw file.
    const endRawOffset = raw.indexOf('</script>');
    const endLine = raw.slice(0, endRawOffset).split('\n').length; // 1-based
    const virtualEndLine = virtualText.split('\n').length; // trailing '' after final newline

    const out = remap({ start: { line: 1, column: 0 }, end: { line: virtualEndLine, column: 0 } })!;

    expect(out).not.toBeNull();
    expect(out.start).toEqual({ line: 5, column: 0 }); // `export const` → raw line 5
    expect(out.end).toEqual({ line: endLine, column: 0 }); // exclusive end → `</script>` line
  });
});
