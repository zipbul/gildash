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
    if (extension === '.js') return [resolved.slice(0, -3) + '.ts'];
    if (extension === '.mjs') return [resolved.slice(0, -4) + '.mts'];
    if (extension === '.cjs') return [resolved.slice(0, -4) + '.cts'];
    if (extension === '.ts' || extension === '.mts' || extension === '.cts'
      || extension === '.d.ts') return [resolved];
    // No extension or non-JS/TS extension (e.g. '.usecase', '.controller')
    // → treat as extensionless and generate TS candidates
    return [
      resolved + '.ts',
      resolved + '.d.ts',
      resolved + '/index.ts',
      resolved + '/index.d.ts',
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
  // oxc-parser's Program type doesn't expose `.body` — cast through unknown as a type bridge
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
