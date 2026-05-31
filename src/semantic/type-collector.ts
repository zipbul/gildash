/**
 * TypeCollector — tsc TypeChecker 직접 호출로 심볼의 ResolvedType을 수집한다.
 *
 * TscProgram에서 Program/TypeChecker를 가져와 AST를 탐색하고
 * 각 심볼 위치의 타입을 ResolvedType으로 변환한다.
 */

import ts from "typescript";
import type { ResolvedType, ByteSpan } from "./types";
import type { TscProgram } from "./tsc-program";
import { findNodeAtPosition, findNodeAtSpan } from "./ast-node-utils";

// ── ResolvedType 빌더 ────────────────────────────────────────────────────────

/**
 * ResolvedType 트리의 최대 재귀 깊이.
 *
 * 이 값을 초과하면 `members`와 `typeArguments`를 전개하지 않고
 * leaf 노드로 처리한다. `text` 필드는 depth와 무관하게 항상 채워진다.
 */
const MAX_TYPE_DEPTH = 8;

/** TypeReference 여부 판별 (generic instantiation). */
function isTypeReference(type: ts.Type): type is ts.TypeReference {
  return (
    !!(type.flags & ts.TypeFlags.Object) &&
    !!((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference)
  );
}

/**
 * `ts.Type`을 `ResolvedType`으로 재귀 변환한다.
 *
 * 순환 타입에 대비해 `depth`로 재귀 깊이를 제한한다.
 * `seen` Map을 전달하면 동일 `ts.Type` 객체의 중복 빌드를 방지한다.
 * diamond 패턴(A→B, A→C, B→D, C→D)에서 D를 1회만 빌드한다.
 */
export function buildResolvedType(
  checker: ts.TypeChecker,
  type: ts.Type,
  depth = 0,
  seen?: Map<ts.Type, ResolvedType>,
): ResolvedType {
  if (seen) {
    const cached = seen.get(type);
    if (cached) return cached;
  }

  const text = checker.typeToString(type);
  const flags = type.flags;

  const isUnion = !!(flags & ts.TypeFlags.Union);
  const isIntersection = !!(flags & ts.TypeFlags.Intersection);

  // TypeReference의 구체화된 타입 인자를 public API로 가져온다.
  // (type as ts.TypeReference).typeArguments 대신 checker.getTypeArguments() 사용.
  let typeArgs: readonly ts.Type[] | undefined;
  if (depth < MAX_TYPE_DEPTH && isTypeReference(type)) {
    const args = checker.getTypeArguments(type);
    if (args.length > 0) typeArgs = args;
  }

  // isGeneric: 타입 파라미터 자체이거나 타입 인자가 구체화된 TypeReference
  const isGeneric =
    !!(flags & ts.TypeFlags.TypeParameter) ||
    (typeArgs !== undefined && typeArgs.length > 0);

  // union / intersection 구성원 재귀 빌드
  let members: ResolvedType[] | undefined;
  if (isUnion && depth < MAX_TYPE_DEPTH) {
    members = (type as ts.UnionType).types.map((t) =>
      buildResolvedType(checker, t, depth + 1, seen),
    );
  } else if (isIntersection && depth < MAX_TYPE_DEPTH) {
    members = (type as ts.IntersectionType).types.map((t) =>
      buildResolvedType(checker, t, depth + 1, seen),
    );
  }

  // 타입 인자 재귀 빌드
  let typeArguments: ResolvedType[] | undefined;
  if (typeArgs && typeArgs.length > 0) {
    typeArguments = typeArgs.map((t) =>
      buildResolvedType(checker, t, depth + 1, seen),
    );
  }

  // properties — object type member enumeration via checker.getPropertiesOfType()
  let properties: Array<{ name: string; type: ResolvedType }> | undefined;
  if (
    depth < MAX_TYPE_DEPTH &&
    !!(flags & ts.TypeFlags.Object) &&
    !isUnion &&
    !isIntersection
  ) {
    const props = checker.getPropertiesOfType(type);
    if (props.length > 0 && props.length <= 50) {
      // Find a declaration node to use as context for getTypeOfSymbolAtLocation.
      // Prefer the property's own declaration; fall back to the type's symbol declaration.
      const typeDeclNode =
        (type as ts.ObjectType).symbol?.declarations?.[0];
      properties = [];
      for (const p of props) {
        const declNode = p.declarations?.[0] ?? typeDeclNode;
        if (!declNode) continue;
        try {
          const propType = checker.getTypeOfSymbolAtLocation(p, declNode);
          properties.push({
            name: p.getName(),
            type: buildResolvedType(checker, propType, depth + 1, seen),
          });
        } catch {
          // Skip properties whose type cannot be resolved
        }
      }
      if (properties.length === 0) properties = undefined;
    }
  }

  const result: ResolvedType = { text, flags, isUnion, isIntersection, isGeneric, members, typeArguments, properties };
  if (seen) seen.set(type, result);
  return result;
}

// ── thenable 판별 ─────────────────────────────────────────────────────────────

/**
 * ECMAScript / typescript-eslint `isThenableType` 정의로 thenable인지 판별한다:
 * 호출 가능한 `then` 멤버를 가지며 그 call signature가 **파라미터 ≥1개**.
 *
 * - `any`는 제외(`any`는 무엇이든 될 수 있어 thenable로 보지 않는다).
 * - union: `anyConstituent`이면 nullish가 아닌 **어떤** 멤버가 thenable이면 true,
 *   아니면 **모든** non-nullish 멤버가 thenable이어야 true. (옵셔널 `T | undefined`는
 *   `undefined` 멤버를 제거하고 판정.)
 * - intersection: 어떤 멤버라도 thenable이면 교차 타입은 그 `then`을 가지므로 true.
 *
 * `then`의 *반환* 타입으로는 재귀하지 않으므로(파라미터 개수만 검사) 자기참조 thenable
 * (`interface T { then(cb:(v:T)=>void):void }`)에서도 종료가 보장된다.
 */
function isThenableType(
  checker: ts.TypeChecker,
  type: ts.Type,
  anyConstituent: boolean,
): boolean {
  if (type.flags & ts.TypeFlags.Any) return false;

  if (type.isUnion()) {
    const parts = type.types.filter(
      (t) => !(t.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined | ts.TypeFlags.Null)),
    );
    return anyConstituent
      ? parts.some((p) => isThenableType(checker, p, anyConstituent))
      : parts.length > 0 && parts.every((p) => isThenableType(checker, p, anyConstituent));
  }

  if (type.isIntersection()) {
    return type.types.some((p) => isThenableType(checker, p, anyConstituent));
  }

  const then = checker.getPropertyOfType(type, "then");
  if (!then) return false;
  const decl = then.declarations?.[0];
  if (!decl) return false;
  const thenType = checker.getTypeOfSymbolAtLocation(then, decl);
  return thenType.getCallSignatures().some((s) => s.parameters.length >= 1);
}

