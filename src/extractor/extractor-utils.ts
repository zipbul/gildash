import { resolve, dirname, extname } from 'node:path';
import type { Program } from 'oxc-parser';
import type { TsconfigPaths } from '../common/tsconfig-resolver';
import type { ImportReference } from './types';

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
        resolved + '.d.ts',
        resolved + '/index.ts',
        resolved + '/index.d.ts',
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

  if (importPath.startsWith('.')) {
    const resolved = resolve(dirname(currentFilePath), importPath);
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

  return [];
}

/**
 * Resolve a bare specifier (e.g. 'lodash', '@scope/pkg') to node_modules candidates.
 * Returns candidate .d.ts / .ts paths. Does NOT check file existence (pure, sync).
 */
export function resolveBareSpecifier(
  projectRoot: string,
  importPath: string,
): string[] {
  // bare specifier 판별: 상대경로(.)도 절대경로(/)도 아닌 것
  if (importPath.startsWith('.') || importPath.startsWith('/')) return [];

  const nmDir = resolve(projectRoot, 'node_modules');
  const candidates: string[] = [];

  // 1. 직접 패키지 경로
  const pkgDir = resolve(nmDir, importPath);
  candidates.push(
    resolve(pkgDir, 'index.d.ts'),
    resolve(pkgDir, 'index.ts'),
    resolve(pkgDir, 'index.d.mts'),
  );

  // 2. 서브패스: @scope/pkg/sub → node_modules/@scope/pkg/sub
  if (importPath.includes('/')) {
    const subPath = resolve(nmDir, importPath);
    candidates.push(
      subPath + '.d.ts',
      subPath + '.ts',
      subPath + '/index.d.ts',
      subPath + '/index.ts',
    );
  }

  // 3. @types 패키지 (scoped 패키지: @scope/pkg → @types/scope__pkg)
  const typesName = importPath.startsWith('@')
    ? importPath.replace('@', '').replace('/', '__')
    : importPath;
  candidates.push(resolve(nmDir, '@types', typesName, 'index.d.ts'));

  return candidates;
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
