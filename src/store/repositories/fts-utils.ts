/**
 * Converts a free-text query into an FTS5-compatible prefix query.
 *
 * Each whitespace-separated token becomes a quoted, double-escaped phrase
 * with a trailing `*` wildcard.  Tokens are joined with implicit AND.
 *
 * @example
 * toFtsPrefixQuery('Foo Bar') // => '"Foo"* "Bar"*'
 */
export function toFtsPrefixQuery(text: string): string {
  return text
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token) => `"${token.replaceAll('"', '""')}"*`)
    .join(' ');
}
