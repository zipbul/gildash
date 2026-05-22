/**
 * Shared AST node utilities for the semantic layer.
 */

import ts from "typescript";

/**
 * `pos` 위치를 포함하는 가장 작은(innermost) 노드를 반환한다.
 * 범위 밖이거나 트리비아 위치면 `undefined`.
 *
 * 공개 API(`forEachChild`)만으로 하강 탐색한다 — `pos`를 실제로 포함하는
 * (`getStart() <= pos < getEnd()`) 자식으로만 재귀하므로 가이드된 하강이다.
 */
export function findNodeAtPosition(
  sourceFile: ts.SourceFile,
  pos: number,
): ts.Node | undefined {
  if (pos < 0 || pos >= sourceFile.getEnd()) return undefined;

  let result: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    // `getStart` skips leading trivia; nodes whose start is past `pos`
    // (i.e. `pos` sits in their leading trivia) are not entered.
    if (pos < node.getStart(sourceFile, false) || pos >= node.getEnd()) return;
    result = node; // contains `pos` — keep descending for a narrower match
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

  return result;
}
