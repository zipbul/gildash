import { parse } from 'comment-parser';
import type { JsDocBlock } from '../extractor/types';
import { ParseError } from '../errors';

/**
 * Parses a JSDoc comment block into a normalized JsDocBlock.
 * Pure function. Wraps comment-parser.
 *
 * @param commentText - Raw comment text (may or may not include /** and *\/ delimiters).
 * @returns Normalized JsDocBlock with description and tags.
 * @throws ParseError if comment-parser throws internally.
 */
export function parseJsDoc(commentText: string): JsDocBlock {
  try {
    // Normalize: strip existing /** and */ wrapping if present, then re-wrap.
    let stripped = commentText.trim();
    if (stripped.startsWith('/**')) stripped = stripped.slice(3);
    if (stripped.endsWith('*/')) stripped = stripped.slice(0, -2);

    const blocks = parse(`/** ${stripped} */`);
    const block = blocks[0] ?? { description: '', tags: [] };

    return {
      description: (block.description ?? '').trim(),
      tags: (block.tags ?? []).map((t) => ({
        tag: t.tag ?? '',
        name: t.name ?? '',
        type: t.type ?? '',
        description: t.description ?? '',
        optional: t.optional ?? false,
        ...(t.default !== undefined ? { default: t.default } : {}),
      })),
    };
  } catch (err) {
    throw new ParseError(`Failed to parse JSDoc comment`, { cause: err });
  }
}
