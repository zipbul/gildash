import type { ParsedFile } from '../parser/types';
import type { ExtractedSymbol, CodeRelation } from '../extractor/types';
import { assertOpen } from './guard';
import type { GildashContext } from './context';

/** Extract all symbol declarations from a previously parsed file. */
export function extractSymbols(
  ctx: GildashContext,
  parsed: ParsedFile,
): ExtractedSymbol[] {
  assertOpen(ctx);
  return ctx.extractSymbolsFn(parsed);
}

/** Extract inter-file relationships from a previously parsed file. */
export function extractRelations(
  ctx: GildashContext,
  parsed: ParsedFile,
): CodeRelation[] {
  assertOpen(ctx);
  return ctx.extractRelationsFn(
    parsed.program,
    parsed.filePath,
    ctx.tsconfigPaths ?? undefined,
  );
}
