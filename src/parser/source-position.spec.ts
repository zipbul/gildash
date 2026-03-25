import { describe, it, expect } from 'bun:test';
import { buildLineOffsets, getLineColumn } from './source-position';

describe('buildLineOffsets', () => {
  it('should return [0] when given an empty string', () => {
    const source = '';
    const offsets = buildLineOffsets(source);
    expect(offsets).toEqual([0]);
  });

  it('should return [0] when given a single-line string with no newline', () => {
    const source = 'hello world';
    const offsets = buildLineOffsets(source);
    expect(offsets).toEqual([0]);
  });

  it('should return [0, 6] when input is a two-line string', () => {
    const source = 'hello\nworld';
    const offsets = buildLineOffsets(source);
    expect(offsets).toEqual([0, 6]);
  });

  it('should return correct offsets when input has three lines', () => {
    const source = 'a\nbb\nccc';
    const offsets = buildLineOffsets(source);
    expect(offsets).toEqual([0, 2, 5]);
  });

  it('should handle trailing newline when input string ends with a newline', () => {
    const source = 'a\nb\n';
    const offsets = buildLineOffsets(source);
    expect(offsets).toEqual([0, 2, 4]);
  });

  it('should handle consecutive newlines when blank lines exist in input', () => {
    const source = 'a\n\nb';
    const offsets = buildLineOffsets(source);
    expect(offsets).toEqual([0, 2, 3]);
  });

  it('should handle input that is only newlines when building line offsets', () => {
    const source = '\n\n';
    const offsets = buildLineOffsets(source);
    expect(offsets).toEqual([0, 1, 2]);
  });

  it('should treat \\r\\n as two characters when building line offsets', () => {
    const source = 'a\r\nb';
    const offsets = buildLineOffsets(source);
    expect(offsets).toEqual([0, 3]);
  });

  it('should return [0] when given a string with no newlines regardless of length', () => {
    const source = 'a'.repeat(1000);
    const offsets = buildLineOffsets(source);
    expect(offsets).toEqual([0]);
  });

  it('should handle single newline character when building line offsets', () => {
    const source = '\n';
    const offsets = buildLineOffsets(source);
    expect(offsets).toEqual([0, 1]);
  });

  it('should return identical result when called twice with the same input', () => {
    const source = 'foo\nbar\nbaz';
    const first = buildLineOffsets(source);
    const second = buildLineOffsets(source);
    expect(first).toEqual(second);
  });
});

describe('getLineColumn', () => {
  it('should return line 1 column 0 when offset is 0 on a single-line file', () => {
    const offsets = buildLineOffsets('hello');
    const pos = getLineColumn(offsets, 0);
    expect(pos).toEqual({ line: 1, column: 0 });
  });

  it('should return correct column when offset points within the first line', () => {
    const offsets = buildLineOffsets('hello\nworld');
    const pos = getLineColumn(offsets, 3);
    expect(pos).toEqual({ line: 1, column: 3 });
  });

  it('should return line 2 column 0 when offset is exact start of second line', () => {
    const source = 'hello\nworld';
    const offsets = buildLineOffsets(source);
    const pos = getLineColumn(offsets, 6);
    expect(pos).toEqual({ line: 2, column: 0 });
  });

  it('should return correct position when offset points within the second line', () => {
    const source = 'hello\nworld';
    const offsets = buildLineOffsets(source);
    const pos = getLineColumn(offsets, 8);
    expect(pos).toEqual({ line: 2, column: 2 });
  });

  it('should return correct position when offset points to the third line', () => {
    const source = 'a\nbb\nccc';
    const offsets = buildLineOffsets(source);
    const pos = getLineColumn(offsets, 7);
    expect(pos).toEqual({ line: 3, column: 2 });
  });

  it('should return line 1 column 0 when offset is 0 in multi-line source', () => {
    const offsets = buildLineOffsets('a\nb\nc');
    const pos = getLineColumn(offsets, 0);
    expect(pos).toEqual({ line: 1, column: 0 });
  });

  it('should handle newline character offset when offset points to newline itself', () => {
    const source = 'ab\ncd';
    const offsets = buildLineOffsets(source);
    const pos = getLineColumn(offsets, 2);
    expect(pos).toEqual({ line: 1, column: 2 });
  });

  it('should handle last character offset when offset points to file end', () => {
    const source = 'a\nb';
    const offsets = buildLineOffsets(source);
    const pos = getLineColumn(offsets, 3);
    expect(pos).toEqual({ line: 2, column: 1 });
  });

  it('should handle single-character source when offset is 0', () => {
    const offsets = buildLineOffsets('x');
    const pos = getLineColumn(offsets, 0);
    expect(pos).toEqual({ line: 1, column: 0 });
  });

  it('should handle offset 0 when file starts with a newline (blank first line)', () => {
    const source = '\nhello';
    const offsets = buildLineOffsets(source);
    const pos = getLineColumn(offsets, 0);
    expect(pos).toEqual({ line: 1, column: 0 });
  });

  it('should handle the first character on a new line when consecutive newlines exist', () => {
    const source = 'a\n\nb';
    const offsets = buildLineOffsets(source);
    const pos = getLineColumn(offsets, 3);
    expect(pos).toEqual({ line: 3, column: 0 });
  });

  it('should return identical result when called twice with the same arguments', () => {
    const offsets = buildLineOffsets('foo\nbar\nbaz');
    const first = getLineColumn(offsets, 5);
    const second = getLineColumn(offsets, 5);
    expect(first).toEqual(second);
  });

  it('should handle CRLF line endings correctly in getLineColumn', () => {
    const source = 'a\r\nb\r\nc';
    const offsets = buildLineOffsets(source);
    // offsets: [0, 3, 6] — \n at index 2 and 5
    expect(getLineColumn(offsets, 0)).toEqual({ line: 1, column: 0 }); // 'a'
    expect(getLineColumn(offsets, 1)).toEqual({ line: 1, column: 1 }); // '\r'
    expect(getLineColumn(offsets, 2)).toEqual({ line: 1, column: 2 }); // '\n'
    expect(getLineColumn(offsets, 3)).toEqual({ line: 2, column: 0 }); // 'b'
    expect(getLineColumn(offsets, 6)).toEqual({ line: 3, column: 0 }); // 'c'
  });

  it('should return last line position when offset equals source length', () => {
    const source = 'ab\ncd';
    const offsets = buildLineOffsets(source);
    // source.length = 5, last char 'd' is at offset 4
    const pos = getLineColumn(offsets, source.length);
    expect(pos).toEqual({ line: 2, column: 2 });
  });

  it('should return position on last line when offset exceeds source length', () => {
    const source = 'ab\ncd';
    const offsets = buildLineOffsets(source);
    // offset 100 far exceeds source.length (5)
    // binary search settles on the last line (line 2, starting at offset 3)
    // column becomes offset - lineStart = 100 - 3 = 97
    const pos = getLineColumn(offsets, 100);
    expect(pos).toEqual({ line: 2, column: 97 });
  });

  it('should return line 1 with negative column when offset is negative', () => {
    const source = 'ab\ncd';
    const offsets = buildLineOffsets(source);
    // negative offset: binary search settles on line 1 (offset 0)
    // column becomes offset - lineStart = -5 - 0 = -5
    const pos = getLineColumn(offsets, -5);
    expect(pos).toEqual({ line: 1, column: -5 });
  });
});
