import type { ParsedFile } from '../parser/types';
import type { ParserOptions } from 'oxc-parser';
import type { ExtractedSymbol, CodeRelation } from '../extractor/types';
import type { StoredCodeRelation } from '../search/relation-search';
import type { IndexResult } from '../indexer/index-coordinator';
import type { ProjectBoundary } from '../common/project-discovery';
import type { SymbolSearchQuery, SymbolSearchResult } from '../search/symbol-search';
import type { RelationSearchQuery } from '../search/relation-search';
import type { SymbolStats } from '../store/repositories/symbol.repository';
import type { FileRecord } from '../store/repositories/file.repository';
import type { PatternMatch } from '../search/pattern-search';
import type { ResolvedType, SemanticReference, Implementation, SemanticModuleInterface, SemanticDiagnostic, GetDiagnosticsOptions } from '../semantic/types';
import type { SymbolNode } from '../semantic/symbol-graph';
import type { GildashContext } from './context';
import type { FileChangeEvent } from '../watcher/types';
import { GildashError } from '../errors';
import type {
  Logger,
  GildashOptions,
  SymbolDiff,
  ModuleInterface,
  HeritageNode,
  FullSymbol,
  FileStats,
  FanMetrics,
  ResolvedSymbol,
  BatchParseResult,
} from './types';
import type { GildashInternalOptions } from './lifecycle';
import { initializeContext, closeContext } from './lifecycle';
import * as parseApi from './parse-api';
import * as extractApi from './extract-api';
import * as queryApi from './query-api';
import * as graphApi from './graph-api';
import * as semanticApi from './semantic-api';
import * as miscApi from './misc-api';
import * as annotationApi from './annotation-api';
import * as changelogApi from './changelog-api';
import type { AnnotationSearchQuery, AnnotationSearchResult } from '../search/annotation-search';
import type { SymbolChange, SymbolChangeQueryOptions } from './types';

// ─── Re-exports (public API) ───────────────────────────────────────

export type {
  Logger,
  GildashOptions,
  SymbolDiff,
  ModuleInterface,
  HeritageNode,
  FullSymbol,
  FileStats,
  FanMetrics,
  ResolvedSymbol,
  BatchParseResult,
} from './types';
export type { GildashInternalOptions } from './lifecycle';

// ─── Gildash Facade ─────────────────────────────────────────────────

/**
 * Main entry point for gildash.
 *
 * `Gildash` indexes TypeScript source code into a local SQLite database,
 * watches for file changes, and provides search / dependency-graph queries.
 *
 * Every public method either returns a value directly or throws a
 * {@link GildashError} on failure — including when called after {@link close}.
 *
 * File paths accepted by query methods are **relative to the project root**
 * (e.g. `'src/utils.ts'`). The `project` parameter defaults to the primary
 * project (first discovered boundary) when omitted.
 *
 * **Path guarantee:** All file paths returned by gildash APIs (`filePath`,
 * `srcFilePath`, `dstFilePath`, `originalFilePath`, etc.) use forward slash
 * (`/`) as separator, regardless of platform. Consumers may safely omit
 * platform-specific path normalization.
 *
 * Create an instance with the static {@link Gildash.open} factory.
 * Always call {@link Gildash.close} when done to release resources.
 */
export class Gildash {
  /** @internal Exposed for advanced testing only. */
  readonly _ctx: GildashContext;

  /** Absolute path to the indexed project root. */
  get projectRoot(): string { return this._ctx.projectRoot; }

  /** Current watcher role: `'owner'` (can write/reindex) or `'reader'` (read-only). */
  get role(): 'owner' | 'reader' { return this._ctx.role; }

  /** Discovered project boundaries within the project root. */
  get projects(): ProjectBoundary[] { return [...this._ctx.boundaries]; }

  private constructor(ctx: GildashContext) {
    this._ctx = ctx;
  }

  /**
   * Create and initialise a new `Gildash` instance.
   *
   * @param options - Project root, extensions, watch mode, and optional DI overrides.
   * @returns A fully initialised instance with the initial index complete.
   * @throws {GildashError} With type `'validation'` if `projectRoot` is invalid,
   *   or type `'store'` if database initialisation fails.
   */
  static async open(options: GildashOptions & Partial<GildashInternalOptions>): Promise<Gildash> {
    const ctx = await initializeContext(options);
    return new Gildash(ctx);
  }

