/**
 * SemanticLayer — tsc 기반 시맨틱 분석 계층.
 *
 * TscProgram + TypeCollector + SymbolGraph + ReferenceResolver + ImplementationFinder를
 * 하나의 facade로 통합한다.
 */

import ts from "typescript";
import { err, isErr, type Result } from "@zipbul/result";
import { GildashError } from "../errors";
import { TscProgram, type TscProgramOptions } from "./tsc-program";
import { TypeCollector, buildResolvedType } from "./type-collector";
import { SymbolGraph, type SymbolNode } from "./symbol-graph";
import { ReferenceResolver } from "./reference-resolver";
import { buildStandaloneBindings } from "./standalone-bindings";
import { ImplementationFinder } from "./implementation-finder";
import { findNodeAtPosition } from "./ast-node-utils";
import { buildLineOffsets, getLineColumn } from "../parser/source-position";
import type { LanguagePluginRegistry } from "../lang/registry";
import type { PositionMap } from "../lang/position-map";
import type {
  ResolvedType,
  ByteSpan,
  SemanticReference,
  EnrichedReference,
  FileBinding,
  Implementation,
  SemanticModuleInterface,
  SemanticExport,
  SemanticDiagnostic,
  GetDiagnosticsOptions,
} from "./types";

// ── DI options ───────────────────────────────────────────────────────────────

export interface SemanticLayerOptions extends TscProgramOptions {
  /** Override TypeCollector (for testing). */
  typeCollector?: TypeCollector;
  /** Override SymbolGraph (for testing). */
  symbolGraph?: SymbolGraph;
  /** Override ReferenceResolver (for testing). */
  referenceResolver?: ReferenceResolver;
  /** Override ImplementationFinder (for testing). */
  implementationFinder?: ImplementationFinder;
}

// ── 선언 식별 헬퍼 ───────────────────────────────────────────────────────────

/** export 키워드가 있는지 확인 */
function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true
  );
}

/** 선언 노드의 kind를 문자열로 분류 */
function classifyDeclKind(node: ts.Node): string {
  if (ts.isFunctionDeclaration(node)) return "function";
  if (ts.isClassDeclaration(node)) return "class";
  if (ts.isInterfaceDeclaration(node)) return "interface";
  if (ts.isTypeAliasDeclaration(node)) return "type";
  if (ts.isEnumDeclaration(node)) return "enum";
  if (ts.isVariableDeclaration(node)) return "const";
  if (ts.isVariableStatement(node)) return "const";
  return "unknown";
}

/** charCode가 JS 식별자 문자(letter, digit, _, $)인지 판별 */
function isIdentifierChar(charCode: number): boolean {
  // a-z
  if (charCode >= 0x61 && charCode <= 0x7a) return true;
  // A-Z
  if (charCode >= 0x41 && charCode <= 0x5a) return true;
  // 0-9
  if (charCode >= 0x30 && charCode <= 0x39) return true;
  // _ or $
  if (charCode === 0x5f || charCode === 0x24) return true;
  return false;
}

// ── SemanticLayer ────────────────────────────────────────────────────────────

export class SemanticLayer {
  readonly #program: TscProgram;
  readonly #typeCollector: TypeCollector;
  readonly #symbolGraph: SymbolGraph;
  readonly #referenceResolver: ReferenceResolver;
  readonly #implementationFinder: ImplementationFinder;
  readonly #registry: LanguagePluginRegistry | null;
  #isDisposed = false;

  private constructor(
    program: TscProgram,
    typeCollector: TypeCollector,
    symbolGraph: SymbolGraph,
    referenceResolver: ReferenceResolver,
    implementationFinder: ImplementationFinder,
    registry: LanguagePluginRegistry | null,
  ) {
    this.#program = program;
    this.#typeCollector = typeCollector;
    this.#symbolGraph = symbolGraph;
    this.#referenceResolver = referenceResolver;
    this.#implementationFinder = implementationFinder;
    this.#registry = registry;
  }

