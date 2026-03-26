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

export function isFunctionNode(node: Record<string, unknown>): boolean {
  return (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression'
  );
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
