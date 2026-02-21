import { describe, it, expect } from 'bun:test';
import { buildLineOffsets, getLineColumn } from './source-position';

// ============================================================
// buildLineOffsets
// ============================================================
describe('buildLineOffsets', () => {
  // HP
  it('should return [0] when given an empty string', () => {
    // Arrange
    const source = '';
    // Act
    const offsets = buildLineOffsets(source);
    // Assert
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
    // CRLF: '\r' at index 1, '\n' at index 2 → next line starts at 3
    const source = 'a\r\nb';
    const offsets = buildLineOffsets(source);
    expect(offsets).toEqual([0, 3]);
  });

  // NE
  it('should return [0] when given a string with no newlines regardless of length', () => {
    const source = 'a'.repeat(1000);
    const offsets = buildLineOffsets(source);
    expect(offsets).toEqual([0]);
  });

  // ED
  it('should handle single newline character when building line offsets', () => {
    const source = '\n';
    const offsets = buildLineOffsets(source);
    expect(offsets).toEqual([0, 1]);
  });

  // ID
  it('should return identical result when called twice with the same input', () => {
    const source = 'foo\nbar\nbaz';
    const first = buildLineOffsets(source);
    const second = buildLineOffsets(source);
    expect(first).toEqual(second);
  });
});

// ============================================================
// getLineColumn
// ============================================================
describe('getLineColumn', () => {
  // HP
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
    const pos = getLineColumn(offsets, 6); // 'w' in 'world'
    expect(pos).toEqual({ line: 2, column: 0 });
  });

  it('should return correct position when offset points within the second line', () => {
    const source = 'hello\nworld';
    const offsets = buildLineOffsets(source);
    const pos = getLineColumn(offsets, 8); // 'r' in 'world'
    expect(pos).toEqual({ line: 2, column: 2 });
  });

  it('should return correct position when offset points to the third line', () => {
    const source = 'a\nbb\nccc';
    const offsets = buildLineOffsets(source);
    const pos = getLineColumn(offsets, 7); // second 'c'
    expect(pos).toEqual({ line: 3, column: 2 });
  });

  // NE
  it('should return line 1 column 0 when offset is 0 in multi-line source', () => {
    const offsets = buildLineOffsets('a\nb\nc');
    const pos = getLineColumn(offsets, 0);
    expect(pos).toEqual({ line: 1, column: 0 });
  });

  // ED
  it('should handle newline character offset when offset points to newline itself', () => {
    const source = 'ab\ncd';
    const offsets = buildLineOffsets(source);
    const pos = getLineColumn(offsets, 2); // '\n'
    expect(pos).toEqual({ line: 1, column: 2 });
  });

  it('should handle last character offset when offset points to file end', () => {
    const source = 'a\nb';
    const offsets = buildLineOffsets(source);
    const pos = getLineColumn(offsets, 3); // 'b'
    expect(pos).toEqual({ line: 2, column: 1 });
  });

  it('should handle single-character source when offset is 0', () => {
    const offsets = buildLineOffsets('x');
    const pos = getLineColumn(offsets, 0);
    expect(pos).toEqual({ line: 1, column: 0 });
  });

  // CO
  it('should handle offset 0 when file starts with a newline (blank first line)', () => {
    const source = '\nhello';
    const offsets = buildLineOffsets(source);
    const pos = getLineColumn(offsets, 0);
    expect(pos).toEqual({ line: 1, column: 0 });
  });

  it('should handle the first character on a new line when consecutive newlines exist', () => {
    const source = 'a\n\nb';
    const offsets = buildLineOffsets(source);
    const pos = getLineColumn(offsets, 3); // 'b'
    expect(pos).toEqual({ line: 3, column: 0 });
  });

  // ID
  it('should return identical result when called twice with the same arguments', () => {
    const offsets = buildLineOffsets('foo\nbar\nbaz');
    const first = getLineColumn(offsets, 5);
    const second = getLineColumn(offsets, 5);
    expect(first).toEqual(second);
  });
});
