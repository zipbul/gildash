import type { Program, EcmaScriptModule, ImportNameKind } from 'oxc-parser';
import type {
  Statement,
  Directive,
  ImportDeclaration,
  ExportAllDeclaration,
  ExportNamedDeclaration,
  ImportDeclarationSpecifier,
  ExportSpecifier,
  ImportExpression,
  CallExpression,
  StaticMemberExpression,
  StringLiteral,
} from 'oxc-parser';
import { Visitor } from 'oxc-parser';
import type { TsconfigPaths } from '../common/tsconfig-resolver';
import type { CodeRelation } from './types';
import { resolveImport } from './extractor-utils';

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

type ResolveImportFn = (
  currentFilePath: string,
  importPath: string,
  tsconfigPaths?: TsconfigPaths,
) => string[];

/** Resolve an import path and return (resolved, isExternal) tuple. */
function resolveAndClassify(
  filePath: string,
  sourcePath: string,
  tsconfigPaths: TsconfigPaths | undefined,
  resolveImportFn: ResolveImportFn,
): { resolved: string | null; isExternal: boolean } {
  const candidates = resolveImportFn(filePath, sourcePath, tsconfigPaths);
  const resolved = candidates.length > 0 ? candidates[0]! : null;
  const isExternal = resolved === null && isBareSpecifier(sourcePath);
  return { resolved, isExternal };
}

// ─── module.staticImports-based extraction ────────────────────────────────

function extractStaticImports(
  module: EcmaScriptModule,
  filePath: string,
  tsconfigPaths: TsconfigPaths | undefined,
  resolveImportFn: ResolveImportFn,
  relations: CodeRelation[],
): void {
  for (const imp of module.staticImports) {
    const sourcePath = imp.moduleRequest.value;
    const { resolved, isExternal } = resolveAndClassify(filePath, sourcePath, tsconfigPaths, resolveImportFn);
    const baseProps = resolved === null
      ? { dstFilePath: null as string | null, specifier: sourcePath }
      : { dstFilePath: resolved as string | null };

    if (imp.entries.length === 0) {
      // side-effect import: import './foo'
      const meta: Record<string, unknown> = {};
      if (isExternal) meta.isExternal = true;
      if (resolved === null && !isExternal) meta.isUnresolved = true;
      relations.push({
        type: 'imports',
        srcFilePath: filePath,
        srcSymbolName: null,
        ...baseProps,
        dstSymbolName: null,
        ...(Object.keys(meta).length > 0 ? { metaJson: JSON.stringify(meta) } : {}),
      });
      continue;
    }

    for (const entry of imp.entries) {
      const isType = entry.isType;
      const meta: Record<string, unknown> = {};
      if (isType) meta.isType = true;
      if (isExternal) meta.isExternal = true;
      if (resolved === null && !isExternal) meta.isUnresolved = true;

      let dstSymbolName: string;
      let srcSymbolName: string;
      const kind: ImportNameKind = entry.importName.kind;

      if (kind === 'Default') {
        dstSymbolName = 'default';
        srcSymbolName = entry.localName.value;
      } else if (kind === 'NamespaceObject') {
        dstSymbolName = '*';
        srcSymbolName = entry.localName.value;
        meta.importKind = 'namespace';
      } else {
        // 'Name'
        dstSymbolName = entry.importName.name ?? 'unknown';
        srcSymbolName = entry.localName.value;
      }

      relations.push({
        type: isType ? 'type-references' : 'imports',
        srcFilePath: filePath,
        srcSymbolName,
        ...baseProps,
        dstSymbolName,
        ...(Object.keys(meta).length > 0 ? { metaJson: JSON.stringify(meta) } : {}),
      });
    }
  }
}

