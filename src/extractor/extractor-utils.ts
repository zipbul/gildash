import { resolve, dirname, extname } from 'node:path';
import type { Program } from 'oxc-parser';
import type { TsconfigPaths } from '../common/tsconfig-resolver';
import type { ImportReference } from './types';

/**
 * Resolves an import path to an absolute file path.
 * Handles relative imports and tsconfig path aliases.
 * Pure string resolution — no file system access.
 *
 * @param currentFilePath - Absolute path of the file containing the import.
 * @param importPath      - The raw import specifier string (e.g., './foo', '@alias/bar').
 * @param tsconfigPaths   - Optional tsconfig paths for alias resolution.
 * @returns Absolute resolved path, or null for external (npm) packages.
 */
export function resolveImport(
  currentFilePath: string,
  importPath: string,
  tsconfigPaths?: TsconfigPaths,
): string[] {
  const withTypeScriptCandidates = (resolved: string): string[] => {
    const extension = extname(resolved);
    if (extension === '') {
      return [
        resolved + '.ts',
        resolved + '/index.ts',
        resolved + '.mts',
        resolved + '/index.mts',
        resolved + '.cts',
        resolved + '/index.cts',
      ];
    }
    if (extension === '.js') return [resolved.slice(0, -3) + '.ts'];
    if (extension === '.mjs') return [resolved.slice(0, -4) + '.mts'];
    if (extension === '.cjs') return [resolved.slice(0, -4) + '.cts'];
    return [resolved];
  };

  // 1. Relative imports
  if (importPath.startsWith('.')) {
    const resolved = resolve(dirname(currentFilePath), importPath);
    return withTypeScriptCandidates(resolved);
  }

  // 2. tsconfig path aliases
  if (tsconfigPaths) {
    for (const [pattern, targets] of tsconfigPaths.paths) {
      if (targets.length === 0) continue;

      const starIdx = pattern.indexOf('*');

      if (starIdx === -1) {
        // Exact match
        if (importPath === pattern) {
          const candidates: string[] = [];
          for (const t of targets) {
            candidates.push(...withTypeScriptCandidates(resolve(tsconfigPaths.baseUrl, t)));
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
            candidates.push(...withTypeScriptCandidates(resolve(tsconfigPaths.baseUrl, t.replace('*', captured))));
          }
          return candidates;
        }
      }
    }
  }

  // 3. External package
  return [];
}

/**
 * Builds a map from local identifier names to their resolved import references.
 * Only walks top-level ast.body (no deep traversal).
 *
 * @param ast             - The parsed Program AST.
 * @param currentFilePath - Absolute path of the current file.
 * @param tsconfigPaths   - Optional tsconfig paths for alias resolution.
 * @returns Map from local name to ImportReference.
 */
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
  const body = (ast as unknown as { body?: Array<Record<string, unknown>> }).body ?? [];

  for (const node of body) {
    if (node.type !== 'ImportDeclaration') continue;

    const sourcePath: string = ((node.source as { value?: string } | undefined)?.value) ?? '';
    const candidates = resolveImportFn(currentFilePath, sourcePath, tsconfigPaths);
    if (candidates.length === 0) continue;
    const resolved = candidates[0];

    const specifiers = (node.specifiers as Array<Record<string, unknown>> | undefined) ?? [];
    for (const spec of specifiers) {
      switch (spec.type) {
        case 'ImportSpecifier':
          map.set((spec.local as { name: string }).name, {
            path: resolved!,
            importedName: (spec.imported as { name: string }).name,
          });
          break;
        case 'ImportDefaultSpecifier':
          map.set((spec.local as { name: string }).name, {
            path: resolved!,
            importedName: 'default',
          });
          break;
        case 'ImportNamespaceSpecifier':
          map.set((spec.local as { name: string }).name, {
            path: resolved!,
            importedName: '*',
          });
          break;
      }
    }
  }

  return map;
}
