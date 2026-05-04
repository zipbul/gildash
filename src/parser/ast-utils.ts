import type { Node } from 'oxc-parser';

import type { QualifiedName } from '../extractor/types';

export function getNodeHeader(
  node: Record<string, unknown>,
  parent?: Record<string, unknown> | null,
): string {
  const id = node.id as Record<string, unknown> | undefined;
  if (id && typeof id.name === 'string') return id.name;

  const key = node.key as Record<string, unknown> | undefined;
  if (key) {
    if (typeof key.name === 'string') return key.name;
    if (
      (key.type === 'StringLiteral' || key.type === 'Literal') &&
      typeof key.value === 'string'
    ) {
      return key.value;
    }
  }

  if (parent) {
    if (parent.type === 'VariableDeclarator') {
      const pid = parent.id as Record<string, unknown> | undefined;
      if (pid && typeof pid.name === 'string') return pid.name;
    }
    if (
      parent.type === 'MethodDefinition' ||
      parent.type === 'PropertyDefinition' ||
      parent.type === 'Property'
    ) {
      const pkey = parent.key as Record<string, unknown> | undefined;
      if (pkey) {
        if (typeof pkey.name === 'string') return pkey.name;
        if (typeof pkey.value === 'string') return pkey.value;
      }
    }
  }

  return 'anonymous';
}

/**
 * Type predicate for the union of FunctionDeclaration / FunctionExpression /
 * ArrowFunctionExpression discriminators.
 *
 * Note: `FunctionDeclaration` and `FunctionExpression` both narrow to the
 * `Function` interface in @oxc-project/types — that interface's `type` field
 * is also satisfied by `TSDeclareFunction` and `TSEmptyBodyFunctionExpression`,
 * but those discriminators return `false` here at runtime. Callers reading
 * `.params` / `.body` should be aware that `body` may be `null` only on the
 * declare/empty-body variants (excluded by this predicate).
 */
export function isFunctionNode(
  node: Node,
): node is Extract<
  Node,
  { type: 'FunctionDeclaration' | 'FunctionExpression' | 'ArrowFunctionExpression' }
> {
  return (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression'
  );
}

export function isArrowFunctionExpression(
  node: Node,
): node is Extract<Node, { type: 'ArrowFunctionExpression' }> {
  return node.type === 'ArrowFunctionExpression';
}

export function isAssignmentExpression(
  node: Node,
): node is Extract<Node, { type: 'AssignmentExpression' }> {
  return node.type === 'AssignmentExpression';
}

export function isCallExpression(
  node: Node,
): node is Extract<Node, { type: 'CallExpression' }> {
  return node.type === 'CallExpression';
}

/**
 * Note: discriminator `"FunctionDeclaration"` narrows to the `Function`
 * interface, which structurally also accepts `type: 'TSDeclareFunction'` and
 * `type: 'TSEmptyBodyFunctionExpression'` — but those literals fail this
 * runtime check. Narrowed result has `.params` (always) and `.body` (typed
 * `FunctionBody | null`; non-null for FunctionDeclaration / FunctionExpression).
 */
export function isFunctionDeclaration(
  node: Node,
): node is Extract<Node, { type: 'FunctionDeclaration' }> {
  return node.type === 'FunctionDeclaration';
}

/** See `isFunctionDeclaration` for shared `Function` interface notes. */
export function isFunctionExpression(
  node: Node,
): node is Extract<Node, { type: 'FunctionExpression' }> {
  return node.type === 'FunctionExpression';
}

/**
 * Note: discriminator `"Identifier"` is shared by 6 interfaces in
 * @oxc-project/types — IdentifierName, IdentifierReference, BindingIdentifier,
 * LabelIdentifier, TSThisParameter, TSIndexSignatureName. All 6 expose `.name`
 * (string; literal `"this"` for TSThisParameter). The narrowed result is the
 * union of all 6; callers needing finer distinction must check additional
 * fields (e.g. TSThisParameter has `decorators: []` and `optional: false`).
 */
export function isIdentifier(
  node: Node,
): node is Extract<Node, { type: 'Identifier' }> {
  return node.type === 'Identifier';
}

/**
 * Note: discriminator `"MemberExpression"` is shared by 3 interfaces —
 * ComputedMemberExpression, StaticMemberExpression, PrivateFieldExpression.
 * All 3 expose `.object` and a property-side field (`.property` /
 * `.field`). Callers needing finer distinction should check `.computed`
 * (Computed only) or the property-side field shape.
 */
export function isMemberExpression(
  node: Node,
): node is Extract<Node, { type: 'MemberExpression' }> {
  return node.type === 'MemberExpression';
}

/**
 * Note: discriminator `"TSQualifiedName"` is shared by 2 interfaces —
 * TSQualifiedName and TSImportTypeQualifiedName. Both expose `.left` and
 * `.right`, but `.left` shape differs (TSQualifiedName: TSQualifiedName |
 * IdentifierName; TSImportTypeQualifiedName: TSImportTypeQualifier).
 */
export function isTSQualifiedName(
  node: Node,
): node is Extract<Node, { type: 'TSQualifiedName' }> {
  return node.type === 'TSQualifiedName';
}

export function isVariableDeclaration(
  node: Node,
): node is Extract<Node, { type: 'VariableDeclaration' }> {
  return node.type === 'VariableDeclaration';
}

export function getNodeName(node: unknown): string | null {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
  const record = node as Record<string, unknown>;
  return typeof record.name === 'string' ? record.name : null;
}

export function getStringLiteralValue(node: unknown): string | null {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
  const record = node as Record<string, unknown>;
  if (
    (record.type === 'StringLiteral' || record.type === 'Literal') &&
    typeof record.value === 'string'
  ) {
    return record.value;
  }
  return null;
}

export function getQualifiedName(expr: unknown): QualifiedName | null {
  if (!expr || typeof expr !== 'object' || Array.isArray(expr)) return null;
  const node = expr as Record<string, unknown>;

  if (node.type === 'Identifier') {
    const name = node.name as string;
    return { root: name, parts: [], full: name };
  }

  if (node.type === 'ThisExpression') {
    return { root: 'this', parts: [], full: 'this' };
  }

  if (node.type === 'Super') {
    return { root: 'super', parts: [], full: 'super' };
  }

  if (node.type === 'MemberExpression') {
    const parts: string[] = [];
    let current: Record<string, unknown> = node;

    while (current.type === 'MemberExpression') {
      const prop = current.property as Record<string, unknown> | undefined;
      if (!prop || typeof prop.name !== 'string') return null;
      parts.push(prop.name);
      current = current.object as Record<string, unknown>;
    }

    let root: string;
    if (current.type === 'Identifier') {
      root = current.name as string;
    } else if (current.type === 'ThisExpression') {
      root = 'this';
    } else if (current.type === 'Super') {
      root = 'super';
    } else {
      return null;
    }

    parts.reverse();
    const full = [root, ...parts].join('.');
    return { root, parts, full };
  }

  return null;
}