function extractStaticExports(
  module: EcmaScriptModule,
  filePath: string,
  tsconfigPaths: TsconfigPaths | undefined,
  resolveImportFn: ResolveImportFn,
  relations: CodeRelation[],
): void {
  // Build import name → module source mapping for pattern C cross-reference
  const importNameToSource = new Map<string, string>();
  for (const imp of module.staticImports) {
    for (const entry of imp.entries) {
      importNameToSource.set(entry.localName.value, imp.moduleRequest.value);
    }
  }

  for (const exp of module.staticExports) {
    for (const entry of exp.entries) {
      let sourcePath: string | null = null;

      if (entry.moduleRequest) {
        sourcePath = entry.moduleRequest.value;
      } else if (entry.localName.name) {
        // Pattern C: cross-reference with imports
        sourcePath = importNameToSource.get(entry.localName.name) ?? null;
      }

      if (!sourcePath) continue;

      const { resolved, isExternal } = resolveAndClassify(filePath, sourcePath, tsconfigPaths, resolveImportFn);

      const exportName = entry.exportName.name ?? 'default';
      const exportKind = entry.exportName.kind;
      // For direct re-exports (Pattern A), localName is null — use importName instead
      const localName = entry.localName.name ?? entry.importName.name ?? exportName;
      const isType = entry.isType;

      const meta: Record<string, unknown> = { isReExport: true };

      // export * from → no specifiers; export * as ns from → namespaceAlias
      if (exportKind === 'None') {
        // export * from './mod' — no specifiers
      } else {
        meta.specifiers = [{ local: localName, exported: exportName }];
      }

      if (isType) meta.isType = true;
      if (isExternal) meta.isExternal = true;
      if (resolved === null && !isExternal) meta.isUnresolved = true;

      // Namespace alias: export * as ns from './mod'
      let srcSymbolName: string | null = null;
      let dstSymbolName: string | null = null;
      const importKind = entry.importName.kind;
      if (importKind === 'All' || importKind === 'AllButDefault') {
        if (exportKind === 'Name' && exportName) {
          dstSymbolName = exportName;
          meta.namespaceAlias = exportName;
        }
      } else {
        // Named re-export: export { X } from './mod' or export { X as Y } from './mod'
        dstSymbolName = localName;
        srcSymbolName = exportName;
      }

      relations.push({
        type: isType ? 'type-references' : 're-exports',
        srcFilePath: filePath,
        srcSymbolName,
        dstFilePath: resolved,
        dstSymbolName,
        metaJson: JSON.stringify(meta),
        ...(resolved === null ? { specifier: sourcePath } : {}),
      });
    }
  }
}

// ─── AST-based extraction (fallback when module is not available) ─────────

