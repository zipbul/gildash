import path from 'node:path';
import type { SymbolSearchResult } from '../search/symbol-search';
import { GildashError } from '../errors';
import { guard } from './guard';
import type { ResolvedType, ByteSpan, SemanticReference, EnrichedReference, FileBinding, Implementation, SemanticModuleInterface, SemanticDiagnostic, GetDiagnosticsOptions } from '../semantic/types';
import type { SymbolNode } from '../semantic/symbol-graph';
import type { GildashContext } from './context';

/**
 * Look up a symbol's position for semantic queries.
 * Returns `null` when the symbol is not indexed or position cannot be resolved.
 */
export function resolveSymbolPosition(
  ctx: GildashContext,
  symbolName: string,
  filePath: string,
  project?: string,
): { sym: SymbolSearchResult; position: number; absPath: string } | null {
  const effectiveProject = project ?? ctx.defaultProject;
  // `symbolSearch` normalizes `query.filePath` to the store's RelPath domain (the
  // single enforced point), so a raw absolute/relative path is correct here.
  const results = ctx.symbolSearchFn({
    symbolRepo: ctx.symbolRepo, projectRoot: ctx.projectRoot,
    project: effectiveProject,
    query: { text: symbolName, exact: true, filePath, limit: 1 },
  });
  if (results.length === 0) return null;
  const sym = results[0]!;
  const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
  const declPos = ctx.semanticLayer!.lineColumnToPosition(
    absPath,
    sym.span.start.line,
    sym.span.start.column,
  );
  if (declPos === null) return null;
  const position = ctx.semanticLayer!.findNamePosition(absPath, declPos, sym.name) ?? declPos;
  return { sym, position, absPath };
}

/** Retrieve the resolved type of a symbol using the Semantic Layer. */
export function getResolvedType(
  ctx: GildashContext,
  symbolName: string,
  filePath: string,
  project?: string,
): ResolvedType | null {
  return guard(ctx, 'search', 'getResolvedType', () => {
    if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
    const resolved = resolveSymbolPosition(ctx, symbolName, filePath, project);
    if (!resolved) {
      return null;
    }
    return ctx.semanticLayer.collectTypeAt(resolved.absPath, resolved.position);
  });
}

/** Find all semantic references to a symbol. */
export function getSemanticReferences(
  ctx: GildashContext,
  symbolName: string,
  filePath: string,
  project?: string,
): SemanticReference[] {
  return guard(ctx, 'search', 'getSemanticReferences', () => {
    if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
    const resolved = resolveSymbolPosition(ctx, symbolName, filePath, project);
    if (!resolved) {
      throw new GildashError('search', `Gildash: symbol '${symbolName}' not found in '${filePath}'`);
    }
    return ctx.semanticLayer.findReferences(resolved.absPath, resolved.position);
  });
}

/** Find all references to a symbol, enriched with writeKind / isAmbient / enclosingScope. */
export function getEnrichedReferences(
  ctx: GildashContext,
  symbolName: string,
  filePath: string,
  project?: string,
): EnrichedReference[] {
  return guard(ctx, 'search', 'getEnrichedReferences', () => {
    if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
    const resolved = resolveSymbolPosition(ctx, symbolName, filePath, project);
    if (!resolved) {
      throw new GildashError('search', `Gildash: symbol '${symbolName}' not found in '${filePath}'`);
    }
    return ctx.semanticLayer.findEnrichedReferences(resolved.absPath, resolved.position);
  });
}

/** Find implementations of an interface/abstract class. */
export function getImplementations(
  ctx: GildashContext,
  symbolName: string,
  filePath: string,
  project?: string,
): Implementation[] {
  return guard(ctx, 'search', 'getImplementations', () => {
    if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
    const resolved = resolveSymbolPosition(ctx, symbolName, filePath, project);
    if (!resolved) {
      throw new GildashError('search', `Gildash: symbol '${symbolName}' not found in '${filePath}'`);
    }
    return ctx.semanticLayer.findImplementations(resolved.absPath, resolved.position);
  });
}

/** Check whether a source symbol's type is assignable to a target symbol's type. */
export function isTypeAssignableTo(
  ctx: GildashContext,
  sourceSymbol: string,
  sourceFilePath: string,
  targetSymbol: string,
  targetFilePath: string,
  project?: string,
): boolean | null {
  return guard(ctx, 'semantic', 'isTypeAssignableTo', () => {
    if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
    const src = resolveSymbolPosition(ctx, sourceSymbol, sourceFilePath, project);
    if (!src) throw new GildashError('search', `Gildash: source symbol '${sourceSymbol}' not found in '${sourceFilePath}'`);
    const tgt = resolveSymbolPosition(ctx, targetSymbol, targetFilePath, project);
    if (!tgt) throw new GildashError('search', `Gildash: target symbol '${targetSymbol}' not found in '${targetFilePath}'`);
    return ctx.semanticLayer.isTypeAssignableTo(src.absPath, src.position, tgt.absPath, tgt.position);
  });
}

