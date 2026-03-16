export function toFtsPrefixQuery(text: string): string {
  return text
    .replaceAll('\x00', '')
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token) => `"${token.replaceAll('"', '""')}"*`)
    .join(' ');
}
