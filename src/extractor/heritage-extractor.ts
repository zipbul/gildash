import type { Program } from 'oxc-parser';
import type { ImportReference, CodeRelation } from './types';
import { visit, getQualifiedName } from '../parser/ast-utils';

export function extractHeritage(
  ast: Program,
  filePath: string,
  importMap: Map<string, ImportReference>,
): CodeRelation[] {
  const relations: CodeRelation[] = [];

  visit(ast, (node) => {
    if (node.type === 'TSInterfaceDeclaration') {
      const interfaceName: string = ((node.id as { name?: string } | undefined)?.name) ?? 'AnonymousInterface';
      const interfaces = (node.extends as unknown[] | undefined) ?? [];
      for (const item of interfaces) {
        const expr = (item as { expression?: unknown }).expression ?? item;
        const qn = getQualifiedName(expr);
        if (!qn) continue;
        const rel = resolveHeritageDst(qn, filePath, importMap);
        relations.push({
          type: 'extends',
          srcFilePath: filePath,
          srcSymbolName: interfaceName,
          ...rel,
        });
      }
      return;
    }

    if (node.type !== 'ClassDeclaration' && node.type !== 'ClassExpression') return;

    const className: string =
      ((node.id as { name?: string } | undefined)?.name) ?? 'AnonymousClass';

    if (node.superClass) {
      const qn = getQualifiedName(node.superClass);
      if (qn) {
        const rel = resolveHeritageDst(qn, filePath, importMap);
        relations.push({
          type: 'extends',
          srcFilePath: filePath,
          srcSymbolName: className,
          ...rel,
        });
      }
    }

    const impls = (node.implements as unknown[] | undefined) ?? [];
    for (const impl of impls) {
      const expr = (impl as { expression?: unknown }).expression ?? impl;
      const qn = getQualifiedName(expr);
      if (!qn) continue;
      const rel = resolveHeritageDst(qn, filePath, importMap);
      relations.push({
        type: 'implements',
        srcFilePath: filePath,
        srcSymbolName: className,
        ...rel,
      });
    }
  });

  return relations;
}

function resolveHeritageDst(
  qn: { root: string; parts: string[]; full: string },
  currentFilePath: string,
  importMap: Map<string, ImportReference>,
): { dstFilePath: string; dstSymbolName: string; metaJson?: string } {
  const ref = importMap.get(qn.root);

  if (ref) {
    if (ref.importedName === '*') {
      const dstSymbolName = qn.parts[qn.parts.length - 1] ?? qn.root;
      return {
        dstFilePath: ref.path,
        dstSymbolName,
        metaJson: JSON.stringify({ isNamespaceImport: true }),
      };
    }
    return {
      dstFilePath: ref.path,
      dstSymbolName: qn.parts.length > 0 ? qn.full : ref.importedName,
    };
  }

  return {
    dstFilePath: currentFilePath,
    dstSymbolName: qn.full,
    metaJson: JSON.stringify({ isLocal: true }),
  };
}
