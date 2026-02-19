import type { Program } from 'oxc-parser';
import type { ImportReference, CodeRelation } from './types';
import { getQualifiedName } from '../parser/ast-utils';

/**
 * Extracts all function call and constructor instantiation relations from the AST.
 * Maintains a function/class stack for caller identification.
 *
 * @param ast       - The parsed Program AST.
 * @param filePath  - File path of the source file (used as srcFilePath).
 * @param importMap - Map from local identifiers to their resolved import references.
 */
export function extractCalls(
  ast: Program,
  filePath: string,
  importMap: Map<string, ImportReference>,
): CodeRelation[] {
  const relations: CodeRelation[] = [];
  const functionStack: string[] = [];
  const classStack: string[] = [];

  function currentCaller(): string | null {
    if (functionStack.length > 0) return functionStack[functionStack.length - 1];
    return null;
  }

  function resolveCallee(
    qn: { root: string; parts: string[]; full: string } | null,
  ): { dstFilePath: string; dstSymbolName: string; resolution: string } | null {
    if (!qn) return null;

    const ref = importMap.get(qn.root);

    if (qn.parts.length === 0) {
      // No parts
      if (ref) {
        return { dstFilePath: ref.path, dstSymbolName: ref.importedName, resolution: 'import' };
      }
      return { dstFilePath: filePath, dstSymbolName: qn.root, resolution: 'local' };
    } else {
      // Has parts
      if (ref && ref.importedName === '*') {
        // Namespace import: utils.format() → dstFile = utils module, dstSymbol = last part
        const dstSymbolName = qn.parts[qn.parts.length - 1];
        return { dstFilePath: ref.path, dstSymbolName, resolution: 'namespace' };
      }
      return { dstFilePath: filePath, dstSymbolName: qn.full, resolution: 'local-member' };
    }
  }

  function walk(node: any): void {
    if (!node || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }

    const type: string = node.type ?? '';

    if (type === 'ClassDeclaration' || type === 'ClassExpression') {
      const className: string = node.id?.name ?? 'AnonymousClass';
      classStack.push(className);
      walk(node.body);
      classStack.pop();
      return;
    }

    if (type === 'FunctionDeclaration') {
      const name: string = node.id?.name ?? 'anonymous';
      functionStack.push(name);
      walk(node.body);
      functionStack.pop();
      return;
    }

    if (type === 'VariableDeclarator' && node.init && (
      node.init.type === 'FunctionExpression' ||
      node.init.type === 'ArrowFunctionExpression'
    )) {
      const name: string = node.id?.name ?? 'anonymous';
      functionStack.push(name);
      walk(node.init.body ?? node.init);
      functionStack.pop();
      return;
    }

    if (type === 'MethodDefinition' && node.value) {
      const className = classStack[classStack.length - 1] ?? '';
      const methodName: string = node.key?.name ?? 'anonymous';
      const fullName = className ? `${className}.${methodName}` : methodName;
      functionStack.push(fullName);
      walk(node.value.body);
      functionStack.pop();
      return;
    }

    if (type === 'FunctionExpression' || type === 'ArrowFunctionExpression') {
      // Anonymous function — don't push new name, just walk body
      walk(node.body);
      return;
    }

    if (type === 'CallExpression') {
      const qn = getQualifiedName(node.callee);
      const dst = resolveCallee(qn);
      if (dst) {
        const srcSymbolName = currentCaller();
        const meta: Record<string, unknown> = {};
        if (srcSymbolName === null) meta.scope = 'module';

        relations.push({
          type: 'calls',
          srcFilePath: filePath,
          srcSymbolName,
          dstFilePath: dst.dstFilePath,
          dstSymbolName: dst.dstSymbolName,
          ...(Object.keys(meta).length > 0 ? { metaJson: JSON.stringify(meta) } : {}),
        });
      }
      // Also walk arguments
      for (const arg of node.arguments ?? []) walk(arg);
      return;
    }

    if (type === 'NewExpression') {
      const qn = getQualifiedName(node.callee);
      const dst = resolveCallee(qn);
      if (dst) {
        const srcSymbolName = currentCaller();
        const meta: Record<string, unknown> = { isNew: true };
        if (srcSymbolName === null) meta.scope = 'module';

        relations.push({
          type: 'calls',
          srcFilePath: filePath,
          srcSymbolName,
          dstFilePath: dst.dstFilePath,
          dstSymbolName: dst.dstSymbolName,
          metaJson: JSON.stringify(meta),
        });
      }
      for (const arg of node.arguments ?? []) walk(arg);
      return;
    }

    // Generic: recurse into all object children (skip irrelevant keys)
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end' || key === 'scope') continue;
      const child = node[key];
      if (child && typeof child === 'object') {
        walk(child);
      }
    }
  }

  walk(ast as any);
  return relations;
}
