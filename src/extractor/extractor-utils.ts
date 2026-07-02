import { resolve, dirname, extname } from 'node:path';
import type { Program } from 'oxc-parser';
import type { TsconfigPaths } from '../common/tsconfig-resolver';
import { normalizePath } from '../common/path-utils';
import type { ImportReference } from './types';

export function resolveImport(
  currentFilePath: string,
  importPath: string,
  tsconfigPaths?: TsconfigPaths,
): string[] {
  const withTypeScriptCandidates = (resolved: string): string[] => {
    const extension = extname(resolved);
    // TS resolution order (tryAddingExtensions, TS 5.8): a .js/.jsx specifier
    // maps to its TS siblings first, with the .d.ts declaration fallback.
    if (extension === '.js') {
      const base = resolved.slice(0, -3);
      return [base + '.ts', base + '.tsx', base + '.d.ts'];
    }
    if (extension === '.jsx') {
      const base = resolved.slice(0, -4);
      return [base + '.tsx', base + '.ts', base + '.d.ts', resolved];
    }
    if (extension === '.mjs') return [resolved.slice(0, -4) + '.mts'];
    if (extension === '.cjs') return [resolved.slice(0, -4) + '.cts'];
    if (extension === '.ts' || extension === '.tsx' || extension === '.mts'
      || extension === '.cts' || extension === '.d.ts') return [resolved];
    // No extension or non-JS/TS extension (e.g. '.usecase', '.controller')
    // → treat as extensionless and generate candidates in TS-style order:
    // .ts before .tsx before .d.ts, and files before directory /index.*
    // (tsc probes files first). `.jsx` is opt-in via `extensions` but its
    // candidates are always generated — they only match indexed files.
    return [
      resolved + '.ts',
      resolved + '.tsx',
      resolved + '.d.ts',
      resolved + '.jsx',
      resolved + '/index.ts',
      resolved + '/index.tsx',
      resolved + '/index.d.ts',
      resolved + '/index.jsx',
      resolved + '.mts',
      resolved + '/index.mts',
      resolved + '.cts',
      resolved + '/index.cts',
    ];
  };

  if (importPath.startsWith('.')) {
    const resolved = normalizePath(resolve(dirname(currentFilePath), importPath));
    return withTypeScriptCandidates(resolved);
  }

  if (tsconfigPaths) {
    for (const [pattern, targets] of tsconfigPaths.paths) {
      if (targets.length === 0) continue;

      const starIdx = pattern.indexOf('*');

      if (starIdx === -1) {
        if (importPath === pattern) {
          const candidates: string[] = [];
          for (const t of targets) {
            candidates.push(...withTypeScriptCandidates(normalizePath(resolve(tsconfigPaths.baseUrl, t))));
          }
          return candidates;
        }
      } else {
        const prefix = pattern.slice(0, starIdx);
        const suffix = pattern.slice(starIdx + 1);
        if (
          importPath.startsWith(prefix) &&
          (suffix === '' || importPath.endsWith(suffix))
        ) {
          const captured = importPath.slice(
            prefix.length,
            suffix === '' ? undefined : importPath.length - suffix.length,
          );
          const candidates: string[] = [];
          for (const t of targets) {
            candidates.push(...withTypeScriptCandidates(normalizePath(resolve(tsconfigPaths.baseUrl, t.replace('*', captured)))));
          }
          return candidates;
        }
      }
    }
  }

  return [];
}

export function buildImportMap(
  ast: Program,
  currentFilePath: string,
  tsconfigPaths?: TsconfigPaths,
  resolveImportFn: (
    currentFilePath: string,
    importPath: string,
    tsconfigPaths?: TsconfigPaths,
  ) => string[] = resolveImport,
): Map<string, ImportReference> {
  const map = new Map<string, ImportReference>();

  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration') continue;

    const sourcePath: string = node.source.value;
    const candidates = resolveImportFn(currentFilePath, sourcePath, tsconfigPaths);
    if (candidates.length === 0) continue;
    const resolved = candidates[0];

    for (const spec of node.specifiers) {
      switch (spec.type) {
        case 'ImportSpecifier':
          map.set(spec.local.name, {
            path: resolved!,
            importedName: 'name' in spec.imported ? spec.imported.name : spec.imported.value,
          });
          break;
        case 'ImportDefaultSpecifier':
          map.set(spec.local.name, {
            path: resolved!,
            importedName: 'default',
          });
          break;
        case 'ImportNamespaceSpecifier':
          map.set(spec.local.name, {
            path: resolved!,
            importedName: '*',
          });
          break;
      }
    }
  }

  return map;
}
