import type { Program, Class, TSInterfaceDeclaration, TSInterfaceHeritage, TSClassImplements } from 'oxc-parser';
import { Visitor } from 'oxc-parser';
import type { ImportReference, CodeRelation } from './types';
import { getQualifiedName } from '../parser/ast-utils';

export function extractHeritage(
  ast: Program,
  filePath: string,
  importMap: Map<string, ImportReference>,
): CodeRelation[] {
  const relations: CodeRelation[] = [];

  function processClass(node: Class): void {
    const className: string = node.id?.name ?? 'AnonymousClass';

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

    const impls: readonly TSClassImplements[] = node.implements ?? [];
    for (const impl of impls) {
      const qn = getQualifiedName(impl.expression);
      if (!qn) continue;
      const rel = resolveHeritageDst(qn, filePath, importMap);
      relations.push({
        type: 'implements',
        srcFilePath: filePath,
        srcSymbolName: className,
        ...rel,
      });
    }
  }

  const visitor = new Visitor({
    TSInterfaceDeclaration(node: TSInterfaceDeclaration) {
      const interfaceName: string = node.id.name ?? 'AnonymousInterface';
      const heritages: readonly TSInterfaceHeritage[] = node.extends;
      for (const item of heritages) {
        const qn = getQualifiedName(item.expression);
        if (!qn) continue;
        const rel = resolveHeritageDst(qn, filePath, importMap);
        relations.push({
          type: 'extends',
          srcFilePath: filePath,
          srcSymbolName: interfaceName,
          ...rel,
        });
      }
    },
    ClassDeclaration(node: Class) {
      processClass(node);
    },
    ClassExpression(node: Class) {
      processClass(node);
    },
  });
  visitor.visit(ast);

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
