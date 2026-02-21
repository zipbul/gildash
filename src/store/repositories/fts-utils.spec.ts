import { describe, expect, it } from 'bun:test';
import { toFtsPrefixQuery } from './fts-utils';

describe('toFtsPrefixQuery', () => {
  // 1. [HP] single word
  it('should return single quoted token with wildcard when given a single word', () => {
    expect(toFtsPrefixQuery('foo')).toBe('"foo"*');
  });

  // 2. [HP] two words
  it('should return two quoted tokens joined by space when given two words', () => {
    expect(toFtsPrefixQuery('foo bar')).toBe('"foo"* "bar"*');
  });

  // 3. [HP] trim surrounding whitespace
  it('should trim leading and trailing spaces when input has surrounding whitespace', () => {
    expect(toFtsPrefixQuery('  hello  ')).toBe('"hello"*');
  });

  // 4. [HP] multiple internal spaces
  it('should normalize multiple internal spaces to a single separator when splitting on whitespace', () => {
    expect(toFtsPrefixQuery('foo  bar')).toBe('"foo"* "bar"*');
  });

  // 5. [HP] word with period
  it('should include the period verbatim in the quoted token when a word contains a period', () => {
    expect(toFtsPrefixQuery('path.ts')).toBe('"path.ts"*');
  });

  // 6. [NE] empty string → '' (fts-utils.ts#L15 filter removes empty token, join = '')
  it('should return empty string when given an empty input', () => {
    expect(toFtsPrefixQuery('')).toBe('');
  });

  // 7. [NE] whitespace-only → '' (same filter path as #6)
  it('should return empty string when input contains only whitespace', () => {
    expect(toFtsPrefixQuery('   ')).toBe('');
  });

  // 8. [ED] single double-quote char → token='"', replaceAll → '""', result = `""""*`
  it('should escape a standalone double-quote character when used as the entire input', () => {
    // token = '"', replaceAll('"', '""') = '""'
    // template: `"${...}"*` = `"` + `""` + `"*` = `""""*`
    expect(toFtsPrefixQuery('"')).toBe('""""*');
  });

  // 9. [ED] word containing double-quote (fts-utils.ts#L16 replaceAll branch — quote present)
  it('should escape double-quotes inside a token by doubling them', () => {
    // token = 'he"llo', replaceAll = 'he""llo', result = '"he""llo"*'
    expect(toFtsPrefixQuery('he"llo')).toBe('"he""llo"*');
  });

  // 10. [ED] single-character token
  it('should wrap a single-character token in quotes with a wildcard', () => {
    expect(toFtsPrefixQuery('a')).toBe('"a"*');
  });

  // 11. [CO] leading space + word containing double-quote (both branches apply)
  it('should trim and then escape when input has leading space and a double-quote in the word', () => {
    expect(toFtsPrefixQuery(' say"hi')).toBe('"say""hi"*');
  });

  // 12. [CO] tab-separated words where one contains a quote
  it('should split on tab and escape the quote when tab-separated tokens include a quoted word', () => {
    expect(toFtsPrefixQuery('foo\the"llo')).toBe('"foo"* "he""llo"*');
  });

  // 13. [OR] reversed word order produces different output
  it('should preserve input word order so reversing words changes the output', () => {
    // "bar foo" should differ from "foo bar" (which is in test 2)
    expect(toFtsPrefixQuery('bar foo')).toBe('"bar"* "foo"*');
  });
});
