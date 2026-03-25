import type { Program } from 'oxc-parser';
import type {
  Statement,
  Directive,
  ImportDeclaration,
  ExportAllDeclaration,
  ExportNamedDeclaration,
  ImportDeclarationSpecifier,
  ExportSpecifier,
} from 'oxc-parser';
import type { TsconfigPaths } from '../common/tsconfig-resolver';
import type { CodeRelation } from './types';
import { resolveImport } from './extractor-utils';
import { visit, getStringLiteralValue } from '../parser/ast-utils';

/** Extract name from a ModuleExportName (IdentifierName | IdentifierReference | StringLiteral). */
function moduleExportName(node: { name?: string; value?: string }): string {
  return ('name' in node && typeof node.name === 'string') ? node.name
    : ('value' in node && typeof node.value === 'string') ? node.value
    : 'unknown';
}

export function extractImports(
  ast: Program,
  filePath: string,
  tsconfigPaths?: TsconfigPaths,
  resolveImportFn: (
    currentFilePath: string,
    importPath: string,
    tsconfigPaths?: TsconfigPaths,
  ) => string[] = resolveImport,
): CodeRelation[] {
  const relations: CodeRelation[] = [];

  for (const node of ast.body) {
    const stmtNode = node as Statement | Directive;

    if (stmtNode.type === 'ImportDeclaration') {
      const importNode = stmtNode as ImportDeclaration;
      const sourcePath: string = importNode.source.value;
      const candidates = resolveImportFn(filePath, sourcePath, tsconfigPaths);
      if (candidates.length === 0) continue;
      const resolved = candidates[0]!;

      const isType = importNode.importKind === 'type';
      const specifiers: readonly ImportDeclarationSpecifier[] = importNode.specifiers;

      if (specifiers.length === 0) {
        // side-effect import: import './foo'
        const meta: Record<string, unknown> = {};
        if (isType) meta.isType = true;
        relations.push({
          type: isType ? 'type-references' : 'imports',
          srcFilePath: filePath,
          srcSymbolName: null,
          dstFilePath: resolved,
          dstSymbolName: null,
          ...(Object.keys(meta).length > 0 ? { metaJson: JSON.stringify(meta) } : {}),
        });
      } else {
        for (const spec of specifiers) {
          const specType = spec.type;
          const isSpecType = isType || (specType === 'ImportSpecifier' && spec.importKind === 'type');
          const meta: Record<string, unknown> = {};
          if (isSpecType) meta.isType = true;

          let dstSymbolName: string;
          let srcSymbolName: string;

          if (specType === 'ImportDefaultSpecifier') {
            dstSymbolName = 'default';
            srcSymbolName = spec.local.name;
          } else if (specType === 'ImportNamespaceSpecifier') {
            dstSymbolName = '*';
            srcSymbolName = spec.local.name;
            meta.importKind = 'namespace';
          } else {
            // ImportSpecifier
            dstSymbolName = moduleExportName(spec.imported);
            srcSymbolName = spec.local.name;
          }

          relations.push({
            type: isSpecType ? 'type-references' : 'imports',
            srcFilePath: filePath,
            srcSymbolName,
            dstFilePath: resolved,
            dstSymbolName,
            ...(Object.keys(meta).length > 0 ? { metaJson: JSON.stringify(meta) } : {}),
          });
        }
      }
      continue;
    }

    if (stmtNode.type === 'ExportAllDeclaration') {
      const exportAll = stmtNode as ExportAllDeclaration;
      const sourcePath: string = exportAll.source.value;
      const candidates = resolveImportFn(filePath, sourcePath, tsconfigPaths);
      if (candidates.length === 0) continue;
      const resolved = candidates[0]!;

      const isType = exportAll.exportKind === 'type';
      const meta: Record<string, unknown> = { isReExport: true };
      if (isType) meta.isType = true;
      relations.push({
        type: isType ? 'type-references' : 're-exports',
        srcFilePath: filePath,
        srcSymbolName: null,
        dstFilePath: resolved,
        dstSymbolName: null,
        metaJson: JSON.stringify(meta),
      });
      continue;
    }

    if (stmtNode.type === 'ExportNamedDeclaration') {
      const exportNamed = stmtNode as ExportNamedDeclaration;
      if (!exportNamed.source) continue;
      const sourcePath: string = exportNamed.source.value;
      const candidates = resolveImportFn(filePath, sourcePath, tsconfigPaths);
      if (candidates.length === 0) continue;
      const resolved = candidates[0]!;

      const isType = exportNamed.exportKind === 'type';
      const specifiers: readonly ExportSpecifier[] = exportNamed.specifiers ?? [];
      const specData = specifiers.map((s) => ({
        local: moduleExportName(s.local),
        exported: moduleExportName(s.exported),
      }));

      const meta: Record<string, unknown> = { isReExport: true, specifiers: specData };
      if (isType) meta.isType = true;

      relations.push({
        type: isType ? 'type-references' : 're-exports',
        srcFilePath: filePath,
        srcSymbolName: null,
        dstFilePath: resolved,
        dstSymbolName: null,
        metaJson: JSON.stringify(meta),
      });
    }
  }

  visit(ast, (node) => {
    if (node.type !== 'ImportExpression') return;
    const sourceValue = getStringLiteralValue(node.source);
    if (!sourceValue) return;
    const candidates = resolveImportFn(filePath, sourceValue, tsconfigPaths);
    if (candidates.length === 0) return;
    const resolved = candidates[0]!;

    relations.push({
      type: 'imports',
      srcFilePath: filePath,
      srcSymbolName: null,
      dstFilePath: resolved,
      dstSymbolName: null,
      metaJson: JSON.stringify({ isDynamic: true }),
    });
  });

  return relations;
}