  /**
   * Shut down the instance and release all resources (watcher, database, caches).
   *
   * @param opts.cleanup - When `true`, deletes the `.gildash/` data directory.
   * @throws {GildashError} With type `'closed'` if already closed.
   */
  async close(opts?: { cleanup?: boolean }): Promise<void> {
    return closeContext(this._ctx, opts);
  }

  // ─── Parse ──────────────────────────────────────────────────────

  /**
   * Parse a single source file into an AST. Result is LRU-cached by file path.
   *
   * @param filePath - Absolute path to the source file.
   * @param sourceText - The file's source code.
   * @param options - oxc-parser options (e.g. `sourceType`, `lang`).
   * @returns The parsed AST with source text and comments.
   * @throws {GildashError} With type `'parse'` if oxc-parser fails.
   */
  parseSource(filePath: string, sourceText: string, options?: ParserOptions): ParsedFile {
    return parseApi.parseSource(this._ctx, filePath, sourceText, options);
  }

  /**
   * Parse multiple files concurrently by reading them from disk.
   *
   * @param filePaths - Absolute paths to the source files.
   * @param options - oxc-parser options applied to all files.
   * @returns Parsed results keyed by path, plus an array of failures.
   * @throws {GildashError} With type `'closed'` if the instance is closed.
   */
  async batchParse(filePaths: string[], options?: ParserOptions): Promise<BatchParseResult> {
    return parseApi.batchParse(this._ctx, filePaths, options);
  }

  /**
   * Retrieve a previously parsed AST from the LRU cache.
   *
   * @param filePath - Absolute path used as cache key.
   * @returns The cached `ParsedFile`, or `undefined` if not in cache.
   */
  getParsedAst(filePath: string): ParsedFile | undefined {
    return parseApi.getParsedAst(this._ctx, filePath);
  }

  // ─── Extract ────────────────────────────────────────────────────

  /**
   * Extract symbol declarations from a parsed file.
   *
   * Extracts functions, classes, variables, types, interfaces, enums,
   * and namespaces with their metadata (modifiers, decorators, heritage, etc.).
   *
   * @param parsed - A `ParsedFile` from {@link parseSource} or {@link batchParse}.
   * @returns Array of extracted symbols. Empty array if no declarations found.
   * @throws {GildashError} With type `'extract'` on extraction failure.
   */
  extractSymbols(parsed: ParsedFile): ExtractedSymbol[] {
    return extractApi.extractSymbols(this._ctx, parsed);
  }

  /**
   * Extract inter-file relations from a parsed file.
   *
   * Detects imports, re-exports, function calls, and heritage (extends/implements).
   * Uses `module.staticImports`/`staticExports` when available, with AST fallback.
   *
   * @param parsed - A `ParsedFile` from {@link parseSource} or {@link batchParse}.
   * @returns Array of relations. Empty array if no relations found.
   * @throws {GildashError} With type `'extract'` on extraction failure.
   */
  extractRelations(parsed: ParsedFile): CodeRelation[] {
    return extractApi.extractRelations(this._ctx, parsed);
  }

  // ─── Query ──────────────────────────────────────────────────────

  /**
   * Return aggregate symbol and file counts for a project.
   *
   * @param project - Project name. Defaults to the primary project.
   * @returns Counts of symbols by kind, total files, and total relations.
   * @throws {GildashError} With type `'closed'` if the instance is closed.
   */
  getStats(project?: string): SymbolStats {
    return queryApi.getStats(this._ctx, project);
  }

  /**
   * Search symbols by name, kind, file path, or export status.
   *
   * @param query - Search criteria. Set `query.text` for FTS prefix search,
   *   or `query.text` + `query.exact` for exact name match.
   *   Omit `query.limit` for unlimited results.
   * @returns Matching symbols. Empty array if none found.
   * @throws {GildashError} With type `'closed'` if the instance is closed.
   */
  searchSymbols(query: SymbolSearchQuery): SymbolSearchResult[] {
    return queryApi.searchSymbols(this._ctx, query);
  }