/** Retrieve resolved types for all declarations in a file. */
export function getFileTypes(
  ctx: GildashContext,
  filePath: string,
): Map<number, ResolvedType> {
  return guard(ctx, 'semantic', 'getFileTypes', () => {
    if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
    return ctx.semanticLayer.collectFileTypes(absPath);
  });
}

/** Retrieve the resolved type at a specific position (line:column) without DB lookup. */
export function getResolvedTypeAt(
  ctx: GildashContext,
  filePath: string,
  line: number,
  column: number,
): ResolvedType | null {
  return guard(ctx, 'semantic', 'getResolvedTypeAt', () => {
    if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
    const position = ctx.semanticLayer.lineColumnToPosition(absPath, line, column);
    if (position === null) return null;
    return ctx.semanticLayer.collectTypeAt(absPath, position);
  });
}

/** Check type assignability at specific positions without DB lookup. */
export function isTypeAssignableToAt(
  ctx: GildashContext,
  opts: {
    source: { filePath: string; line: number; column: number };
    target: { filePath: string; line: number; column: number };
  },
): boolean | null {
  return guard(ctx, 'semantic', 'isTypeAssignableToAt', () => {
    if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
    const srcAbs = path.isAbsolute(opts.source.filePath) ? opts.source.filePath : path.resolve(ctx.projectRoot, opts.source.filePath);
    const tgtAbs = path.isAbsolute(opts.target.filePath) ? opts.target.filePath : path.resolve(ctx.projectRoot, opts.target.filePath);
    const srcPos = ctx.semanticLayer.lineColumnToPosition(srcAbs, opts.source.line, opts.source.column);
    if (srcPos === null) return null;
    const tgtPos = ctx.semanticLayer.lineColumnToPosition(tgtAbs, opts.target.line, opts.target.column);
    if (tgtPos === null) return null;
    return ctx.semanticLayer.isTypeAssignableTo(srcAbs, srcPos, tgtAbs, tgtPos);
  });
}

/** Retrieve the semantic module interface — exported symbols with resolved types. */
export function getSemanticModuleInterface(
  ctx: GildashContext,
  filePath: string,
): SemanticModuleInterface {
  return guard(ctx, 'search', 'getSemanticModuleInterface', () => {
    if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
    return ctx.semanticLayer.getModuleInterface(absPath);
  });
}

/** Retrieve the base types (supertypes) of a class/interface at a byte offset. */
export function getBaseTypes(
  ctx: GildashContext,
  filePath: string,
  position: number,
): ResolvedType[] | null {
  return guard(ctx, 'semantic', 'getBaseTypes', () => {
    if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
    return ctx.semanticLayer.getBaseTypes(absPath, position);
  });
}

/** Retrieve resolved types at multiple byte offsets in a single file (batch). */
export function getResolvedTypesAtPositions(
  ctx: GildashContext,
  filePath: string,
  positions: number[],
): Map<number, ResolvedType> {
  return guard(ctx, 'semantic', 'getResolvedTypesAtPositions', () => {
    if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
    return ctx.semanticLayer.collectTypesAtPositions(absPath, positions);
  });
}

// ─── Span-based semantic API (firebat error-flow) ─────────────────────

/** Resolve the type of the expression node exactly spanning `span` (call result, member, etc.). */
export function getExpressionTypeAtSpan(
  ctx: GildashContext,
  filePath: string,
  span: ByteSpan,
): ResolvedType | null {
  return guard(ctx, 'semantic', 'getExpressionTypeAtSpan', () => {
    if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
    return ctx.semanticLayer.collectAtSpan(absPath, span);
  });
}

/** Whether the type of the expression spanning `span` is a thenable (callable `then` with ≥1 param). */
export function isThenableAtSpan(
  ctx: GildashContext,
  filePath: string,
  span: ByteSpan,
  options?: { anyConstituent?: boolean },
): boolean | null {
  return guard(ctx, 'semantic', 'isThenableAtSpan', () => {
    if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
    return ctx.semanticLayer.isThenableAtSpan(absPath, span, options);
  });
}