function extractStaticImportsFromAst(
  ast: Program,
  filePath: string,
  tsconfigPaths: TsconfigPaths | undefined,
  resolveImportFn: ResolveImportFn,
  relations: CodeRelation[],
): void {
  for (const node of ast.body) {
    const stmtNode = node as Statement | Directive;

    if (stmtNode.type === 'ImportDeclaration') {
      const importNode = stmtNode as ImportDeclaration;
      const sourcePath: string = importNode.source.value;
      const { resolved, isExternal } = resolveAndClassify(filePath, sourcePath, tsconfigPaths, resolveImportFn);

      const isType = importNode.importKind === 'type';
      const specifiers: readonly ImportDeclarationSpecifier[] = importNode.specifiers;

      const baseProps = resolved === null
        ? { dstFilePath: null as string | null, specifier: sourcePath }
        : { dstFilePath: resolved as string | null };

      if (specifiers.length === 0) {
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
      const { resolved, isExternal } = resolveAndClassify(filePath, sourcePath, tsconfigPaths, resolveImportFn);

      const isType = exportAll.exportKind === 'type';
      const exported = exportAll.exported;
      const aliasName: string | null = exported ? moduleExportName(exported) : null;
      const meta: Record<string, unknown> = { isReExport: true };
      if (isType) meta.isType = true;
      if (isExternal) meta.isExternal = true;
      if (resolved === null && !isExternal) meta.isUnresolved = true;
      if (aliasName) meta.namespaceAlias = aliasName;
      relations.push({
        type: isType ? 'type-references' : 're-exports',
        srcFilePath: filePath,
        srcSymbolName: null,
        dstFilePath: resolved,
        dstSymbolName: aliasName,
        metaJson: JSON.stringify(meta),
        ...(resolved === null ? { specifier: sourcePath } : {}),
      });
      continue;
    }

    if (stmtNode.type === 'ExportNamedDeclaration') {
      const exportNamed = stmtNode as ExportNamedDeclaration;
      if (!exportNamed.source) continue;
      const sourcePath: string = exportNamed.source.value;
      const { resolved, isExternal } = resolveAndClassify(filePath, sourcePath, tsconfigPaths, resolveImportFn);

      const stmtIsType = exportNamed.exportKind === 'type';
      const specifiers: readonly ExportSpecifier[] = exportNamed.specifiers ?? [];

      for (const spec of specifiers) {
        const specIsType = stmtIsType || spec.exportKind === 'type';
        const local = moduleExportName(spec.local);
        const exported = moduleExportName(spec.exported);
        const meta: Record<string, unknown> = { isReExport: true, specifiers: [{ local, exported }] };
        if (specIsType) meta.isType = true;
        if (isExternal) meta.isExternal = true;
        if (resolved === null && !isExternal) meta.isUnresolved = true;

        relations.push({
          type: specIsType ? 'type-references' : 're-exports',
          srcFilePath: filePath,
          srcSymbolName: exported,
          dstFilePath: resolved,
          dstSymbolName: local,
          metaJson: JSON.stringify(meta),
          ...(resolved === null ? { specifier: sourcePath } : {}),
        });
      }
    }
  }
}

// ─── Dynamic imports & require() (always needs AST walking) ───────────────

function extractDynamicImports(
  ast: Program,
  filePath: string,
  tsconfigPaths: TsconfigPaths | undefined,
  resolveImportFn: ResolveImportFn,
  relations: CodeRelation[],
): void {
  const visitor = new Visitor({
    ImportExpression(node: ImportExpression) {
      const source = node.source;
      if (source.type !== 'Literal' || typeof source.value !== 'string') return;
      const sourceValue: string = source.value;

      const { resolved, isExternal } = resolveAndClassify(filePath, sourceValue, tsconfigPaths, resolveImportFn);
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
    },
    CallExpression(node: CallExpression) {
      const callee = node.callee;

      let isRequireResolve = false;

      if (callee.type === 'Identifier' && callee.name === 'require') {
        // require('...')
      } else if (callee.type === 'MemberExpression' && !callee.computed) {
        const memberCallee = callee as StaticMemberExpression;
        const obj = memberCallee.object;
        const prop = memberCallee.property;
        if (
          obj.type === 'Identifier' && obj.name === 'require' &&
          prop.name === 'resolve'
        ) {
          isRequireResolve = true;
        } else {
          return;
        }
      } else {
        return;
      }

      const args = node.arguments;
      if (args.length === 0) return;

      const firstArg = args[0]!;
      if (firstArg.type !== 'Literal' || typeof (firstArg as StringLiteral).value !== 'string') return;
      const sourceValue: string = (firstArg as StringLiteral).value;

      const { resolved, isExternal } = resolveAndClassify(filePath, sourceValue, tsconfigPaths, resolveImportFn);
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
    },
  });
  visitor.visit(ast);
}

// ─── Public API ───────────────────────────────────────────────────────────

export function extractImports(
  ast: Program,
  filePath: string,
  tsconfigPaths?: TsconfigPaths,
  resolveImportFn: ResolveImportFn = resolveImport,
  module?: EcmaScriptModule,
): CodeRelation[] {
  const relations: CodeRelation[] = [];

  if (module) {
    // Preferred path: use oxc-parser's pre-computed module metadata
    extractStaticImports(module, filePath, tsconfigPaths, resolveImportFn, relations);
    extractStaticExports(module, filePath, tsconfigPaths, resolveImportFn, relations);
  } else {
    // Fallback: manual AST walking (when module metadata is not available)
    extractStaticImportsFromAst(ast, filePath, tsconfigPaths, resolveImportFn, relations);
  }

  // Dynamic imports and require() always need AST walking
  extractDynamicImports(ast, filePath, tsconfigPaths, resolveImportFn, relations);

  return relations;
}
