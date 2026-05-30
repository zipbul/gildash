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

/**
 * `[start, end)` 바이트 범위와 **정확히 일치하는** 표현식 노드를 반환한다.
 * (`node.getStart(sf,false) === start && node.getEnd() === end`)
 *
 * 동일 범위를 갖는 노드가 둘 이상이면 **최내곽**(innermost)을 돌려준다. 실제로 span이
 * 겹치는 유일한 경우는 **세미콜론 없는 표현식 문**(ASI)이다 — `ExpressionStatement`가
 * 내부 표현식과 같은 span을 갖는다. 이때 의미 있는 타입은 *표현식* 쪽이므로(문 자체는
 * `getTypeAtLocation`이 `any`로 푼다) innermost를 택한다. (`(f())`처럼 괄호가 글자를
 * 더하는 래퍼는 자식과 span이 달라 애초에 tie가 아니다.)
 *
 * 정확히 일치하는 노드가 없으면 `undefined` — 가장 가까운 노드로의 fallback은 하지
 * 않는다(틀린 노드 추정 방지). `getStart`는 leading trivia를 건너뛰므로 `oxc-parser`의
 * `node.start`/`node.end`와 1:1로 정렬한다.
 */
export function findNodeAtSpan(
  sourceFile: ts.SourceFile,
  start: number,
  end: number,
): ts.Node | undefined {
  if (start < 0 || end <= start || end > sourceFile.getEnd()) return undefined;

  let result: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    const ns = node.getStart(sourceFile, false);
    const ne = node.getEnd();
    // Only descend into nodes that fully contain the target range.
    if (start < ns || end > ne) return;
    if (ns === start && ne === end) {
      // Exact match — keep descending so the INNERMOST same-span node wins
      // (e.g. the expression inside a semicolon-less ExpressionStatement).
      result = node;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

  return result;
}