/** Return types of the contextual call signatures at the argument expression spanning `span`. */
export function getContextualCallReturnsAtSpan(
  ctx: GildashContext,
  filePath: string,
  span: ByteSpan,
): ResolvedType[] | null {
  return guard(ctx, 'semantic', 'getContextualCallReturnsAtSpan', () => {
    if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
    return ctx.semanticLayer.contextualCallReturnsAtSpan(absPath, span);
  });
}

/** Whether the type of the expression spanning `span` is assignable to a type expression string. */
export function isTypeAssignableToTypeAtSpan(
  ctx: GildashContext,
  filePath: string,
  span: ByteSpan,
  targetTypeExpression: string,
  options?: { anyConstituent?: boolean },
): boolean | null {
  return guard(ctx, 'semantic', 'isTypeAssignableToTypeAtSpan', () => {
    if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
    return ctx.semanticLayer.isTypeAssignableToTypeAtSpan(absPath, span, targetTypeExpression, options);
  });
}

// ─── Position-based semantic API ──────────────────────────────────────

/** Retrieve the resolved type at a byte offset without line/column conversion. */
export function getResolvedTypeAtPosition(
  ctx: GildashContext,
  filePath: string,
  position: number,
): ResolvedType | null {
  return guard(ctx, 'semantic', 'getResolvedTypeAtPosition', () => {
    if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
    return ctx.semanticLayer.collectTypeAt(absPath, position);
  });
}

/** Find all semantic references at a byte offset. */
export function getSemanticReferencesAtPosition(
  ctx: GildashContext,
  filePath: string,
  position: number,
): SemanticReference[] {
  return guard(ctx, 'semantic', 'getSemanticReferencesAtPosition', () => {
    if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
    return ctx.semanticLayer.findReferences(absPath, position);
  });
}

/** Find all enriched references at a byte offset. */
export function getEnrichedReferencesAtPosition(
  ctx: GildashContext,
  filePath: string,
  position: number,
): EnrichedReference[] {
  return guard(ctx, 'semantic', 'getEnrichedReferencesAtPosition', () => {
    if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
    return ctx.semanticLayer.findEnrichedReferences(absPath, position);
  });
}

/** Collect all bindings in a file (single-pass), each with its in-file enriched references. */
export function getFileBindings(ctx: GildashContext, filePath: string): FileBinding[] {
  return guard(ctx, 'semantic', 'getFileBindings', () => {
    if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
    return ctx.semanticLayer.getFileBindings(absPath);
  });
}

/**
 * Register in-memory `files` then collect every file's bindings in one batch,
 * keyed by the caller's filePath. Amortizes the tsc Program rebuild to once for
 * the whole batch (vs once per file when notify/query are interleaved).
 */
export function getFileBindingsBatch(
  ctx: GildashContext,
  files: ReadonlyArray<{ filePath: string; content: string }>,
): Map<string, FileBinding[]> {
  return guard(ctx, 'semantic', 'getFileBindingsBatch', () => {
    if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
    const resolved = files.map((f) => ({
      orig: f.filePath,
      abs: path.isAbsolute(f.filePath) ? f.filePath : path.resolve(ctx.projectRoot, f.filePath),
      content: f.content,
    }));
    const byAbs = ctx.semanticLayer.getFileBindingsBatch(
      resolved.map((r) => ({ filePath: r.abs, content: r.content })),
    );
    const out = new Map<string, FileBinding[]>();
    for (const r of resolved) out.set(r.orig, byAbs.get(r.abs) ?? []);
    return out;
  });
}

/**
 * Resolve a self-contained source's bindings in isolation (no shared-program
 * touch) — O(file), constant regardless of project size. Cross-file imports and
 * global/lib symbols are not resolved (use getFileBindings for those).
 */
export function getStandaloneFileBindings(
  ctx: GildashContext,
  filePath: string,
  content: string,
): FileBinding[] {
  return guard(ctx, 'semantic', 'getStandaloneFileBindings', () => {
    if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
    return ctx.semanticLayer.getStandaloneFileBindings(absPath, content);
  });
}

/**
 * Whether `filePath` is in a healthy semantic program (full type/reference/binding
 * answers available). `false` for files outside every discovered tsconfig, files
 * whose tsconfig failed to build, or when the semantic layer is disabled. Lets
 * callers degrade per-file (e.g. fall back to {@link getStandaloneFileBindings}).
 */
export function isFileInSemanticProgram(ctx: GildashContext, filePath: string): boolean {
  return guard(ctx, 'semantic', 'isFileInSemanticProgram', () => {
    if (!ctx.semanticLayer) return false;
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
    return ctx.semanticLayer.isFileInSemanticProgram(absPath);
  });
}