  /**
   * Create a SemanticLayer from a tsconfig.json path.
   *
   * Internally creates TscProgram and all sub-modules.
   * DI overrides via `options` for testing.
   */
  static create(
    tsconfigPath: string,
    options: SemanticLayerOptions = {},
  ): Result<SemanticLayer, GildashError> {
    const programResult = TscProgram.create(tsconfigPath, {
      readConfigFile: options.readConfigFile,
      resolveNonTrackedFile: options.resolveNonTrackedFile,
      registry: options.registry,
    });
    if (isErr(programResult)) return programResult;

    const program = programResult;

    const typeCollector = options.typeCollector ?? new TypeCollector(program);
    const symbolGraph = options.symbolGraph ?? new SymbolGraph(program);
    const referenceResolver = options.referenceResolver ?? new ReferenceResolver(program);
    const implementationFinder = options.implementationFinder ?? new ImplementationFinder(program);

    return new SemanticLayer(
      program,
      typeCollector,
      symbolGraph,
      referenceResolver,
      implementationFinder,
      options.registry ?? null,
    );
  }

  // ── Read-only state ─────────────────────────────────────────────────────

  get isDisposed(): boolean {
    return this.#isDisposed;
  }

  // ── Type collection ─────────────────────────────────────────────────────

  // ── Raw↔virtual boundary (language plugins) ──────────────────────────────
  // Public surfaces speak RAW file coordinates. Sub-modules and the checker
  // speak virtual. Inputs translate here; outputs translate back; positions
  // outside mapped script regions degrade to null/[] — never approximate.