  /**
   * Search relations by type, source/destination file, or symbol name.
   *
   * @param query - Search criteria (e.g. `{ type: 'imports', srcFilePath: 'src/app.ts' }`).
   *   Omit `query.limit` for unlimited results.
   * @returns Matching relations. Empty array if none found.
   * @throws {GildashError} With type `'closed'` if the instance is closed.
   */
  searchRelations(query: RelationSearchQuery): StoredCodeRelation[] {
    return queryApi.searchRelations(this._ctx, query);
  }

  /**
   * Search symbols across all discovered projects (ignores `query.project`).
   *
   * @param query - Same as {@link searchSymbols}.
   * @returns Matching symbols from all projects.
   * @throws {GildashError} With type `'closed'` if the instance is closed.
   */
  searchAllSymbols(query: SymbolSearchQuery): SymbolSearchResult[] {
    return queryApi.searchAllSymbols(this._ctx, query);
  }

  /**
   * Search relations across all discovered projects.
   *
   * @param query - Same as {@link searchRelations}.
   * @returns Matching relations from all projects.
   * @throws {GildashError} With type `'closed'` if the instance is closed.
   */
  searchAllRelations(query: RelationSearchQuery): StoredCodeRelation[] {
    return queryApi.searchAllRelations(this._ctx, query);
  }

  /**
   * List all indexed file records for a project.
   *
   * @param project - Project name. Defaults to the primary project.
   * @returns Array of file records with path, hash, and timestamps.
   * @throws {GildashError} With type `'closed'` if the instance is closed.
   */
  listIndexedFiles(project?: string): FileRecord[] {
    return queryApi.listIndexedFiles(this._ctx, project);
  }

  /**
   * Return relations where both source and destination are within the same file.
   *
   * @param filePath - Relative path to the file (e.g. `'src/app.ts'`).
   * @param project - Project name. Defaults to the primary project.
   * @returns Intra-file relations (calls, heritage within the same file).
   * @throws {GildashError} With type `'closed'` if the instance is closed.
   */
  getInternalRelations(filePath: string, project?: string): StoredCodeRelation[] {
    return queryApi.getInternalRelations(this._ctx, filePath, project);
  }

  /**
   * Return a symbol with its full metadata, or `null` if not found.
   *
   * Includes heritage chain, class members, decorators, parameters,
   * return type, and JSDoc.
   *
   * @param symbolName - Exact symbol name (e.g. `'MyClass'`).
   * @param filePath - Relative path to the declaring file.
   * @param project - Project name. Defaults to the primary project.
   * @returns Full symbol data, or `null` if the symbol is not indexed.
   * @throws {GildashError} With type `'closed'` if the instance is closed.
   */
  getFullSymbol(symbolName: string, filePath: string, project?: string): FullSymbol | null {
    return queryApi.getFullSymbol(this._ctx, symbolName, filePath, project);
  }

  /**
   * Return per-file statistics.
   *
   * @param filePath - Relative path to the file.
   * @param project - Project name. Defaults to the primary project.
   * @returns Symbol count, relation count, and fan-in/fan-out metrics.
   * @throws {GildashError} With type `'closed'` if the instance is closed.
   */
  getFileStats(filePath: string, project?: string): FileStats {
    return queryApi.getFileStats(this._ctx, filePath, project);
  }

  /**
   * Return the indexed file record, or `null` if the file is not indexed.
   *
   * @param filePath - Relative path to the file.
   * @param project - Project name. Defaults to the primary project.
   * @returns File record with hash, mtime, and size, or `null`.
   * @throws {GildashError} With type `'closed'` if the instance is closed.
   */
  getFileInfo(filePath: string, project?: string): FileRecord | null {
    return queryApi.getFileInfo(this._ctx, filePath, project);
  }

  /**
   * Return all symbols declared in a specific file.
   *
   * @param filePath - Relative path to the file.
   * @param project - Project name. Defaults to the primary project.
   * @returns Array of symbols. Empty array if the file has no declarations.
   * @throws {GildashError} With type `'closed'` if the instance is closed.
   */
  getSymbolsByFile(filePath: string, project?: string): SymbolSearchResult[] {
    return queryApi.getSymbolsByFile(this._ctx, filePath, project);
  }

  /**
   * Return the public module interface: exported symbols grouped by kind.
   *
   * @param filePath - Relative path to the file.
   * @param project - Project name. Defaults to the primary project.
   * @returns Module interface with `exports`, `reExports`, and `declarations`.
   * @throws {GildashError} With type `'closed'` if the instance is closed.
   */
  getModuleInterface(filePath: string, project?: string): ModuleInterface {
    return queryApi.getModuleInterface(this._ctx, filePath, project);
  }