/** Register/replace an in-memory file in the semantic layer (tsc Program). */
export function notifyFileChanged(ctx: GildashContext, filePath: string, content: string): void {
  return guard(ctx, 'semantic', 'notifyFileChanged', () => {
    if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
    ctx.semanticLayer.notifyFileChanged(absPath, content);
  });
}

/** Remove an in-memory file from the semantic layer (tsc Program). */
export function notifyFileDeleted(ctx: GildashContext, filePath: string): void {
  return guard(ctx, 'semantic', 'notifyFileDeleted', () => {
    if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
    ctx.semanticLayer.notifyFileDeleted(absPath);
  });
}

/** Find implementations at a byte offset. */
export function getImplementationsAtPosition(
  ctx: GildashContext,
  filePath: string,
  position: number,
): Implementation[] {
  return guard(ctx, 'semantic', 'getImplementationsAtPosition', () => {
    if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
    return ctx.semanticLayer.findImplementations(absPath, position);
  });
}

/** Check type assignability at byte offsets. */
export function isTypeAssignableToAtPosition(
  ctx: GildashContext,
  srcFilePath: string,
  srcPosition: number,
  dstFilePath: string,
  dstPosition: number,
): boolean | null {
  return guard(ctx, 'semantic', 'isTypeAssignableToAtPosition', () => {
    if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
    const srcAbs = path.isAbsolute(srcFilePath) ? srcFilePath : path.resolve(ctx.projectRoot, srcFilePath);
    const dstAbs = path.isAbsolute(dstFilePath) ? dstFilePath : path.resolve(ctx.projectRoot, dstFilePath);
    return ctx.semanticLayer.isTypeAssignableTo(srcAbs, srcPosition, dstAbs, dstPosition);
  });
}

/** Check whether the type at a position is assignable to a type expression string. */
export function isTypeAssignableToType(
  ctx: GildashContext,
  filePath: string,
  position: number,
  targetTypeExpression: string,
  options?: { anyConstituent?: boolean },
): boolean | null {
  return guard(ctx, 'semantic', 'isTypeAssignableToType', () => {
    if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
    return ctx.semanticLayer.isTypeAssignableToType(absPath, position, targetTypeExpression, options);
  });
}

/** Batch-check whether types at multiple positions are assignable to a type expression. */
export function isTypeAssignableToTypeAtPositions(
  ctx: GildashContext,
  filePath: string,
  positions: number[],
  targetTypeExpression: string,
  options?: { anyConstituent?: boolean },
): Map<number, boolean> {
  return guard(ctx, 'semantic', 'isTypeAssignableToTypeAtPositions', () => {
    if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
    return ctx.semanticLayer.isTypeAssignableToTypeAtPositions(absPath, positions, targetTypeExpression, options);
  });
}

// ─── Internal utility exposure ────────────────────────────────────────

/** Convert 1-based line + 0-based column to a byte offset using tsc SourceFile. */
export function lineColumnToPosition(
  ctx: GildashContext,
  filePath: string,
  line: number,
  column: number,
): number | null {
  return guard(ctx, 'semantic', 'lineColumnToPosition', () => {
    if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
    return ctx.semanticLayer.lineColumnToPosition(absPath, line, column);
  });
}

/** Find the byte offset of a symbol name starting from its declaration position. */
export function findNamePosition(
  ctx: GildashContext,
  filePath: string,
  declarationPos: number,
  name: string,
): number | null {
  return guard(ctx, 'semantic', 'findNamePosition', () => {
    if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
    return ctx.semanticLayer.findNamePosition(absPath, declarationPos, name);
  });
}

/** Retrieve the tsc symbol graph node at a byte offset. */
export function getSymbolNode(
  ctx: GildashContext,
  filePath: string,
  position: number,
): SymbolNode | null {
  return guard(ctx, 'semantic', 'getSymbolNode', () => {
    if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
    return ctx.semanticLayer.getSymbolNode(absPath, position);
  });
}

// ─── Diagnostics ──────────────────────────────────────────────────────

/** Return tsc diagnostics for an indexed file. */
export function getSemanticDiagnostics(
  ctx: GildashContext,
  filePath: string,
  options?: GetDiagnosticsOptions,
): SemanticDiagnostic[] {
  return guard(ctx, 'semantic', 'getSemanticDiagnostics', () => {
    if (!ctx.semanticLayer) throw new GildashError('semantic', 'Gildash: semantic layer is not enabled');
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
    return ctx.semanticLayer.getDiagnostics(absPath, options);
  });
}