  /** Query file for `filePath` (virtual module for plugin files). */
  #queryFile(filePath: string): string {
    return this.#program.getVirtualTarget(filePath)?.virtualPath ?? filePath;
  }

  /** Query file+position; `null` when the raw position is outside script regions. */
  #queryPos(filePath: string, position: number): { file: string; position: number } | null {
    const target = this.#program.getVirtualTarget(filePath);
    if (!target) return { file: filePath, position };
    const virtualPosition = target.toVirtualOffset(position);
    return virtualPosition === null ? null : { file: target.virtualPath, position: virtualPosition };
  }

  /** Query file+span; `null` when either edge is unmapped. */
  #querySpan(filePath: string, span: ByteSpan): { file: string; span: ByteSpan } | null {
    const target = this.#program.getVirtualTarget(filePath);
    if (!target) return { file: filePath, span };
    const start = target.toVirtualOffset(span.start);
    const end = target.toVirtualEndOffset(span.end);
    return start === null || end === null ? null : { file: target.virtualPath, span: { start, end } };
  }

  /** Translate a reference-shaped result back to raw coordinates. */
  #toRawReference<T extends SemanticReference>(ref: T): T | null {
    const loc = this.#program.toRawLocation(ref.filePath, ref.position);
    if (!loc) return null;
    if (loc.filePath === ref.filePath) return ref;
    const lineColumn = this.#program.rawLineColumn(loc.filePath, loc.position);
    return {
      ...ref,
      filePath: loc.filePath,
      position: loc.position,
      line: lineColumn?.line ?? ref.line,
      column: lineColumn?.column ?? ref.column,
    };
  }

  collectTypeAt(filePath: string, position: number): ResolvedType | null {
    this.#assertNotDisposed();
    const q = this.#queryPos(filePath, position);
    return q ? this.#typeCollector.collectAt(q.file, q.position) : null;
  }

  collectFileTypes(filePath: string): Map<number, ResolvedType> {
    this.#assertNotDisposed();
    const virtual = this.#typeCollector.collectFile(this.#queryFile(filePath));
    const target = this.#program.getVirtualTarget(filePath);
    if (!target) return virtual;
    const raw = new Map<number, ResolvedType>();
    for (const [position, type] of virtual) {
      const loc = this.#program.toRawLocation(target.virtualPath, position);
      if (loc) raw.set(loc.position, type);
    }
    return raw;
  }

  collectTypesAtPositions(
    filePath: string,
    positions: number[],
  ): Map<number, ResolvedType> {
    this.#assertNotDisposed();
    const target = this.#program.getVirtualTarget(filePath);
    if (!target) return this.#typeCollector.collectAtPositions(filePath, positions);
    // Query with translated positions, key results by the caller's RAW positions.
    const rawByVirtual = new Map<number, number>();
    for (const raw of positions) {
      const v = target.toVirtualOffset(raw);
      if (v !== null) rawByVirtual.set(v, raw);
    }
    const virtual = this.#typeCollector.collectAtPositions(target.virtualPath, [...rawByVirtual.keys()]);
    const result = new Map<number, ResolvedType>();
    for (const [v, type] of virtual) {
      const raw = rawByVirtual.get(v);
      if (raw !== undefined) result.set(raw, type);
    }
    return result;
  }

  // ── Span-based primitives (firebat error-flow) ──────────────────────────

  collectAtSpan(filePath: string, span: ByteSpan): ResolvedType | null {
    this.#assertNotDisposed();
    const q = this.#querySpan(filePath, span);
    return q ? this.#typeCollector.collectAtSpan(q.file, q.span) : null;
  }

  isThenableAtSpan(
    filePath: string,
    span: ByteSpan,
    options?: { anyConstituent?: boolean },
  ): boolean | null {
    this.#assertNotDisposed();
    const q = this.#querySpan(filePath, span);
    return q ? this.#typeCollector.isThenableAtSpan(q.file, q.span, options) : null;
  }

  contextualCallReturnsAtSpan(filePath: string, span: ByteSpan): ResolvedType[] | null {
    this.#assertNotDisposed();
    const q = this.#querySpan(filePath, span);
    return q ? this.#typeCollector.contextualCallReturnsAtSpan(q.file, q.span) : null;
  }

  isTypeAssignableToTypeAtSpan(
    filePath: string,
    span: ByteSpan,
    targetTypeExpression: string,
    options?: { anyConstituent?: boolean },
  ): boolean | null {
    this.#assertNotDisposed();
    const q = this.#querySpan(filePath, span);
    return q ? this.#typeCollector.isAssignableToTypeAtSpan(q.file, q.span, targetTypeExpression, options) : null;
  }

  // ── Semantic references ─────────────────────────────────────────────────

  findReferences(filePath: string, position: number): SemanticReference[] {
    this.#assertNotDisposed();
    const q = this.#queryPos(filePath, position);
    if (!q) return [];
    return this.#referenceResolver.findAt(q.file, q.position)
      .map((ref) => this.#toRawReference(ref))
      .filter((ref): ref is SemanticReference => ref !== null);
  }

  findEnrichedReferences(filePath: string, position: number): EnrichedReference[] {
    this.#assertNotDisposed();
    const q = this.#queryPos(filePath, position);
    if (!q) return [];
    return this.#referenceResolver.findEnrichedAt(q.file, q.position)
      .map((ref) => this.#toRawReference(ref))
      .filter((ref): ref is EnrichedReference => ref !== null);
  }

  getFileBindings(filePath: string): FileBinding[] {
    this.#assertNotDisposed();
    return this.#referenceResolver.findFileBindings(this.#queryFile(filePath))
      .map((binding) => this.#toRawBinding(binding))
      .filter((binding): binding is FileBinding => binding !== null);
  }

  /** Translate a FileBinding's declaration + references to raw coordinates. */
  #toRawBinding(binding: FileBinding): FileBinding | null {
    const declaration = this.#program.toRawLocation(
      binding.declaration.filePath,
      binding.declaration.position,
    );
    if (!declaration) return null;
    return {
      declaration: { ...binding.declaration, filePath: declaration.filePath, position: declaration.position },
      references: binding.references
        .map((ref) => this.#toRawReference(ref))
        .filter((ref): ref is EnrichedReference => ref !== null),
    };
  }

  /**
   * Resolve bindings for a self-contained in-memory source in ISOLATION — a
   * throwaway single-file program that never touches the shared project program.
   * `O(file)` and constant regardless of project size, unlike notifying an ad-hoc
   * file (which invalidates the whole TypeChecker). Local binding identity is
   * identical to {@link getFileBindings}; cross-file imports and global/lib
   * symbols are not resolved (omitted) — for those use {@link getFileBindings}.
   */
  getStandaloneFileBindings(filePath: string, content: string): FileBinding[] {
    this.#assertNotDisposed();
    const o = this.#program.getCompilerOptions();
    const parseOptions = {
      target: o.target,
      module: o.module,
      jsx: o.jsx,
      jsxFactory: o.jsxFactory,
      jsxFragmentFactory: o.jsxFragmentFactory,
      jsxImportSource: o.jsxImportSource,
      experimentalDecorators: o.experimentalDecorators,
      useDefineForClassFields: o.useDefineForClassFields,
    };

    // Plugin files (e.g. Vue SFC): feed the extracted TS script — not the raw
    // markup — to the throwaway program, then translate binding positions back
    // to RAW file coordinates. Identity for plain TS/JS.
    const plugin = this.#registry?.pluginFor(filePath);
    if (!plugin) return buildStandaloneBindings(filePath, content, parseOptions);

    // Build over a TS-suffixed virtual name so the throwaway program parses the
    // extracted script as TypeScript (a `.vue` root is excluded from tsc's
    // program). Declaration/reference file paths + positions are translated
    // back to the RAW `.vue` file.
    const { parseText, map, lang } = plugin.transform(filePath, content);
    const virtualName = `${filePath}.__standalone__.${lang ?? "ts"}`;
    const bindings = buildStandaloneBindings(virtualName, parseText, parseOptions);
    if (!map) {
      return bindings.map((binding) => this.#reparentBinding(binding, filePath));
    }

    const rawLineOffsets = buildLineOffsets(content);
    return bindings
      .map((binding) => this.#remapStandaloneBinding(binding, map, rawLineOffsets, filePath))
      .filter((binding): binding is FileBinding => binding !== null);
  }

  /** Point a standalone binding's file paths at the raw plugin file (identity-map case). */
  #reparentBinding(binding: FileBinding, rawFilePath: string): FileBinding {
    return {
      declaration: { ...binding.declaration, filePath: rawFilePath },
      references: binding.references.map((ref) => ({ ...ref, filePath: rawFilePath })),
    };
  }

  /** Translate a standalone binding's file paths + offsets (virtual) to raw; drop if unmapped. */
  #remapStandaloneBinding(
    binding: FileBinding,
    map: PositionMap,
    rawLineOffsets: number[],
    rawFilePath: string,
  ): FileBinding | null {
    const declPosition = map.toRaw(binding.declaration.position);
    if (declPosition === null) return null;
    const references = binding.references.flatMap((ref) => {
      const position = map.toRaw(ref.position);
      if (position === null) return [];
      const lineColumn = getLineColumn(rawLineOffsets, position);
      return [{ ...ref, filePath: rawFilePath, position, line: lineColumn.line, column: lineColumn.column }];
    });
    return {
      declaration: { ...binding.declaration, filePath: rawFilePath, position: declPosition },
      references,
    };
  }

  /**
   * Register all `files` then collect their bindings, keyed by file path. Notifies
   * every file *before* any query so the Program rebuilds once (O(1)) instead of
   * once per file — interleaved notify/query otherwise forces a rebuild per query.
   */
  getFileBindingsBatch(
    files: ReadonlyArray<{ filePath: string; content: string }>,
  ): Map<string, FileBinding[]> {
    this.#assertNotDisposed();
    // Route through notifyFileChanged (not #program directly) so the SymbolGraph
    // cache is invalidated per file — otherwise a primed getSymbolNode goes stale.
    for (const f of files) this.notifyFileChanged(f.filePath, f.content);
    const result = new Map<string, FileBinding[]>();
    for (const f of files) {
      result.set(f.filePath, this.getFileBindings(f.filePath));
    }
    return result;
  }

  // ── Implementations ─────────────────────────────────────────────────────

  findImplementations(filePath: string, position: number): Implementation[] {
    this.#assertNotDisposed();
    const q = this.#queryPos(filePath, position);
    if (!q) return [];
    return this.#implementationFinder.findAt(q.file, q.position)
      .flatMap((impl) => {
        const loc = this.#program.toRawLocation(impl.filePath, impl.position);
        return loc ? [{ ...impl, filePath: loc.filePath, position: loc.position }] : [];
      });
  }

  // ── Type assignability ─────────────────────────────────────────────

  isTypeAssignableTo(
    sourceFilePath: string,
    sourcePosition: number,
    targetFilePath: string,
    targetPosition: number,
  ): boolean | null {
    this.#assertNotDisposed();
    const src = this.#queryPos(sourceFilePath, sourcePosition);
    const tgt = this.#queryPos(targetFilePath, targetPosition);
    if (!src || !tgt) return null;
    return this.#typeCollector.isAssignableTo(src.file, src.position, tgt.file, tgt.position);
  }

  /**
   * Check whether the type at `position` is assignable to a type described
   * by `targetTypeExpression` (e.g. `'PromiseLike<any>'`, `'Error'`).
   */
  isTypeAssignableToType(
    filePath: string,
    position: number,
    targetTypeExpression: string,
    options?: { anyConstituent?: boolean },
  ): boolean | null {
    this.#assertNotDisposed();
    const q = this.#queryPos(filePath, position);
    return q ? this.#typeCollector.isAssignableToType(q.file, q.position, targetTypeExpression, options) : null;
  }

  isTypeAssignableToTypeAtPositions(
    filePath: string,
    positions: number[],
    targetTypeExpression: string,
    options?: { anyConstituent?: boolean },
  ): Map<number, boolean> {
    this.#assertNotDisposed();
    const target = this.#program.getVirtualTarget(filePath);
    if (!target) {
      return this.#typeCollector.isAssignableToTypeAtPositions(filePath, positions, targetTypeExpression, options);
    }
    const rawByVirtual = new Map<number, number>();
    for (const raw of positions) {
      const v = target.toVirtualOffset(raw);
      if (v !== null) rawByVirtual.set(v, raw);
    }
    const virtual = this.#typeCollector.isAssignableToTypeAtPositions(
      target.virtualPath, [...rawByVirtual.keys()], targetTypeExpression, options,
    );
    const result = new Map<number, boolean>();
    for (const [v, ok] of virtual) {
      const raw = rawByVirtual.get(v);
      if (raw !== undefined) result.set(raw, ok);
    }
    return result;
  }

  // ── Symbol graph ────────────────────────────────────────────────────────

  getSymbolNode(filePath: string, position: number): SymbolNode | null {
    this.#assertNotDisposed();
    const q = this.#queryPos(filePath, position);
    return q ? this.#symbolGraph.get(q.file, q.position) : null;
  }

  // ── Base types (inheritance chain) ──────────────────────────────────────

  /**
   * Return the base types (supertypes) of the class/interface at the given position.
   *
   * Uses `checker.getBaseTypes()` which only works on interface/class types.
   * Returns `null` if the type at position is not a class or interface.
   */
  getBaseTypes(filePath: string, position: number): ResolvedType[] | null {
    this.#assertNotDisposed();
    const q = this.#queryPos(filePath, position);
    if (!q) return null;

    const tsProgram = this.#program.getProgram();
    const sourceFile = tsProgram.getSourceFile(q.file);
    if (!sourceFile) return null;

    const node = findNodeAtPosition(sourceFile, q.position);
    if (!node) return null;

    const checker = tsProgram.getTypeChecker();
    const type = checker.getTypeAtLocation(node);

    // getBaseTypes only works on InterfaceType (class & interface)
    if (
      !(type.flags & ts.TypeFlags.Object) ||
      !((type as ts.ObjectType).objectFlags & ts.ObjectFlags.ClassOrInterface)
    ) {
      return null;
    }

    const baseTypes = checker.getBaseTypes(type as ts.InterfaceType);
    if (!baseTypes || baseTypes.length === 0) return [];

    const seen = new Map<ts.Type, ResolvedType>();
    return baseTypes.map((bt) => buildResolvedType(checker, bt, 0, seen));
  }

  // ── Module interface ────────────────────────────────────────────────────

  getModuleInterface(filePath: string): SemanticModuleInterface {
    this.#assertNotDisposed();

    const exports: SemanticExport[] = [];

    const tsProgram = this.#program.getProgram();
    const sourceFile = tsProgram.getSourceFile(this.#queryFile(filePath));
    if (!sourceFile) return { filePath, exports };

    const checker = tsProgram.getTypeChecker();
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);

    if (moduleSymbol) {
      // Use checker.getExportsOfModule() — catches indirect exports, re-exports,
      // and `export =` that AST walking misses.
      const exportedSymbols = checker.getExportsOfModule(moduleSymbol);
      const seen = new Map<ts.Type, ResolvedType>();

      for (const exportSym of exportedSymbols) {
        const name = exportSym.getName();

        // Classify the export kind from its declaration
        const decl = exportSym.declarations?.[0];
        let kind = "unknown";
        if (decl) {
          kind = classifyDeclKind(decl);
          // Variable declarations are children of VariableDeclarationList -> VariableStatement
          if (kind === "unknown" && ts.isExportAssignment(decl)) {
            kind = "const";
          }
        }

        // Build resolved type via checker
        let resolvedType: ResolvedType | null = null;
        try {
          const type = checker.getTypeOfSymbolAtLocation(exportSym, decl ?? sourceFile);
          resolvedType = buildResolvedType(checker, type, 0, seen);
        } catch {
          // Type resolution failure — leave as null
        }

        exports.push({ name, kind, resolvedType });
      }
    }

    return { filePath, exports };
  }

  // ── Incremental update ──────────────────────────────────────────────────

  notifyFileChanged(filePath: string, content: string): void {
    if (this.#isDisposed) return;
    this.#program.notifyFileChanged(filePath, content);
    // Clear the whole SymbolGraph cache, not just this file: a cached node's
    // members/exports may be derived cross-file (via getAliasedSymbol), so a
    // dependent file's node goes stale when this file changes. The cache is a
    // cheap convenience layer (it does not gate the tsc Program recompute), so
    // clearing it wholesale is correct without undermining the notify dedup.
    this.#symbolGraph.clear();
  }

  /**
   * Remove a tracked file from the tsc program and invalidate its symbol graph entries.
   *
   * Call this when a file is deleted from disk so the LanguageService no longer
   * reports stale references or type information for it.
   *
   * No-op if already disposed.
   */
  notifyFileDeleted(filePath: string): void {
    if (this.#isDisposed) return;
    this.#program.removeFile(filePath);
    // Clear all cached nodes — a deleted file's symbols may back other files'
    // cached members/exports (see notifyFileChanged).
    this.#symbolGraph.clear();
  }

  // ── Position conversion ──────────────────────────────────────────────

  /**
   * Convert 1-based line + 0-based column to a byte offset using tsc SourceFile.
   * Returns `null` when the file is not part of the program.
   */
  lineColumnToPosition(filePath: string, line: number, column: number): number | null {
    this.#assertNotDisposed();
    // Plugin files: raw line/column → raw offset over the RAW text (the program
    // only knows the virtual module; raw coordinates never touch it).
    if (this.#program.getVirtualTarget(filePath)) {
      return this.#program.rawOffsetOf(filePath, line, column);
    }
    const sourceFile = this.#program.getProgram().getSourceFile(filePath);
    if (!sourceFile) return null;
    try {
      return ts.getPositionOfLineAndCharacter(sourceFile, line - 1, column);
    } catch {
      return null;
    }
  }

  // ── Name position lookup ────────────────────────────────────────────────

  /**
   * Find the byte offset of a symbol **name** starting from its declaration position.
   *
   * `declarationPos` typically points to the `export` keyword (the declaration start
   * stored in the DB), while the symbol name sits a few tokens ahead.
   * Uses a simple text search to locate the first occurrence of `name` after `declarationPos`.
   *
   * Returns `null` when the file is not in the program or the name is not found.
   */
  findNamePosition(filePath: string, declarationPos: number, name: string): number | null {
    this.#assertNotDisposed();
    const q = this.#queryPos(filePath, declarationPos);
    if (!q) return null;
    const sourceFile = this.#program.getProgram().getSourceFile(q.file);
    if (!sourceFile) return null;
    const text = sourceFile.getFullText();
    let searchFrom = q.position;
    while (searchFrom < text.length) {
      const idx = text.indexOf(name, searchFrom);
      if (idx < 0) return null;

      // Word boundary check: preceding char must be non-identifier, or idx === 0
      const before = idx > 0 ? text.charCodeAt(idx - 1) : 0x20; // space
      const after = idx + name.length < text.length ? text.charCodeAt(idx + name.length) : 0x20;
      if (!isIdentifierChar(before) && !isIdentifierChar(after)) {
        return this.#program.toRawLocation(q.file, idx)?.position ?? null;
      }

      searchFrom = idx + 1;
    }
    return null;
  }

  // ── Diagnostics ─────────────────────────────────────────────────────────

  /**
   * Return tsc diagnostics for an indexed file.
   *
   * Only files previously registered via `notifyFileChanged` produce
   * meaningful results. Non-indexed files return an empty array.
   *
   * @param options.preEmit When `true`, uses `ts.getPreEmitDiagnostics()` which
   *   includes syntactic, semantic, and declaration diagnostics (equivalent to
   *   `tsc --noEmit`). Default: `false` (semantic diagnostics only).
   */
  getDiagnostics(filePath: string, options?: GetDiagnosticsOptions): SemanticDiagnostic[] {
    this.#assertNotDisposed();
    const program = this.#program.getProgram();
    const sourceFile = program.getSourceFile(this.#queryFile(filePath));
    if (!sourceFile) return [];

    const categoryMap: Record<number, SemanticDiagnostic['category']> = {
      [ts.DiagnosticCategory.Error]: 'error',
      [ts.DiagnosticCategory.Warning]: 'warning',
      [ts.DiagnosticCategory.Suggestion]: 'suggestion',
      [ts.DiagnosticCategory.Message]: 'suggestion',
    };

    const diagnostics = options?.preEmit
      ? ts.getPreEmitDiagnostics(program, sourceFile)
      : program.getSemanticDiagnostics(sourceFile);

    return diagnostics.flatMap((d) => {
      let diagFilePath = d.file?.fileName ?? filePath;
      let line = 1;
      let column = 0;
      if (d.file && d.start !== undefined) {
        // Virtual diagnostics surface at RAW coordinates; unmapped ones
        // (synthetic text) are dropped rather than reported approximately.
        const loc = this.#program.toRawLocation(d.file.fileName, d.start);
        if (!loc) return [];
        diagFilePath = loc.filePath;
        if (loc.filePath === d.file.fileName) {
          const pos = ts.getLineAndCharacterOfPosition(d.file, d.start);
          line = pos.line + 1;
          column = pos.character;
        } else {
          const rawLineColumn = this.#program.rawLineColumn(loc.filePath, loc.position);
          if (!rawLineColumn) return [];
          line = rawLineColumn.line;
          column = rawLineColumn.column;
        }
      }
      return [{
        filePath: diagFilePath,
        line,
        column,
        message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
        code: d.code,
        category: categoryMap[d.category] ?? 'error',
      }];
    });
  }

  /** Whether `filePath` is present in this program (and thus has full semantic answers). */
  isFileInSemanticProgram(filePath: string): boolean {
    this.#assertNotDisposed();
    // A raw plugin file is "in" the program when its virtual module is.
    const target = this.#program.getVirtualTarget(filePath);
    const queryFile = target?.virtualPath ?? filePath;
    return this.#program.getProgram().getSourceFile(queryFile) !== undefined;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  dispose(): void {
    if (this.#isDisposed) return;
    this.#isDisposed = true;
    this.#typeCollector.clearProbe();
    this.#program.dispose();
    this.#symbolGraph.clear();
  }

  // ── Internal ────────────────────────────────────────────────────────────

  #assertNotDisposed(): void {
    if (this.#isDisposed) {
      throw new Error("SemanticLayer is disposed");
    }
  }
}
