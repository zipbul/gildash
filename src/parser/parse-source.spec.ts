import { describe, it, expect, mock } from 'bun:test';

// parseSource imports oxc-parser at module level, so we intercept it first.
const mockParseSync = mock(() => ({
  program: { type: 'Program', body: [], sourceType: 'module' },
  errors: [],
  comments: [],
  module: {},
}));

mock.module('oxc-parser', () => ({
  parseSync: mockParseSync,
}));

// Import AFTER mock.module() is registered.
import { parseSource } from './parse-source';
import { ParseError } from '../errors';

describe('parseSource', () => {
  // HP
  it('should return a ParsedFile with the given filePath and sourceText', () => {
    // Arrange
    const filePath = '/project/src/index.ts';
    const sourceText = 'const x = 1;';
    // Act
    const result = parseSource(filePath, sourceText);
    // Assert
    expect(result.filePath).toBe(filePath);
    expect(result.sourceText).toBe(sourceText);
  });

  it('should return program from oxc-parser parseSync result', () => {
    const filePath = '/project/src/foo.ts';
    const sourceText = 'export const y = 2;';
    const result = parseSource(filePath, sourceText);
    expect(result.program).toBeDefined();
    expect(result.program.type).toBe('Program');
  });

  it('should return errors array from parseSync result', () => {
    const result = parseSource('/project/a.ts', '');
    expect(Array.isArray(result.errors)).toBe(true);
  });

  it('should return comments array from parseSync result', () => {
    const result = parseSource('/project/a.ts', '');
    expect(Array.isArray(result.comments)).toBe(true);
  });

  it('should pass filePath and sourceText to oxc-parser parseSync', () => {
    // Arrange
    mockParseSync.mockClear();
    const filePath = '/project/src/bar.ts';
    const sourceText = 'function foo() {}';
    // Act
    parseSource(filePath, sourceText);
    // Assert
    expect(mockParseSync).toHaveBeenCalledTimes(1);
    expect(mockParseSync).toHaveBeenCalledWith(filePath, sourceText);
  });

  // NE — oxc-parser throws
  it('should throw ParseError when oxc-parser parseSync throws', () => {
    // Arrange
    const cause = new Error('internal parser crash');
    mockParseSync.mockImplementationOnce(() => { throw cause; });
    // Act & Assert
    expect(() => parseSource('/project/crash.ts', 'bad source')).toThrow(ParseError);
  });

  it('should preserve original error as cause inside thrown ParseError', () => {
    const cause = new Error('crash');
    mockParseSync.mockImplementationOnce(() => { throw cause; });
    let thrown: unknown;
    try {
      parseSource('/project/crash.ts', '');
    } catch (e) {
      thrown = e;
    }
    expect((thrown as ParseError).cause).toBe(cause);
  });

  // ED — empty string
  it('should handle empty sourceText without throwing', () => {
    expect(() => parseSource('/project/empty.ts', '')).not.toThrow();
  });

  // ID
  it('should return identical program reference when called twice with the same input', () => {
    const program = { type: 'Program', body: [] };
    mockParseSync.mockImplementation(() => ({ program, errors: [], comments: [], module: {} }));
    const r1 = parseSource('/project/x.ts', 'const a = 1;');
    const r2 = parseSource('/project/x.ts', 'const a = 1;');
    // Each call produces a distinct ParsedFile object (no caching in parseSource)
    expect(r1).not.toBe(r2);
    // But program itself is the same reference (as returned by the mock)
    expect(r1.program).toBe(r2.program);
  });
});