  // ─── Graph ──────────────────────────────────────────────────────

  /**
   * Return direct import dependencies of a file (files this file imports from).
   *
   * @param filePath - Relative path to the file.
   * @param project - Project name. Defaults to the primary project.
   * @param limit - Maximum number of results. Defaults to 10,000.
   * @returns Array of relative file paths.
   * @throws {GildashError} With type `'closed'` if the instance is closed.
   */
  getDependencies(filePath: string, project?: string, limit = 10_000): string[] {
    return graphApi.getDependencies(this._ctx, filePath, project, limit);
  }

  /**
   * Return files that directly import the given file (reverse dependencies).
   *
   * @param filePath - Relative path to the file.
   * @param project - Project name. Defaults to the primary project.
   * @param limit - Maximum number of results. Defaults to 10,000.
   * @returns Array of relative file paths.
   * @throws {GildashError} With type `'closed'` if the instance is closed.
   */
  getDependents(filePath: string, project?: string, limit = 10_000): string[] {
    return graphApi.getDependents(this._ctx, filePath, project, limit);
  }

  /**
   * Return all files transitively affected by changes to the given files.
   *
   * Walks the reverse dependency graph from each changed file.
   *
   * @param changedFiles - Relative paths to changed files.
   * @param project - Project name. Defaults to the primary project.
   * @returns Relative paths of all transitively affected files (excluding the input files).
   * @throws {GildashError} With type `'closed'` if the instance is closed.
   */
  async getAffected(changedFiles: string[], project?: string): Promise<string[]> {
    return graphApi.getAffected(this._ctx, changedFiles, project);
  }

  /**
   * Check whether the import graph contains any cycles.
   *
   * @param project - Project name. Defaults to the primary project.
   * @returns `true` if at least one cycle exists.
   * @throws {GildashError} With type `'closed'` if the instance is closed.
   */
  async hasCycle(project?: string): Promise<boolean> {
    return graphApi.hasCycle(this._ctx, project);
  }

  /**
   * Return the full import graph as an adjacency list.
   *
   * @param project - Project name. Defaults to the primary project.
   * @returns Map where each key is a relative file path and the value is
   *   an array of files it directly imports.
   * @throws {GildashError} With type `'closed'` if the instance is closed.
   */
  async getImportGraph(project?: string): Promise<Map<string, string[]>> {
    return graphApi.getImportGraph(this._ctx, project);
  }

  /**
   * Return all files that the given file transitively depends on.
   *
   * @param filePath - Relative path to the file.
   * @param project - Project name. Defaults to the primary project.
   * @returns Relative paths of all transitive dependencies.
   * @throws {GildashError} With type `'closed'` if the instance is closed.
   */
  async getTransitiveDependencies(filePath: string, project?: string): Promise<string[]> {
    return graphApi.getTransitiveDependencies(this._ctx, filePath, project);
  }

  /**
   * Return all files that transitively depend on the given file.
   *
   * @param filePath - Relative path to the file.
   * @param project - Project name. Defaults to the primary project.
   * @returns Relative paths of all transitive dependents.
   * @throws {GildashError} With type `'closed'` if the instance is closed.
   */
  async getTransitiveDependents(filePath: string, project?: string): Promise<string[]> {
    return graphApi.getTransitiveDependents(this._ctx, filePath, project);
  }

  /**
   * Return all cycle paths in the import graph.
   *
   * @param project - Project name. Defaults to the primary project.
   * @param options.maxCycles - Stop after finding this many cycles.
   * @returns Array of cycles, where each cycle is an array of relative file paths
   *   forming the loop (last file imports the first).
   * @throws {GildashError} With type `'closed'` if the instance is closed.
   */
  async getCyclePaths(project?: string, options?: { maxCycles?: number }): Promise<string[][]> {
    return graphApi.getCyclePaths(this._ctx, project, options);
  }

  /**
   * Return fan-in (dependents count) and fan-out (dependencies count) for a file.
   *
   * @param filePath - Relative path to the file.
   * @param project - Project name. Defaults to the primary project.
   * @returns `{ fanIn, fanOut }` counts.
   * @throws {GildashError} With type `'closed'` if the instance is closed.
   */
  async getFanMetrics(filePath: string, project?: string): Promise<FanMetrics> {
    return graphApi.getFanMetrics(this._ctx, filePath, project);
  }

