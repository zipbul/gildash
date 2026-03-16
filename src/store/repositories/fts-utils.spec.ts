import { describe, expect, it } from 'bun:test';
import { toFtsPrefixQuery } from './fts-utils';

describe('toFtsPrefixQuery', () => {
  it('should return single quoted token with wildcard when given a single word', () => {
    expect(toFtsPrefixQuery('foo')).toBe('"foo"*');
  });

  it('should return two quoted tokens joined by space when given two words', () => {
    expect(toFtsPrefixQuery('foo bar')).toBe('"foo"* "bar"*');
  });

  it('should trim leading and trailing spaces when input has surrounding whitespace', () => {
    expect(toFtsPrefixQuery('  hello  ')).toBe('"hello"*');
  });

  it('should normalize multiple internal spaces to a single separator when splitting on whitespace', () => {
    expect(toFtsPrefixQuery('foo  bar')).toBe('"foo"* "bar"*');
  });

  it('should include the period verbatim in the quoted token when a word contains a period', () => {
    expect(toFtsPrefixQuery('path.ts')).toBe('"path.ts"*');
  });

  it('should return empty string when given an empty input', () => {
    expect(toFtsPrefixQuery('')).toBe('');
  });

  it('should return empty string when input contains only whitespace', () => {
    expect(toFtsPrefixQuery('   ')).toBe('');
  });

  it('should escape a standalone double-quote character when used as the entire input', () => {
    expect(toFtsPrefixQuery('"')).toBe('""""*');
  });

  it('should escape double-quotes inside a token by doubling them', () => {
    expect(toFtsPrefixQuery('he"llo')).toBe('"he""llo"*');
  });

  it('should wrap a single-character token in quotes with a wildcard', () => {
    expect(toFtsPrefixQuery('a')).toBe('"a"*');
  });

  it('should trim and then escape when input has leading space and a double-quote in the word', () => {
    expect(toFtsPrefixQuery(' say"hi')).toBe('"say""hi"*');
  });

  it('should split on tab and escape the quote when tab-separated tokens include a quoted word', () => {
    expect(toFtsPrefixQuery('foo\the"llo')).toBe('"foo"* "he""llo"*');
  });

  it('should preserve input word order so reversing words changes the output', () => {
    expect(toFtsPrefixQuery('bar foo')).toBe('"bar"* "foo"*');
  });

  it('should strip null bytes from input to prevent SQLite FTS5 syntax error', () => {
    const result = toFtsPrefixQuery('hello\x00world');
    expect(result).not.toContain('\x00');
    expect(result).toBe('"helloworld"*');
  });

  it('should strip null bytes when they appear between words', () => {
    const result = toFtsPrefixQuery('hello \x00 world');
    expect(result).not.toContain('\x00');
  });

  it('should return empty string when input is only null bytes', () => {
    expect(toFtsPrefixQuery('\x00\x00')).toBe('');
  });

  it('should handle mixed null bytes and valid content', () => {
    const result = toFtsPrefixQuery('\x00foo\x00 bar\x00');
    expect(result).not.toContain('\x00');
    expect(result).toBe('"foo"* "bar"*');
  });
});
