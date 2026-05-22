/**
 * ReferenceResolver — LanguageService.findReferences 기반 시맨틱 참조 탐색.
 *
 * 텍스트 검색과 달리 심볼 identity 기반으로 참조를 찾으므로
 * rename, re-export, shadowing을 정확히 처리한다.
 */

import ts from "typescript";
import type { EnrichedReference, FileBinding, SemanticReference } from "./types";
import type { TscProgram } from "./tsc-program";
import { findNodeAtPosition } from "./ast-node-utils";
import { classifyWriteKind, getEnclosingScope, isAmbientDeclaration } from "./reference-classifier";

// ── ReferenceResolver ─────────────────────────────────────────────────────────

export class ReferenceResolver {
  readonly #program: TscProgram;

  constructor(program: TscProgram) {
    this.#program = program;
  }

  /**
   * `filePath`의 `position` 위치 심볼에 대한 모든 참조를 찾는다.
   *
   * - 프로그램이 dispose되었거나 심볼을 찾을 수 없으면 빈 배열을 반환한다.
   * - LanguageService.findReferences를 사용하므로 cross-file 참조도 포함된다.
   */
  findAt(filePath: string, position: number): SemanticReference[] {
    const referencedSymbols = this.#query(filePath, position);
    if (!referencedSymbols) return [];

    const tsProgram = this.#program.getProgram();
    const results: SemanticReference[] = [];
    for (const refSymbol of referencedSymbols) {
      for (const entry of refSymbol.references) {
        const refSourceFile = tsProgram.getSourceFile(entry.fileName);
        if (!refSourceFile) continue;
        results.push(toBaseReference(entry, refSourceFile));
      }
    }
    return results;
  }

  /**
   * Like {@link findAt}, but enriches each reference with `writeKind`,
   * `isAmbient`, and `enclosingScope` — the syntactic metadata that
   * `findReferences` does not provide. Returns `[]` if disposed or unresolved.
   */
  findEnrichedAt(filePath: string, position: number): EnrichedReference[] {
    const referencedSymbols = this.#query(filePath, position);
    if (!referencedSymbols) return [];

    const tsProgram = this.#program.getProgram();
    const checker = tsProgram.getTypeChecker();
    const results: EnrichedReference[] = [];
    for (const refSymbol of referencedSymbols) {
      const isAmbient = this.#isSymbolAmbient(refSymbol, tsProgram, checker);
      for (const entry of refSymbol.references) {
        const refSourceFile = tsProgram.getSourceFile(entry.fileName);
        if (!refSourceFile) continue;

        const refNode = findNodeAtPosition(refSourceFile, entry.textSpan.start);
        const idNode = refNode && ts.isIdentifier(refNode) ? refNode : undefined;

        results.push({
          ...toBaseReference(entry, refSourceFile),
          writeKind: idNode ? classifyWriteKind(idNode) : undefined,
          isAmbient,
          enclosingScope: getEnclosingScope(idNode ?? refSourceFile),
        });
      }
    }
    return results;
  }

  /**
   * Collect every binding referenced in `filePath`, grouped by symbol, in a
   * single AST pass (no per-symbol `findReferences`). Each group lists the
   * references that occur in this file enriched with `writeKind` / `isAmbient` /
   * `enclosingScope`. Returns `[]` if disposed or the file is unknown.
   */
  findFileBindings(filePath: string): FileBinding[] {
    if (this.#program.isDisposed) return [];

    const tsProgram = this.#program.getProgram();
    const sourceFile = tsProgram.getSourceFile(filePath);
    if (!sourceFile) return [];

    const checker = tsProgram.getTypeChecker();

    // Single pass: group every identifier by its resolved symbol identity
    // (the binder handles var hoisting / shadowing, so a block `var` and an
    // outer read land in the same group).
    const groups = new Map<ts.Symbol, ts.Identifier[]>();
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) {
        const symbol = checker.getSymbolAtLocation(node);
        if (symbol) {
          const existing = groups.get(symbol);
          if (existing) existing.push(node);
          else groups.set(symbol, [node]);
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);

    const results: FileBinding[] = [];
    for (const [symbol, idents] of groups) {
      const declarations = symbol.declarations;
      if (!declarations || declarations.length === 0) continue;

      const isAmbient = declarations.every(isAmbientDeclaration);
      const declNameNodes = new Set<ts.Node>(
        declarations
          .map((d) => ts.getNameOfDeclaration(d))
          .filter((n): n is NonNullable<typeof n> => n !== undefined),
      );
      const firstDecl = declarations[0]!;
      const declName = ts.getNameOfDeclaration(firstDecl) ?? firstDecl;
      const declSourceFile = firstDecl.getSourceFile();

      const references: EnrichedReference[] = idents.map((id) => {
        const start = id.getStart(sourceFile);
        const { line: lineZero, character: column } =
          sourceFile.getLineAndCharacterOfPosition(start);
        const writeKind = classifyWriteKind(id);
        return {
          filePath: sourceFile.fileName,
          position: start,
          line: lineZero + 1,
          column,
          isDefinition: declNameNodes.has(id),
          isWrite: writeKind !== undefined,
          writeKind,
          isAmbient,
          enclosingScope: getEnclosingScope(id),
        };
      });

      results.push({
        declaration: {
          filePath: declSourceFile.fileName,
          position: declName.getStart(declSourceFile),
          name: symbol.getName(),
          isAmbient,
        },
        references,
      });
    }

    return results;
  }

  /**
   * Shared preamble for {@link findAt} / {@link findEnrichedAt}: validates the
   * program/file/identifier and runs `findReferences`. Returns `null` when the
   * query yields nothing (disposed, unknown file, non-identifier, no references).
   */
  #query(filePath: string, position: number): ts.ReferencedSymbol[] | null {
    if (this.#program.isDisposed) return null;

    const tsProgram = this.#program.getProgram();
    const sourceFile = tsProgram.getSourceFile(filePath);
    if (!sourceFile) return null;

    const node = findNodeAtPosition(sourceFile, position);
    if (!node || !ts.isIdentifier(node)) return null;

    const referencedSymbols = this.#program.getLanguageService().findReferences(filePath, position);
    if (!referencedSymbols || referencedSymbols.length === 0) return null;

    return referencedSymbols;
  }

  /**
   * Ambient iff every declaration of the referenced symbol is ambient (i.e. the
   * binding has no runtime definition anywhere).
   */
  #isSymbolAmbient(
    refSymbol: ts.ReferencedSymbol,
    tsProgram: ts.Program,
    checker: ts.TypeChecker,
  ): boolean {
    const def = refSymbol.definition;
    const defSourceFile = tsProgram.getSourceFile(def.fileName);
    if (!defSourceFile) return false;

    const defNode = findNodeAtPosition(defSourceFile, def.textSpan.start);
    if (!defNode) return false;

    const symbol = checker.getSymbolAtLocation(defNode);
    const declarations = symbol?.declarations;
    if (!declarations || declarations.length === 0) return false;

    return declarations.every(isAmbientDeclaration);
  }
}

/** Map a tsc reference entry to the base {@link SemanticReference} shape. */
function toBaseReference(
  entry: ts.ReferencedSymbolEntry,
  refSourceFile: ts.SourceFile,
): SemanticReference {
  const { line: lineZero, character: column } = refSourceFile.getLineAndCharacterOfPosition(
    entry.textSpan.start,
  );
  return {
    filePath: entry.fileName,
    position: entry.textSpan.start,
    line: lineZero + 1, // 1-based
    column, // 0-based
    isDefinition: entry.isDefinition ?? false,
    isWrite: entry.isWriteAccess ?? false,
  };
}