  // ─── Semantic ───────────────────────────────────────────────────
  //
  // Semantic methods use the tsc TypeChecker for type-level analysis.
  // They require a tsconfig.json in the project root and are opt-in
  // (the semantic layer is initialised lazily on first call).
  //
  // Position-based methods (`*AtPosition`) accept byte offsets.
  // Line/column-based methods accept 1-based line and 0-based column.

  /**
   * Return the resolved type tree for the given symbol.
   *
   * The returned tree is always a bounded, finite, acyclic structure.
   * At the truncation boundary `members` and `typeArguments` will be
   * `undefined`, but `text` always contains the full type string.
   *
   * @param symbolName - Exact symbol name.
   * @param filePath - Relative path to the declaring file.
   * @param project - Project name. Defaults to the primary project.
   * @returns Resolved type tree, or `null` if the symbol cannot be found by tsc.
   * @throws {GildashError} With type `'semantic'` if tsc initialisation fails.
   */
  getResolvedType(symbolName: string, filePath: string, project?: string): ResolvedType | null {
    return semanticApi.getResolvedType(this._ctx, symbolName, filePath, project);
  }

  /**
   * Find all references to a symbol across the project using tsc.
   *
   * @param symbolName - Exact symbol name.
   * @param filePath - Relative path to the declaring file.
   * @param project - Project name. Defaults to the primary project.
   * @returns Array of reference locations. Empty array if none found.
   * @throws {GildashError} With type `'semantic'` if tsc initialisation fails.
   */
  getSemanticReferences(symbolName: string, filePath: string, project?: string): SemanticReference[] {
    return semanticApi.getSemanticReferences(this._ctx, symbolName, filePath, project);
  }

  /**
   * Find all implementations of an interface or abstract class member.
   *
   * @param symbolName - Exact symbol name.
   * @param filePath - Relative path to the declaring file.
   * @param project - Project name. Defaults to the primary project.
   * @returns Array of implementation locations. Empty array if none found.
   * @throws {GildashError} With type `'semantic'` if tsc initialisation fails.
   */
  getImplementations(symbolName: string, filePath: string, project?: string): Implementation[] {
    return semanticApi.getImplementations(this._ctx, symbolName, filePath, project);
  }

  /**
   * Check if the source symbol's type is assignable to the target symbol's type.
   *
   * @param sourceSymbol - Name of the source symbol.
   * @param sourceFilePath - Relative path to the source symbol's file.
   * @param targetSymbol - Name of the target symbol.
   * @param targetFilePath - Relative path to the target symbol's file.
   * @param project - Project name. Defaults to the primary project.
   * @returns `true` if assignable, `false` if not, `null` if either symbol cannot be resolved.
   * @throws {GildashError} With type `'semantic'` if tsc initialisation fails.
   */
  isTypeAssignableTo(
    sourceSymbol: string,
    sourceFilePath: string,
    targetSymbol: string,
    targetFilePath: string,
    project?: string,
  ): boolean | null {
    return semanticApi.isTypeAssignableTo(
      this._ctx,
      sourceSymbol,
      sourceFilePath,
      targetSymbol,
      targetFilePath,
      project,
    );
  }

  /**
   * Return the module's semantic interface: exports with resolved type information from tsc.
   *
   * @param filePath - Relative path to the file.
   * @returns Semantic module interface with typed export entries.
   * @throws {GildashError} With type `'semantic'` if tsc initialisation fails.
   */
  getSemanticModuleInterface(filePath: string): SemanticModuleInterface {
    return semanticApi.getSemanticModuleInterface(this._ctx, filePath);
  }

  /**
   * Return resolved types for all declarations in a file, keyed by byte position.
   *
   * @param filePath - Relative path to the file.
   * @returns Map from byte offset to resolved type tree.
   * @throws {GildashError} With type `'semantic'` if tsc initialisation fails.
   */
  getFileTypes(filePath: string): Map<number, ResolvedType> {
    return semanticApi.getFileTypes(this._ctx, filePath);
  }

