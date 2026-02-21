import type { Program } from 'oxc-parser';
import type { ImportReference, CodeRelation } from './types';
import { getQualifiedName } from '../parser/ast-utils';

export function extractCalls(
  ast: Program,
  filePath: string,
  importMap: Map<string, ImportReference>,
): CodeRelation[] {
  const relations: CodeRelation[] = [];
  const functionStack: string[] = [];
  const classStack: string[] = [];

  function currentCaller(): string | null {
    if (functionStack.length > 0) return functionStack[functionStack.length - 1] ?? null;
    return null;
  }

  function resolveCallee(
    qn: { root: string; parts: string[]; full: string } | null,
  ): { dstFilePath: string; dstSymbolName: string; resolution: string } | null {
    if (!qn) return null;

    const ref = importMap.get(qn.root);

    if (qn.parts.length === 0) {
      if (ref) {
        return { dstFilePath: ref.path, dstSymbolName: ref.importedName, resolution: 'import' };
      }
      return { dstFilePath: filePath, dstSymbolName: qn.root, resolution: 'local' };
    } else {
      if (ref && ref.importedName === '*') {
        const dstSymbolName = qn.parts[qn.parts.length - 1]!;
        return { dstFilePath: ref.path, dstSymbolName, resolution: 'namespace' };
      }
      return { dstFilePath: filePath, dstSymbolName: qn.full, resolution: 'local-member' };
    }
  }

  function walk(node: unknown): void {
    if (!node || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }

    const record = node as Record<string, unknown>;
    const type: string = typeof record.type === 'string' ? record.type : '';

    if (type === 'ClassDeclaration' || type === 'ClassExpression') {
      const classNode = record as { id?: { name?: string }; body?: unknown };
      const className: string = classNode.id?.name ?? 'AnonymousClass';
      classStack.push(className);
      walk(classNode.body);
      classStack.pop();
      return;
    }

    if (type === 'FunctionDeclaration') {
      const functionNode = record as { id?: { name?: string }; body?: unknown };
      const name: string = functionNode.id?.name ?? 'anonymous';
      functionStack.push(name);
      walk(functionNode.body);
      functionStack.pop();
      return;
    }

    if (type === 'VariableDeclarator' && (record as { init?: { type?: string } }).init && (
      (record as { init?: { type?: string } }).init?.type === 'FunctionExpression' ||
      (record as { init?: { type?: string } }).init?.type === 'ArrowFunctionExpression'
    )) {
      const declarator = record as { id?: { name?: string }; init?: { body?: unknown } };
      const name: string = declarator.id?.name ?? 'anonymous';
      functionStack.push(name);
      walk(declarator.init?.body ?? declarator.init);
      functionStack.pop();
      return;
    }

    if (type === 'MethodDefinition' && (record as { value?: unknown }).value) {
      const method = record as { key?: { name?: string }; value?: { body?: unknown } };
      const className = classStack[classStack.length - 1] ?? '';
      const methodName: string = method.key?.name ?? 'anonymous';
      const fullName = className ? `${className}.${methodName}` : methodName;
      functionStack.push(fullName);
      walk(method.value?.body);
      functionStack.pop();
      return;
    }

    if (type === 'FunctionExpression' || type === 'ArrowFunctionExpression') {
      const parentCaller = currentCaller();
      const anonymousName = parentCaller ? `${parentCaller}.<anonymous>` : '<anonymous>';
      functionStack.push(anonymousName);
      walk((record as { body?: unknown }).body);
      functionStack.pop();
      return;
    }

    if (type === 'CallExpression') {
      const call = record as { callee?: unknown; arguments?: unknown[] };
      const qn = getQualifiedName(call.callee);
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
      walk(call.callee);
      for (const arg of call.arguments ?? []) walk(arg);
      return;
    }

    if (type === 'NewExpression') {
      const ctorCall = record as { callee?: unknown; arguments?: unknown[] };
      const qn = getQualifiedName(ctorCall.callee);
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
      for (const arg of ctorCall.arguments ?? []) walk(arg);
      return;
    }

    for (const key of Object.keys(record)) {
      if (key === 'loc' || key === 'start' || key === 'end' || key === 'scope') continue;
      const child = record[key];
      if (child && typeof child === 'object') {
        walk(child);
      }
    }
  }

  walk(ast);
  return relations;
}
