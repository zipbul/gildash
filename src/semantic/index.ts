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
import { ImplementationFinder } from "./implementation-finder";
import { findNodeAtPosition } from "./ast-node-utils";
import type {
  ResolvedType,
  SemanticReference,
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
  #isDisposed = false;

  private constructor(
    program: TscProgram,
    typeCollector: TypeCollector,
    symbolGraph: SymbolGraph,
    referenceResolver: ReferenceResolver,
    implementationFinder: ImplementationFinder,
  ) {
    this.#program = program;
    this.#typeCollector = typeCollector;
    this.#symbolGraph = symbolGraph;
    this.#referenceResolver = referenceResolver;
    this.#implementationFinder = implementationFinder;
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
    );
  }

  // ── Read-only state ─────────────────────────────────────────────────────

  get isDisposed(): boolean {
    return this.#isDisposed;
  }

  // ── Type collection ─────────────────────────────────────────────────────

  collectTypeAt(filePath: string, position: number): ResolvedType | null {
    this.#assertNotDisposed();
    return this.#typeCollector.collectAt(filePath, position);
  }

  collectFileTypes(filePath: string): Map<number, ResolvedType> {
    this.#assertNotDisposed();
    return this.#typeCollector.collectFile(filePath);
  }

  collectTypesAtPositions(
    filePath: string,
    positions: number[],
  ): Map<number, ResolvedType> {
    this.#assertNotDisposed();
    return this.#typeCollector.collectAtPositions(filePath, positions);
  }

  // ── Semantic references ─────────────────────────────────────────────────

  findReferences(filePath: string, position: number): SemanticReference[] {
    this.#assertNotDisposed();
    return this.#referenceResolver.findAt(filePath, position);
  }

  // ── Implementations ─────────────────────────────────────────────────────

  findImplementations(filePath: string, position: number): Implementation[] {
    this.#assertNotDisposed();
    return this.#implementationFinder.findAt(filePath, position);
  }

  // ── Type assignability ─────────────────────────────────────────────

  isTypeAssignableTo(
    sourceFilePath: string,
    sourcePosition: number,
    targetFilePath: string,
    targetPosition: number,
  ): boolean | null {
    this.#assertNotDisposed();
    return this.#typeCollector.isAssignableTo(
      sourceFilePath,
      sourcePosition,
      targetFilePath,
      targetPosition,
    );
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
    return this.#typeCollector.isAssignableToType(filePath, position, targetTypeExpression, options);
  }

  isTypeAssignableToTypeAtPositions(
    filePath: string,
    positions: number[],
    targetTypeExpression: string,
    options?: { anyConstituent?: boolean },
  ): Map<number, boolean> {
    this.#assertNotDisposed();
    return this.#typeCollector.isAssignableToTypeAtPositions(filePath, positions, targetTypeExpression, options);
  }

  // ── Symbol graph ────────────────────────────────────────────────────────

  getSymbolNode(filePath: string, position: number): SymbolNode | null {
    this.#assertNotDisposed();
    return this.#symbolGraph.get(filePath, position);
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

    const tsProgram = this.#program.getProgram();
    const sourceFile = tsProgram.getSourceFile(filePath);
    if (!sourceFile) return null;

    const node = findNodeAtPosition(sourceFile, position);
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
    const sourceFile = tsProgram.getSourceFile(filePath);
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
    this.#symbolGraph.invalidate(filePath);
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
    this.#symbolGraph.invalidate(filePath);
  }

  // ── Position conversion ──────────────────────────────────────────────

  /**
   * Convert 1-based line + 0-based column to a byte offset using tsc SourceFile.
   * Returns `null` when the file is not part of the program.
   */
  lineColumnToPosition(filePath: string, line: number, column: number): number | null {
    this.#assertNotDisposed();
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
    const sourceFile = this.#program.getProgram().getSourceFile(filePath);
    if (!sourceFile) return null;
    const text = sourceFile.getFullText();
    let searchFrom = declarationPos;
    while (searchFrom < text.length) {
      const idx = text.indexOf(name, searchFrom);
      if (idx < 0) return null;

      // Word boundary check: preceding char must be non-identifier, or idx === 0
      const before = idx > 0 ? text.charCodeAt(idx - 1) : 0x20; // space
      const after = idx + name.length < text.length ? text.charCodeAt(idx + name.length) : 0x20;
      if (!isIdentifierChar(before) && !isIdentifierChar(after)) {
        return idx;
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
    const sourceFile = program.getSourceFile(filePath);
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

    return diagnostics.map((d) => {
      let line = 1;
      let column = 0;
      if (d.file && d.start !== undefined) {
        const pos = ts.getLineAndCharacterOfPosition(d.file, d.start);
        line = pos.line + 1;
        column = pos.character;
      }
      return {
        filePath: d.file?.fileName ?? filePath,
        line,
        column,
        message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
        code: d.code,
        category: categoryMap[d.category] ?? 'error',
      };
    });
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