  /**
   * Return the resolved type at a specific line and column.
   *
   * @param filePath - Relative path to the file.
   * @param line - 1-based line number.
   * @param column - 0-based column number.
   * @returns Resolved type tree, or `null` if no type is found at that position.
   * @throws {GildashError} With type `'semantic'` if tsc initialisation fails.
   */
  getResolvedTypeAt(filePath: string, line: number, column: number): ResolvedType | null {
    return semanticApi.getResolvedTypeAt(this._ctx, filePath, line, column);
  }

  /**
   * Check if the type at the source position is assignable to the type at the target position.
   *
   * @param opts.source - Source location (file, line, column).
   * @param opts.target - Target location (file, line, column).
   * @returns `true` if assignable, `false` if not, `null` if either type cannot be resolved.
   * @throws {GildashError} With type `'semantic'` if tsc initialisation fails.
   */
  isTypeAssignableToAt(opts: {
    source: { filePath: string; line: number; column: number };
    target: { filePath: string; line: number; column: number };
  }): boolean | null {
    return semanticApi.isTypeAssignableToAt(this._ctx, opts);
  }

  /**
   * Return the resolved type at a specific byte position.
   *
   * @param filePath - Relative path to the file.
   * @param position - 0-based byte offset in the file.
   * @returns Resolved type tree, or `null` if no type is found at that position.
   * @throws {GildashError} With type `'semantic'` if tsc initialisation fails.
   */
  getResolvedTypeAtPosition(filePath: string, position: number): ResolvedType | null {
    return semanticApi.getResolvedTypeAtPosition(this._ctx, filePath, position);
  }

  /**
   * Find all semantic references to the symbol at a specific byte position.
   *
   * @param filePath - Relative path to the file.
   * @param position - 0-based byte offset of the symbol.
   * @returns Array of reference locations. Empty array if none found.
   * @throws {GildashError} With type `'semantic'` if tsc initialisation fails.
   */
  getSemanticReferencesAtPosition(filePath: string, position: number): SemanticReference[] {
    return semanticApi.getSemanticReferencesAtPosition(this._ctx, filePath, position);
  }

  /**
   * Find all implementations of the symbol at a specific byte position.
   *
   * @param filePath - Relative path to the file.
   * @param position - 0-based byte offset of the symbol.
   * @returns Array of implementation locations. Empty array if none found.
   * @throws {GildashError} With type `'semantic'` if tsc initialisation fails.
   */
  getImplementationsAtPosition(filePath: string, position: number): Implementation[] {
    return semanticApi.getImplementationsAtPosition(this._ctx, filePath, position);
  }

  /**
   * Check type assignability between two byte positions.
   *
   * @param srcFilePath - Relative path to the source file.
   * @param srcPosition - 0-based byte offset of the source type.
   * @param dstFilePath - Relative path to the target file.
   * @param dstPosition - 0-based byte offset of the target type.
   * @returns `true` if assignable, `false` if not, `null` if either type cannot be resolved.
   * @throws {GildashError} With type `'semantic'` if tsc initialisation fails.
   */
  isTypeAssignableToAtPosition(
    srcFilePath: string,
    srcPosition: number,
    dstFilePath: string,
    dstPosition: number,
  ): boolean | null {
    return semanticApi.isTypeAssignableToAtPosition(
      this._ctx, srcFilePath, srcPosition, dstFilePath, dstPosition,
    );
  }

  /**
   * Check if the type at a position is assignable to a type expression string.
   *
   * @param filePath - Relative path to the file.
   * @param position - 0-based byte offset of the source type.
   * @param targetTypeExpression - A TypeScript type expression to check against (e.g. `'string | number'`).
   * @param options.anyConstituent - When `true`, passes if any union constituent is assignable.
   * @returns `true` if assignable, `false` if not, `null` if the source type cannot be resolved.
   * @throws {GildashError} With type `'semantic'` if tsc initialisation fails.
   */
  isTypeAssignableToType(
    filePath: string,
    position: number,
    targetTypeExpression: string,
    options?: { anyConstituent?: boolean },
  ): boolean | null {
    return semanticApi.isTypeAssignableToType(this._ctx, filePath, position, targetTypeExpression, options);
  }

