/**
 * Shared AST node utilities for the semantic layer.
 */

import ts from "typescript";

/**
 * `pos` 위치의 가장 작은(innermost) 노드를 반환한다.
 * 범위 밖이면 `undefined`.
 *
 * tsc 내부의 `getTokenAtPosition`을 사용하여 최적화된 탐색을 수행한다.
 */
export function findNodeAtPosition(
  sourceFile: ts.SourceFile,
  pos: number,
): ts.Node | undefined {
  if (pos < 0 || pos >= sourceFile.getEnd()) return undefined;
  const token = (ts as unknown as { getTokenAtPosition(sf: ts.SourceFile, pos: number): ts.Node }).getTokenAtPosition(sourceFile, pos);
  // getTokenAtPosition may return the next token when pos is on whitespace/trivia.
  // Verify the token actually contains the requested position.
  if (token.getStart(sourceFile, false) > pos) return undefined;
  return token;
}
