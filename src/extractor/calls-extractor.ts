import type { CallExpression, NewExpression, Node, Program } from 'oxc-parser';
import { walk } from 'oxc-walker';
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

  function handleCallOrNew(node: CallExpression | NewExpression, isNew: boolean): void {
    const qn = getQualifiedName(node.callee);
    const dst = resolveCallee(qn);
    if (dst) {
      const srcSymbolName = currentCaller();
      const meta: Record<string, unknown> = {};
      if (isNew) meta.isNew = true;
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
  }

  function pushFunctionScope(node: Node, parent: Node | null): void {
    if (node.type === 'FunctionDeclaration') {
      functionStack.push(node.id?.name ?? 'anonymous');
      return;
    }

    if (node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
      if (parent?.type === 'VariableDeclarator') {
        const id = parent.id;
        const name = id.type === 'Identifier' ? id.name : 'anonymous';
        functionStack.push(name);
        return;
      }

      if (
        parent?.type === 'MethodDefinition' ||
        parent?.type === 'TSAbstractMethodDefinition'
      ) {
        const key = parent.key;
        const className = classStack[classStack.length - 1] ?? '';
        const methodName = 'name' in key ? (key.name as string) : 'anonymous';
        const fullName = className ? `${className}.${methodName}` : methodName;
        functionStack.push(fullName);
        return;
      }

      const parentCaller = currentCaller();
      const anonymousName = parentCaller ? `${parentCaller}.<anonymous>` : '<anonymous>';
      functionStack.push(anonymousName);
    }
  }

  walk(ast, {
    enter(node, parent) {
      if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
        classStack.push(node.id?.name ?? 'AnonymousClass');
        return;
      }

      if (
        node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression'
      ) {
        pushFunctionScope(node, parent);
        return;
      }

      if (node.type === 'CallExpression') {
        handleCallOrNew(node, false);
        return;
      }

      if (node.type === 'NewExpression') {
        handleCallOrNew(node, true);
        return;
      }
    },
    leave(node) {
      if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
        classStack.pop();
        return;
      }

      if (
        node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression'
      ) {
        functionStack.pop();
        return;
      }
    },
  });

  return relations;
}
