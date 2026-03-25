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

/** Check if an import path is a bare specifier (external package). */
function isBareSpecifier(importPath: string): boolean {
  return !importPath.startsWith('.') && !importPath.startsWith('/');
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
      const resolved = candidates.length > 0 ? candidates[0]! : null;

      const isType = importNode.importKind === 'type';
      const specifiers: readonly ImportDeclarationSpecifier[] = importNode.specifiers;

      // When unresolved, create relation(s) with null dstFilePath and specifier info
      const isExternal = resolved === null && isBareSpecifier(sourcePath);
      const baseProps = resolved === null
        ? { dstFilePath: null as string | null, specifier: sourcePath }
        : { dstFilePath: resolved as string | null };

      if (specifiers.length === 0) {
        // side-effect import: import './foo'
        const meta: Record<string, unknown> = {};
        if (isType) meta.isType = true;
        if (isExternal) meta.isExternal = true;
        if (resolved === null && !isExternal) meta.isUnresolved = true;
        relations.push({
          type: isType ? 'type-references' : 'imports',
          srcFilePath: filePath,
          srcSymbolName: null,
          ...baseProps,
          dstSymbolName: null,
          ...(Object.keys(meta).length > 0 ? { metaJson: JSON.stringify(meta) } : {}),
        });
      } else {
        for (const spec of specifiers) {
          const specType = spec.type;
          const isSpecType = isType || (specType === 'ImportSpecifier' && spec.importKind === 'type');
          const meta: Record<string, unknown> = {};
          if (isSpecType) meta.isType = true;
          if (isExternal) meta.isExternal = true;
          if (resolved === null && !isExternal) meta.isUnresolved = true;

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
            ...baseProps,
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
      const resolved = candidates.length > 0 ? candidates[0]! : null;

      const isType = exportAll.exportKind === 'type';
      const isExternal = resolved === null && isBareSpecifier(sourcePath);
      const meta: Record<string, unknown> = { isReExport: true };
      if (isType) meta.isType = true;
      if (isExternal) meta.isExternal = true;
      if (resolved === null && !isExternal) meta.isUnresolved = true;
      relations.push({
        type: isType ? 'type-references' : 're-exports',
        srcFilePath: filePath,
        srcSymbolName: null,
        dstFilePath: resolved,
        dstSymbolName: null,
        metaJson: JSON.stringify(meta),
        ...(resolved === null ? { specifier: sourcePath } : {}),
      });
      continue;
    }

    if (stmtNode.type === 'ExportNamedDeclaration') {
      const exportNamed = stmtNode as ExportNamedDeclaration;
      if (!exportNamed.source) continue;
      const sourcePath: string = exportNamed.source.value;
      const candidates = resolveImportFn(filePath, sourcePath, tsconfigPaths);
      const resolved = candidates.length > 0 ? candidates[0]! : null;

      const isType = exportNamed.exportKind === 'type';
      const isExternal = resolved === null && isBareSpecifier(sourcePath);
      const specifiers: readonly ExportSpecifier[] = exportNamed.specifiers ?? [];
      const specData = specifiers.map((s) => ({
        local: moduleExportName(s.local),
        exported: moduleExportName(s.exported),
      }));

      const meta: Record<string, unknown> = { isReExport: true, specifiers: specData };
      if (isType) meta.isType = true;
      if (isExternal) meta.isExternal = true;
      if (resolved === null && !isExternal) meta.isUnresolved = true;

      relations.push({
        type: isType ? 'type-references' : 're-exports',
        srcFilePath: filePath,
        srcSymbolName: null,
        dstFilePath: resolved,
        dstSymbolName: null,
        metaJson: JSON.stringify(meta),
        ...(resolved === null ? { specifier: sourcePath } : {}),
      });
    }
  }

  visit(ast, (node) => {
    // Dynamic import() expressions
    if (node.type === 'ImportExpression') {
      const sourceValue = getStringLiteralValue(node.source);
      if (!sourceValue) return;
      const candidates = resolveImportFn(filePath, sourceValue, tsconfigPaths);
      const resolved = candidates.length > 0 ? candidates[0]! : null;

      const isExternal = resolved === null && isBareSpecifier(sourceValue);
      const meta: Record<string, unknown> = { isDynamic: true };
      if (isExternal) meta.isExternal = true;
      if (resolved === null && !isExternal) meta.isUnresolved = true;

      relations.push({
        type: 'imports',
        srcFilePath: filePath,
        srcSymbolName: null,
        dstFilePath: resolved,
        dstSymbolName: null,
        metaJson: JSON.stringify(meta),
        ...(resolved === null ? { specifier: sourceValue } : {}),
      });
      return;
    }

    // require() and require.resolve() calls
    if (node.type === 'CallExpression') {
      const callee = node.callee as Record<string, unknown> | undefined;
      if (!callee) return;

      let isRequireResolve = false;

      if (callee.type === 'Identifier' && callee.name === 'require') {
        // require('...')
      } else if (callee.type === 'StaticMemberExpression' || callee.type === 'MemberExpression') {
        // require.resolve('...')
        const obj = callee.object as Record<string, unknown> | undefined;
        const prop = callee.property as Record<string, unknown> | undefined;
        if (
          obj?.type === 'Identifier' && obj.name === 'require' &&
          prop && (prop.name === 'resolve' || prop.value === 'resolve')
        ) {
          isRequireResolve = true;
        } else {
          return;
        }
      } else {
        return;
      }

      const args = node.arguments as ReadonlyArray<Record<string, unknown>> | undefined;
      if (!args || args.length === 0) return;

      const sourceValue = getStringLiteralValue(args[0]);
      if (!sourceValue) return;

      const candidates = resolveImportFn(filePath, sourceValue, tsconfigPaths);
      const resolved = candidates.length > 0 ? candidates[0]! : null;

      const isExternal = resolved === null && isBareSpecifier(sourceValue);
      const meta: Record<string, unknown> = { isRequire: true };
      if (isRequireResolve) meta.isRequireResolve = true;
      if (isExternal) meta.isExternal = true;
      if (resolved === null && !isExternal) meta.isUnresolved = true;

      relations.push({
        type: 'imports',
        srcFilePath: filePath,
        srcSymbolName: null,
        dstFilePath: resolved,
        dstSymbolName: null,
        metaJson: JSON.stringify(meta),
        ...(resolved === null ? { specifier: sourceValue } : {}),
      });
    }
  });

  return relations;
}
