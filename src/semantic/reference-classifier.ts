/**
 * reference-classifier — purely syntactic classification of identifier references.
 *
 * tsc's `LanguageService.findReferences` answers the authoritative binding
 * question (which declaration a reference binds to, and `isWriteAccess`), but it
 * does NOT distinguish *kinds* of writes. This module fills that gap by inspecting
 * the syntactic context of an identifier — no type information is required.
 */

import ts from 'typescript';

/**
 * The kind of write a reference represents.
 *
 * - `declaration`         — a binding site (`var a`, `let {x}`, parameter, etc.).
 * - `assignment`          — plain assignment (`a = …`).
 * - `compound-assignment` — arithmetic/bitwise compound (`a += …`, `a &= …`).
 * - `logical-assignment`  — short-circuit compound (`a &&= …`, `a ||= …`, `a ??= …`).
 * - `update`              — increment/decrement (`a++`, `--a`).
 */
export type WriteKind =
  | 'declaration'
  | 'assignment'
  | 'compound-assignment'
  | 'logical-assignment'
  | 'update';

/** The kind of scope that lexically encloses a reference. */
export type ScopeKind = 'function' | 'module' | 'block';

/**
 * The nearest scope enclosing a reference, with the scope-defining node's span
 * for identity (two distinct blocks have distinct spans — needed by flow analysis).
 */
export interface EnclosingScope {
  kind: ScopeKind;
  /** Start offset of the scope-defining node. */
  pos: number;
  /** End offset of the scope-defining node. */
  end: number;
}

/**
 * Whether `decl` is an ambient declaration (no runtime definition) — `declare`
 * declarations, members of `declare namespace`/`declare module`/`declare global`,
 * and anything in a `.d.ts` declaration file.
 *
 * This is a per-declaration primitive. A *symbol* may have multiple declarations
 * (declaration merging); the integration layer composes ambientness across them
 * (`symbol.declarations.every(isAmbientDeclaration)` — ambient only when no
 * declaration carries a runtime definition).
 */
export function isAmbientDeclaration(decl: ts.Declaration): boolean {
  // Declaration files are ambient in their entirety.
  if (decl.getSourceFile().isDeclarationFile) return true;
  // Otherwise the declaration is ambient if it — or any enclosing
  // namespace/module/global — carries the `declare` modifier.
  for (let n: ts.Node | undefined = decl; n; n = n.parent) {
    if (hasDeclareModifier(n)) return true;
  }
  return false;
}

/** Whether `node` carries an explicit `declare` modifier. */
function hasDeclareModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const modifiers = ts.getModifiers(node);
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword) ?? false;
}

/**
 * Find the nearest scope (`function` | `module` | `block`) that lexically
 * encloses `node`. A function body's own block reports as `function`; nested
 * blocks, `for` bodies and `catch` bodies report as `block`; the source file and
 * `namespace`/`module` bodies report as `module`. Always resolves (module is the
 * root fallback).
 */
export function getEnclosingScope(node: ts.Node): EnclosingScope {
  const scope = (kind: ScopeKind, n: ts.Node): EnclosingScope => ({
    kind,
    pos: n.getStart(),
    end: n.getEnd(),
  });

  let n: ts.Node | undefined = node.parent;
  while (n) {
    if (ts.isSourceFile(n) || ts.isModuleDeclaration(n)) return scope('module', n);

    // Var-hoisting boundaries.
    if (ts.isFunctionLike(n)) return scope('function', n);
    if (ts.isClassStaticBlockDeclaration(n)) return scope('function', n);
    if (ts.isPropertyDeclaration(n)) return scope('function', n);

    // A function/static-block body block reports as its (function) boundary;
    // any other block is a lexical-only block scope.
    if (ts.isBlock(n)) {
      const p = n.parent;
      if (p && (ts.isFunctionLike(p) || ts.isClassStaticBlockDeclaration(p))) {
        return scope('function', p);
      }
      return scope('block', n);
    }

    if (
      ts.isForStatement(n) ||
      ts.isForInStatement(n) ||
      ts.isForOfStatement(n) ||
      ts.isCatchClause(n) ||
      ts.isCaseBlock(n) ||
      ts.isWithStatement(n)
    ) {
      return scope('block', n);
    }

    n = n.parent;
  }

  // The source file is always an ancestor, so this is unreachable in practice.
  return scope('module', node.getSourceFile());
}

/**
 * Classify whether `node` is a write reference, and of what kind.
 *
 * Returns the {@link WriteKind} when the identifier occupies a write position,
 * or `undefined` when it is a read. The compound/logical/update kinds also read
 * their target; splitting out that read-component is the caller's responsibility.
 */