  /**
   * Convert a line/column position to a byte offset.
   *
   * @param filePath - Relative path to the file.
   * @param line - 1-based line number.
   * @param column - 0-based column number.
   * @returns 0-based byte offset, or `null` if the position is out of bounds.
   * @throws {GildashError} With type `'semantic'` if tsc initialisation fails.
   */
  lineColumnToPosition(filePath: string, line: number, column: number): number | null {
    return semanticApi.lineColumnToPosition(this._ctx, filePath, line, column);
  }

  /**
   * Find the byte position of a symbol name within a declaration.
   *
   * Useful for mapping an extracted symbol's span to its exact name position
   * for use with position-based semantic APIs.
   *
   * @param filePath - Relative path to the file.
   * @param declarationPos - Byte offset of the declaration start.
   * @param name - The symbol name to locate within the declaration.
   * @returns 0-based byte offset of the name, or `null` if not found.
   * @throws {GildashError} With type `'semantic'` if tsc initialisation fails.
   */
  findNamePosition(filePath: string, declarationPos: number, name: string): number | null {
    return semanticApi.findNamePosition(this._ctx, filePath, declarationPos, name);
  }

  /**
   * Return the tsc symbol node at a specific byte position.
   *
   * Includes parent/member relationships and symbol flags.
   *
   * @param filePath - Relative path to the file.
   * @param position - 0-based byte offset of the symbol.
   * @returns Symbol node with parent, members, and exports, or `null` if no symbol found.
   * @throws {GildashError} With type `'semantic'` if tsc initialisation fails.
   */
  getSymbolNode(filePath: string, position: number): SymbolNode | null {
    return semanticApi.getSymbolNode(this._ctx, filePath, position);
  }

  /**
   * Return the base types (extends/implements targets) of the symbol at a byte position.
   *
   * @param filePath - Relative path to the file.
   * @param position - 0-based byte offset of the class/interface symbol.
   * @returns Array of resolved base types, or `null` if the symbol has no base types.
   * @throws {GildashError} With type `'semantic'` if tsc initialisation fails.
   */
  getBaseTypes(filePath: string, position: number): ResolvedType[] | null {
    return semanticApi.getBaseTypes(this._ctx, filePath, position);
  }

  /**
   * Return tsc semantic diagnostics for a file (type errors, unused variables, etc.).
   *
   * @param filePath - Relative path to the file.
   * @param options - Filtering options (e.g. severity, category).
   * @returns Array of diagnostics. Empty array if the file has no issues.
   * @throws {GildashError} With type `'semantic'` if tsc initialisation fails.
   */
  getSemanticDiagnostics(filePath: string, options?: GetDiagnosticsOptions): SemanticDiagnostic[] {
    return semanticApi.getSemanticDiagnostics(this._ctx, filePath, options);
  }

  // ─── Misc ───────────────────────────────────────────────────────

  /**
   * Compute the diff between two symbol snapshots.
   *
   * @param before - Symbols from the previous snapshot.
   * @param after - Symbols from the current snapshot.
   * @returns `{ added, removed, modified }` arrays of symbols.
   */
  diffSymbols(before: SymbolSearchResult[], after: SymbolSearchResult[]): SymbolDiff {
    return miscApi.diffSymbols(before, after);
  }

  /**
   * Register a callback invoked after each indexing run completes.
   *
   * @param callback - Receives the {@link IndexResult} with counts of indexed files and symbols.
   * @returns An unsubscribe function. Call it to stop receiving notifications.
   * @throws {GildashError} With type `'closed'` if the instance is closed.
   */
  onIndexed(callback: (result: IndexResult) => void): () => void {
    return miscApi.onIndexed(this._ctx, callback);
  }

  /**
   * Trigger a full re-index of all files.
   *
   * @returns Index result with counts of processed files, symbols, and relations.
   * @throws {GildashError} With type `'closed'` if the instance is closed,
   *   or type `'index'` if indexing fails.
   */
  async reindex(): Promise<IndexResult> {
    return miscApi.reindex(this._ctx);
  }

  /**
   * Follow re-export chains to find the original declaration of a symbol.
   *
   * Traverses `re-exports` relations using `metaJson.specifiers` to map
   * exported names back to their original source.
   *
   * @param symbolName - The exported symbol name to resolve.
   * @param filePath - Relative path to the file exporting the symbol.
   * @param project - Project name. Defaults to the primary project.
   * @returns The original symbol name, file path, re-export chain, and whether a cycle was detected.
   * @throws {GildashError} With type `'closed'` if the instance is closed.
   */
  resolveSymbol(symbolName: string, filePath: string, project?: string): ResolvedSymbol {
    return miscApi.resolveSymbol(this._ctx, symbolName, filePath, project);
  }

