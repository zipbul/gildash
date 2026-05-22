import { test, expect } from 'bun:test';
import ts from 'typescript';
import { findNodeAtPosition } from './ast-node-utils';

function parse(code: string): ts.SourceFile {
  return ts.createSourceFile('v.ts', code, ts.ScriptTarget.Latest, /*setParentNodes*/ true);
}

test('returns the identifier node at its start position', () => {
  const code = 'const value = 1;';
  const sf = parse(code);
  const node = findNodeAtPosition(sf, code.indexOf('value'));
  expect(node && ts.isIdentifier(node) && node.text).toBe('value');
});

test('returns the innermost node containing the position, not an ancestor', () => {
  const code = 'function f() { return inner; }';
  const sf = parse(code);
  const node = findNodeAtPosition(sf, code.indexOf('inner'));
  expect(node && ts.isIdentifier(node) && node.text).toBe('inner');
});

test('resolves an identifier nested inside a deep expression', () => {
  const code = 'const r = a.b(deep);';
  const sf = parse(code);
  const node = findNodeAtPosition(sf, code.indexOf('deep'));
  expect(node && ts.isIdentifier(node) && node.text).toBe('deep');
});

test('returns undefined for a negative position', () => {
  expect(findNodeAtPosition(parse('const x = 1;'), -1)).toBeUndefined();
});

test('returns undefined for a position at or past the end of the file', () => {
  const code = 'const x = 1;';
  expect(findNodeAtPosition(parse(code), code.length)).toBeUndefined();
});

test('does not return an identifier for a non-identifier position', () => {
  // Position on the numeric literal — must not surface as an identifier.
  const code = 'const x = 42;';
  const node = findNodeAtPosition(parse(code), code.indexOf('42'));
  expect(node && ts.isIdentifier(node)).toBeFalsy();
});
