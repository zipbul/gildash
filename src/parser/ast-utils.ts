import type { QualifiedName } from '../extractor/types';

/** Keys to skip during AST traversal to avoid infinite loops / irrelevant data. */
const SKIP_KEYS = new Set(['loc', 'start', 'end', 'scope']);

/**
 * Returns true if value is a non-null, non-array object (i.e., an AST node record).
 */
export function isNode(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Returns true if value is an Array.
 */
export function isNodeArray(value: unknown): value is ReadonlyArray<unknown> {
  return Array.isArray(value);
}

/**
 * Pre-order recursive traversal of an AST subtree.
 * Skips 'loc', 'start', 'end', 'scope' keys to avoid infinite loops.
 *
 * @param node     - Root of the subtree to traverse.
 * @param callback - Called for each AST node record encountered.
 */
export function visit(
  node: unknown,
  callback: (node: Record<string, unknown>) => void,
): void {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const item of node) visit(item, callback);
    return;
  }

  const record = node as Record<string, unknown>;
  callback(record);

  for (const key of Object.keys(record)) {
    if (SKIP_KEYS.has(key)) continue;
    const child = record[key];
    if (child && typeof child === 'object') {
      visit(child, callback);
    }
  }
}

/**
 * Collects all AST nodes for which predicate returns true.
 */
export function collectNodes(
  root: unknown,
  predicate: (node: Record<string, unknown>) => boolean,
): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  visit(root, (node) => {
    if (predicate(node)) results.push(node);
  });
  return results;
}

/**
 * Extracts the "name" of an AST node using a priority-based resolution order.
 * Falls back to 'anonymous' if no name can be determined.
 *
 * @param node   - The AST node to inspect.
 * @param parent - Optional parent node for additional name resolution.
 */
export function getNodeHeader(
  node: Record<string, unknown>,
  parent?: Record<string, unknown> | null,
): string {
  // 1. node.id.name
  const id = node.id as Record<string, unknown> | undefined;
  if (id && typeof id.name === 'string') return id.name;

  // 2. node.key.name
  const key = node.key as Record<string, unknown> | undefined;
  if (key) {
    if (typeof key.name === 'string') return key.name;
    // 3. node.key as string literal value
    if (
      (key.type === 'StringLiteral' || key.type === 'Literal') &&
      typeof key.value === 'string'
    ) {
      return key.value;
    }
  }

  // 4. parent-based resolution
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
 * Returns true if the node type is FunctionDeclaration, FunctionExpression,
 * or ArrowFunctionExpression.
 */
export function isFunctionNode(node: Record<string, unknown>): boolean {
  return (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression'
  );
}

/**
 * Returns the string 'name' property of a node if present, otherwise null.
 */
export function getNodeName(node: unknown): string | null {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
  const record = node as Record<string, unknown>;
  return typeof record.name === 'string' ? record.name : null;
}

/**
 * Returns the string value if the node is a StringLiteral or Literal with a string value.
 * Otherwise returns null.
 */
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

/**
 * Resolves dotted member expressions into a QualifiedName.
 * Handles Identifier, ThisExpression, Super, and MemberExpression chains.
 * Returns null for all other node types.
 */
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

    // Walk the chain from the outermost MemberExpression inward, collecting property names.
    while (current.type === 'MemberExpression') {
      const prop = current.property as Record<string, unknown> | undefined;
      if (!prop || typeof prop.name !== 'string') return null;
      parts.unshift(prop.name);
      current = current.object as Record<string, unknown>;
    }

    // The leftmost node must be an Identifier, ThisExpression, or Super.
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

    const full = [root, ...parts].join('.');
    return { root, parts, full };
  }

  return null;
}