export function classifyWriteKind(node: ts.Identifier): WriteKind | undefined {
  const parent = node.parent as ts.Node | undefined;
  if (!parent) return undefined;

  // Binding sites — `var a`, `let {x}`, `function f(p)`, array/object destructuring.
  if (ts.isVariableDeclaration(parent) && parent.name === node) return 'declaration';
  if (ts.isParameter(parent) && parent.name === node) return 'declaration';
  if (ts.isBindingElement(parent) && parent.name === node) return 'declaration';

  // `for (a of x)` / `for (a in x)` without a declaration — assigned each iteration.
  if (
    (ts.isForOfStatement(parent) || ts.isForInStatement(parent)) &&
    parent.initializer === node
  ) {
    return 'assignment';
  }

  // `a++`, `--a`.
  if (
    (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) &&
    parent.operand === node &&
    (parent.operator === ts.SyntaxKind.PlusPlusToken ||
      parent.operator === ts.SyntaxKind.MinusMinusToken)
  ) {
    return 'update';
  }

  // `a = …`, `a += …`, `a ||= …`, `(a) = …` — node (or its parenthesized wrapper)
  // must be the assignment target (left side).
  let target: ts.Node = node;
  while (target.parent && ts.isParenthesizedExpression(target.parent)) {
    target = target.parent;
  }
  const targetParent = target.parent as ts.Node | undefined;
  if (targetParent && ts.isBinaryExpression(targetParent) && targetParent.left === target) {
    return assignmentKindFromOperator(targetParent.operatorToken.kind);
  }

  // Destructuring assignment patterns — `({ x } = o)`, `([a] = o)`.
  if (isInAssignmentTargetPattern(node)) return 'assignment';

  // Everything else (reads, property-shorthand values, RHS, etc.).
  return undefined;
}

/**
 * Map a binary operator token to its {@link WriteKind}, or `undefined` when the
 * operator is not an assignment (e.g. `+` in `a + b` makes `a` a read).
 */
function assignmentKindFromOperator(op: ts.SyntaxKind): WriteKind | undefined {
  switch (op) {
    case ts.SyntaxKind.EqualsToken:
      return 'assignment';
    case ts.SyntaxKind.PlusEqualsToken:
    case ts.SyntaxKind.MinusEqualsToken:
    case ts.SyntaxKind.AsteriskEqualsToken:
    case ts.SyntaxKind.AsteriskAsteriskEqualsToken:
    case ts.SyntaxKind.SlashEqualsToken:
    case ts.SyntaxKind.PercentEqualsToken:
    case ts.SyntaxKind.LessThanLessThanEqualsToken:
    case ts.SyntaxKind.GreaterThanGreaterThanEqualsToken:
    case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken:
    case ts.SyntaxKind.AmpersandEqualsToken:
    case ts.SyntaxKind.BarEqualsToken:
    case ts.SyntaxKind.CaretEqualsToken:
      return 'compound-assignment';
    case ts.SyntaxKind.AmpersandAmpersandEqualsToken:
    case ts.SyntaxKind.BarBarEqualsToken:
    case ts.SyntaxKind.QuestionQuestionEqualsToken:
      return 'logical-assignment';
    default:
      return undefined;
  }
}

/**
 * Whether `node` sits in the target slot of a destructuring *assignment* pattern
 * (an object/array literal on the left of `=`), as opposed to a value expression.
 *
 * Distinguishes `({ x } = o)` (write) from `const s = { x }` (read).
 */
function isInAssignmentTargetPattern(node: ts.Identifier): boolean {
  const parent = node.parent as ts.Node | undefined;
  if (!parent) return false;

  const sitsInLiteralSlot =
    (ts.isShorthandPropertyAssignment(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.initializer === node) ||
    ts.isArrayLiteralExpression(parent) ||
    (ts.isSpreadAssignment(parent) && parent.expression === node) ||
    (ts.isSpreadElement(parent) && parent.expression === node);
  if (!sitsInLiteralSlot) return false;

  // Walk up through nested literal/pattern wrappers to the outermost literal,
  // then check whether it is the left-hand side of an `=` assignment.
  let current: ts.Node = parent;
  while (current.parent) {
    const p: ts.Node = current.parent;
    if (
      ts.isBinaryExpression(p) &&
      p.left === current &&
      p.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      return true;
    }
    if (
      ts.isObjectLiteralExpression(p) ||
      ts.isArrayLiteralExpression(p) ||
      ts.isPropertyAssignment(p) ||
      ts.isShorthandPropertyAssignment(p) ||
      ts.isSpreadAssignment(p) ||
      ts.isSpreadElement(p)
    ) {
      current = p;
      continue;
    }
    return false;
  }
  return false;
}