// ── 선언 위치 순회 ───────────────────────────────────────────────────────────

/** 선언 이름인 Identifier 노드인지 판별한다. */
function isNamedDeclaration(node: ts.Node): node is ts.NamedDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isVariableDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isPropertySignature(node) ||
    ts.isMethodSignature(node)
  );
}

// ── TypeCollector ─────────────────────────────────────────────────────────────

const PROBE_FILE = '/__gildash_type_probe__.ts';

export class TypeCollector {
  #probeExpression: string | null = null;

  constructor(private readonly program: TscProgram) {}

  /**
   * probe 파일이 현재 targetTypeExpression에 대해 inject되어 있는지 확인하고,
   * 필요하면 inject 또는 갱신한다. 동일 expression이면 no-op → recompile 없음.
   */
  #ensureProbe(targetTypeExpression: string): void {
    if (this.#probeExpression === targetTypeExpression) return;
    this.program.notifyFileChanged(
      PROBE_FILE,
      `declare const __gildash_probe__: ${targetTypeExpression};`,
    );
    this.#probeExpression = targetTypeExpression;
  }

  /**
   * 현재 inject된 probe에서 target type을 resolve한다.
   * probe가 없거나 해석 실패하면 null.
   */
  #resolveProbeTarget(
    program: ts.Program,
    checker: ts.TypeChecker,
  ): ts.Type | null {
    const probeSf = program.getSourceFile(PROBE_FILE);
    if (!probeSf) return null;
    const probeStmt = probeSf.statements[0];
    if (!probeStmt || !ts.isVariableStatement(probeStmt)) return null;
    const probeDecl = probeStmt.declarationList.declarations[0];
    if (!probeDecl) return null;
    const targetType = checker.getTypeAtLocation(probeDecl.name);
    // An unresolvable `targetTypeExpression` (typo / missing type) resolves to the
    // intrinsic `error` type — Any-flagged with intrinsicName "error". Reject it so
    // callers get `null` instead of a spurious "assignable to everything" `true`.
    // (A legitimate `any` target has intrinsicName "any", so it is kept.)
    if (
      !!(targetType.flags & ts.TypeFlags.Any) &&
      (targetType as { intrinsicName?: string }).intrinsicName === "error"
    ) {
      return null;
    }
    return targetType;
  }

  /** 캐시된 probe 파일을 제거한다. dispose 시 호출. */
  clearProbe(): void {
    if (this.#probeExpression !== null) {
      this.program.removeFile(PROBE_FILE);
      this.#probeExpression = null;
    }
  }

  /**
   * `filePath`의 `position` 위치(0-based 문자 오프셋)에 있는 노드의 타입을 수집한다.
   *
   * Identifier와 type keyword (`string`, `number`, `boolean` 등) 위치에서 동작한다.
   *
   * - 파일이 없거나 위치에 resolvable 노드가 없으면 `null` 반환
   * - `TscProgram`이 disposed 상태이면 throw (getProgram이 throw)
   */
  collectAt(filePath: string, position: number): ResolvedType | null {
    const tsProgram = this.program.getProgram();
    const checker = tsProgram.getTypeChecker();

    if (position < 0) return null;

    const sourceFile = tsProgram.getSourceFile(filePath);
    if (!sourceFile) return null;

    if (position >= sourceFile.getEnd()) return null;

    const node = findNodeAtPosition(sourceFile, position);
    if (!node) return null;

    // 식별자 또는 type keyword (string, number, boolean 등)만 허용
    if (!ts.isIdentifier(node) && !ts.isTypeNode(node)) return null;

    try {
      const type = checker.getTypeAtLocation(node);
      return buildResolvedType(checker, type, 0, new Map());
    } catch {
      return null;
    }
  }

  // ── Span-based primitives (firebat error-flow) ──────────────────────────────

  /**
   * Resolve the type of the **expression node** that exactly spans `span`
   * (`[getStart(), getEnd())` === `[span.start, span.end)`); the innermost on a
   * tie (e.g. the expression inside a semicolon-less `ExpressionStatement`, not
   * the statement — which would resolve to `any`). Unlike {@link collectAt},
   * accepts any expression node (Call/Member/Await/…),
   * so `f()` resolves to the call **result** type. No exact match → `null` (no
   * fallback). Returns existing {@link ResolvedType} (incl. raw `.flags`).
   *
   */
  collectAtSpan(filePath: string, span: ByteSpan): ResolvedType | null {
    const tsProgram = this.program.getProgram();
    const checker = tsProgram.getTypeChecker();

    const sourceFile = tsProgram.getSourceFile(filePath);
    if (!sourceFile) return null;

    const node = findNodeAtSpan(sourceFile, span.start, span.end);
    if (!node) return null;

    try {
      const type = checker.getTypeAtLocation(node);
      return buildResolvedType(checker, type, 0, new Map());
    } catch {
      return null;
    }
  }

  /**
   * Whether the type of the expression exactly spanning `span` is a **thenable**
   * (ECMAScript / typescript-eslint definition: a callable `then` member whose
   * call signature has ≥1 parameter). Recurses union/intersection on the live
   * `ts.Type` (so `A & PromiseLike<X>` resolves); excludes `any`. `null` when the
   * span resolves no node / type. `options.anyConstituent` (default `true`): a
   * union is thenable if **some** member is.
   *
   */
  isThenableAtSpan(
    filePath: string,
    span: ByteSpan,
    options?: { anyConstituent?: boolean },
  ): boolean | null {
    const tsProgram = this.program.getProgram();
    const checker = tsProgram.getTypeChecker();

    const sourceFile = tsProgram.getSourceFile(filePath);
    if (!sourceFile) return null;

    const node = findNodeAtSpan(sourceFile, span.start, span.end);
    if (!node) return null;

    try {
      const type = checker.getTypeAtLocation(node);
      return isThenableType(checker, type, options?.anyConstituent ?? true);
    } catch {
      return null;
    }
  }

  /**
   * The return types of the call signatures of the **contextual type** at the
   * argument expression spanning `span` (overload-selected, `undefined`/`null`
   * stripped before signature enumeration). For a void-callback slot the caller
   * checks every returned type is `void`/`undefined`. `null` when there is no
   * contextual type; `[]` when the contextual type has no call signatures
   * (not a callback slot).
   *
   * When the contextual type is a union of function types
   * (`(() => void) | (() => number)`), the returns of **all** members are
   * included — the caller's "every return is void" check then naturally rejects
   * the value-returning member.
   *
   */
  contextualCallReturnsAtSpan(filePath: string, span: ByteSpan): ResolvedType[] | null {
    const tsProgram = this.program.getProgram();
    const checker = tsProgram.getTypeChecker();

    const sourceFile = tsProgram.getSourceFile(filePath);
    if (!sourceFile) return null;

    const node = findNodeAtSpan(sourceFile, span.start, span.end);
    // Must resolve to the argument expression node itself (so getContextualType sees
    // the correct overload context); never reconstruct it from an enclosing call.
    if (!node || !ts.isExpression(node)) return null;

    try {
      const contextualType = checker.getContextualType(node);
      if (!contextualType) return null;

      // Strip nullish union members (optional params: `(() => void) | undefined`)
      // BEFORE enumerating call signatures — `.getCallSignatures()` on the raw union
      // returns none.
      const candidates = contextualType.isUnion()
        ? contextualType.types.filter(
            (t) => !(t.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined | ts.TypeFlags.Null)),
          )
        : [contextualType];

      const seen = new Map<ts.Type, ResolvedType>();
      const returns: ResolvedType[] = [];
      for (const c of candidates) {
        for (const sig of c.getCallSignatures()) {
          const returnType = checker.getReturnTypeOfSignature(sig);
          returns.push(buildResolvedType(checker, returnType, 0, seen));
        }
      }
      return returns;
    } catch {
      return null;
    }
  }

  /**
   * Whether the type of the expression exactly spanning `span` is assignable to
   * the type described by `targetTypeExpression` (e.g. `'Error'`,
   * `'PromiseLike<any>'`). The span-based counterpart of {@link isAssignableToType}
   * — resolves any expression node (so `new CustomError()` / `f()` work, unlike
   * the identifier-only position resolver) via the same probe-injection target
   * resolution. `null` when the span resolves no node, or the target/source type
   * cannot be resolved. `options.anyConstituent`: for a union source, true if
   * **some** member is assignable.
   */
  isAssignableToTypeAtSpan(
    filePath: string,
    span: ByteSpan,
    targetTypeExpression: string,
    options?: { anyConstituent?: boolean },
  ): boolean | null {
    this.#ensureProbe(targetTypeExpression);

    const tsProgram = this.program.getProgram();
    const checker = tsProgram.getTypeChecker();

    const srcFile = tsProgram.getSourceFile(filePath);
    if (!srcFile) return null;
    const srcNode = findNodeAtSpan(srcFile, span.start, span.end);
    if (!srcNode) return null;

    try {
      const targetType = this.#resolveProbeTarget(tsProgram, checker);
      if (!targetType) return null;

      const sourceType = checker.getTypeAtLocation(srcNode);

      if (options?.anyConstituent && sourceType.isUnion()) {
        return sourceType.types.some((member) =>
          checker.isTypeAssignableTo(member, targetType),
        );
      }
      return checker.isTypeAssignableTo(sourceType, targetType);
    } catch {
      return null;
    }
  }

  /**
   * 두 위치의 타입 호환성을 검사한다.
   *
   * `sourceFilePath:sourcePosition`의 타입이 `targetFilePath:targetPosition`의 타입에
   * 할당 가능한지 여부를 반환한다.
   *
   * - 파일이 없거나 위치에 식별자가 없으면 `null` 반환
   * - `TscProgram`이 disposed 상태이면 throw (getProgram이 throw)
   */
  isAssignableTo(
    sourceFilePath: string,
    sourcePosition: number,
    targetFilePath: string,
    targetPosition: number,
  ): boolean | null {
    const tsProgram = this.program.getProgram();
    const checker = tsProgram.getTypeChecker();

    const srcFile = tsProgram.getSourceFile(sourceFilePath);
    if (!srcFile) return null;
    const srcNode = findNodeAtPosition(srcFile, sourcePosition);
    if (!srcNode || !ts.isIdentifier(srcNode)) return null;

    const dstFile = tsProgram.getSourceFile(targetFilePath);
    if (!dstFile) return null;
    const dstNode = findNodeAtPosition(dstFile, targetPosition);
    if (!dstNode || !ts.isIdentifier(dstNode)) return null;

    try {
      const sourceType = checker.getTypeAtLocation(srcNode);
      const targetType = checker.getTypeAtLocation(dstNode);
      return checker.isTypeAssignableTo(sourceType, targetType);
    } catch {
      return null;
    }
  }

  /**
   * `position` 위치의 타입이 `targetTypeExpression` 문자열로 표현된 타입에
   * assignable한지 검사한다.
   *
   * target 타입은 `declare const __probe: {expr};` 형태의 가상 선언을 프로그램에
   * 주입하여 resolve한다. 호출 후 가상 파일은 제거된다.
   */
  isAssignableToType(
    filePath: string,
    position: number,
    targetTypeExpression: string,
    options?: { anyConstituent?: boolean },
  ): boolean | null {
    this.#ensureProbe(targetTypeExpression);

    const tsProgram = this.program.getProgram();
    const checker = tsProgram.getTypeChecker();

    const srcFile = tsProgram.getSourceFile(filePath);
    if (!srcFile) return null;
    const srcNode = findNodeAtPosition(srcFile, position);
    if (!srcNode || (!ts.isIdentifier(srcNode) && !ts.isTypeNode(srcNode))) return null;

    try {
      const targetType = this.#resolveProbeTarget(tsProgram, checker);
      if (!targetType) return null;

      const sourceType = checker.getTypeAtLocation(srcNode);

      if (options?.anyConstituent && sourceType.isUnion()) {
        return sourceType.types.some(member =>
          checker.isTypeAssignableTo(member, targetType),
        );
      }
      return checker.isTypeAssignableTo(sourceType, targetType);
    } catch {
      return null;
    }
  }

  /**
   * 여러 `positions`의 타입이 `targetTypeExpression`에 assignable한지 한번에 검사한다.
   *
   * probe 파일 inject/remove를 1회로 통합하여
   * N회 개별 호출 대비 Program recompile 비용을 제거한다.
   */
  isAssignableToTypeAtPositions(
    filePath: string,
    positions: number[],
    targetTypeExpression: string,
    options?: { anyConstituent?: boolean },
  ): Map<number, boolean> {
    const result = new Map<number, boolean>();
    if (positions.length === 0) return result;

    this.#ensureProbe(targetTypeExpression);

    const tsProgram = this.program.getProgram();
    const checker = tsProgram.getTypeChecker();

    const srcFile = tsProgram.getSourceFile(filePath);
    if (!srcFile) return result;

    try {
      const targetType = this.#resolveProbeTarget(tsProgram, checker);
      if (!targetType) return result;

      const end = srcFile.getEnd();

      for (const position of positions) {
        if (position < 0 || position >= end) continue;

        const node = findNodeAtPosition(srcFile, position);
        if (!node || (!ts.isIdentifier(node) && !ts.isTypeNode(node))) continue;

        try {
          const sourceType = checker.getTypeAtLocation(node);

          if (options?.anyConstituent && sourceType.isUnion()) {
            result.set(position, sourceType.types.some(member =>
              checker.isTypeAssignableTo(member, targetType),
            ));
          } else {
            result.set(position, checker.isTypeAssignableTo(sourceType, targetType));
          }
        } catch {
          // Skip positions where type resolution fails
        }
      }
    } catch {
      // Probe resolution failed — return empty map
    }

    return result;
  }

  /**
   * `filePath`에서 모든 선언 이름 심볼의 타입을 수집한다.
   *
   * 반환 Map의 key = 선언 이름 식별자의 시작 위치(0-based).
   * 파일이 없으면 빈 Map 반환.
   * `TscProgram`이 disposed 상태이면 throw.
   */
  /**
   * `filePath`의 여러 `positions` 위치에 있는 노드들의 타입을 한번에 수집한다.
   *
   * Program/TypeChecker/SourceFile 조회를 1회로 통합하여
   * position 개수가 많을 때 반복 호출 대비 오버헤드를 줄인다.
   */
  collectAtPositions(
    filePath: string,
    positions: number[],
  ): Map<number, ResolvedType> {
    const result = new Map<number, ResolvedType>();
    if (positions.length === 0) return result;

    const tsProgram = this.program.getProgram();
    const checker = tsProgram.getTypeChecker();

    const sourceFile = tsProgram.getSourceFile(filePath);
    if (!sourceFile) return result;

    const end = sourceFile.getEnd();
    const seen = new Map<ts.Type, ResolvedType>();

    for (const position of positions) {
      if (position < 0 || position >= end) continue;

      const node = findNodeAtPosition(sourceFile, position);
      if (!node) continue;
      if (!ts.isIdentifier(node) && !ts.isTypeNode(node)) continue;

      try {
        const type = checker.getTypeAtLocation(node);
        result.set(position, buildResolvedType(checker, type, 0, seen));
      } catch {
        // 타입 수집 실패 위치는 건너뜀
      }
    }

    return result;
  }

  collectFile(filePath: string): Map<number, ResolvedType> {
    const result = new Map<number, ResolvedType>();

    const tsProgram = this.program.getProgram();
    const checker = tsProgram.getTypeChecker();

    const sourceFile = tsProgram.getSourceFile(filePath);
    if (!sourceFile) return result;

    const seen = new Map<ts.Type, ResolvedType>();

    function visit(node: ts.Node): void {
      if (isNamedDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
        const nameNode = node.name;
        try {
          const type = checker.getTypeAtLocation(nameNode);
          const pos = nameNode.getStart(sourceFile!);
          result.set(pos, buildResolvedType(checker, type, 0, seen));
        } catch {
          // 타입 수집 실패 심볼은 건너뜀
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return result;
  }
}