  /**
   * Search for structural AST patterns across indexed files using ast-grep.
   *
   * @param pattern - An ast-grep pattern string (e.g. `'console.log($$$)'`).
   * @param opts.filePaths - Restrict search to specific absolute file paths.
   * @param opts.project - Project name. Defaults to the primary project.
   * @returns Array of pattern matches with file path, line, column, and matched text.
   * @throws {GildashError} With type `'closed'` if the instance is closed.
   */
  async findPattern(pattern: string, opts?: { filePaths?: string[]; project?: string }): Promise<PatternMatch[]> {
    return miscApi.findPattern(this._ctx, pattern, opts);
  }

  /**
   * Build the full inheritance chain (extends/implements tree) for a symbol.
   *
   * @param symbolName - Exact symbol name (e.g. `'MyClass'`).
   * @param filePath - Relative path to the declaring file.
   * @param project - Project name. Defaults to the primary project.
   * @returns A tree node with `parents` (what this symbol extends/implements)
   *   and `children` (what extends/implements this symbol), recursively.
   * @throws {GildashError} With type `'closed'` if the instance is closed.
   */
  async getHeritageChain(symbolName: string, filePath: string, project?: string): Promise<HeritageNode> {
    return miscApi.getHeritageChain(this._ctx, symbolName, filePath, project);
  }

  /**
   * Register a callback invoked when a watched file is created, changed, or deleted.
   *
   * @param callback - Receives a {@link FileChangeEvent} with path and event type.
   * @returns An unsubscribe function.
   * @throws {GildashError} With type `'closed'` if the instance is closed.
   */
  onFileChanged(callback: (event: FileChangeEvent) => void): () => void {
    return miscApi.onFileChanged(this._ctx, callback);
  }

  /**
   * Register a callback invoked on internal errors (e.g. healthcheck failures, watcher errors).
   *
   * @param callback - Receives the {@link GildashError}.
   * @returns An unsubscribe function.
   * @throws {GildashError} With type `'closed'` if the instance is closed.
   */
  onError(callback: (error: GildashError) => void): () => void {
    return miscApi.onError(this._ctx, callback);
  }

  /**
   * Register a callback invoked when the watcher role changes.
   *
   * Role changes happen when the current owner goes stale and a reader self-promotes.
   *
   * @param callback - Receives the new role (`'owner'` or `'reader'`).
   * @returns An unsubscribe function.
   * @throws {GildashError} With type `'closed'` if the instance is closed.
   */
  onRoleChanged(callback: (newRole: 'owner' | 'reader') => void): () => void {
    return miscApi.onRoleChanged(this._ctx, callback);
  }

  // ─── Annotation ──────────────────────────────────────────────

  /**
   * Search annotations (custom tags attached to symbols during indexing).
   *
   * @param query - Search criteria (e.g. `{ tag: 'todo', project: 'my-project' }`).
   * @returns Matching annotations. Empty array if none found.
   * @throws {GildashError} With type `'closed'` if the instance is closed.
   */
  searchAnnotations(query: AnnotationSearchQuery): AnnotationSearchResult[] {
    return annotationApi.searchAnnotations(this._ctx, query);
  }

  // ─── Changelog ───────────────────────────────────────────────

  /**
   * Query symbol changes recorded since a given date.
   *
   * @param since - ISO date string or `Date` object. Only changes after this timestamp are returned.
   * @param options - Filtering options (symbol name, file path, change type, limit).
   * @returns Array of symbol changes in chronological order.
   * @throws {GildashError} With type `'closed'` if the instance is closed.
   */
  getSymbolChanges(since: Date | string, options?: SymbolChangeQueryOptions): SymbolChange[] {
    return changelogApi.getSymbolChanges(this._ctx, since, options);
  }

  /**
   * Delete changelog entries older than the given date.
   *
   * @param before - ISO date string or `Date` object. Entries before this timestamp are deleted.
   * @returns The number of deleted changelog rows.
   * @throws {GildashError} With type `'closed'` if the instance is closed.
   */
  pruneChangelog(before: Date | string): number {
    return changelogApi.pruneChangelog(this._ctx, before);
  }
}
