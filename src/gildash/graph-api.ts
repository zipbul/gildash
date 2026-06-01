import { inboundRelPath } from '../common/path-utils';
import { guard } from './guard';
import { DependencyGraph } from '../search/dependency-graph';
import type { GildashContext } from './context';
import type { FanMetrics } from './types';

/** Graph cache TTL — matches healthcheck interval so readers stay fresh. */
export const GRAPH_CACHE_TTL_MS = 15_000;

/** Invalidate the cached DependencyGraph (called after every index run). */
export function invalidateGraphCache(ctx: GildashContext): void {
  ctx.graphCache = null;
  ctx.graphCacheKey = null;
  ctx.graphCacheBuiltAt = null;
}

/**
 * Return a cached or freshly-built DependencyGraph for the given project.
 * Builds once per key; subsequent calls with the same key return the cached instance.
 * TTL-based expiry ensures readers don't hold stale graphs indefinitely.
 */
export function getOrBuildGraph(ctx: GildashContext, project?: string): DependencyGraph {
  const key = project ?? '__cross__';

  // TTL-based invalidation for readers (who don't get onIndexed callbacks)
  if (ctx.graphCache && ctx.graphCacheBuiltAt !== null) {
    if (Date.now() - ctx.graphCacheBuiltAt > GRAPH_CACHE_TTL_MS) {
      ctx.graphCache = null;
      ctx.graphCacheKey = null;
      ctx.graphCacheBuiltAt = null;
    }
  }

  if (ctx.graphCache && ctx.graphCacheKey === key) {
    return ctx.graphCache;
  }
  const g = new DependencyGraph({
    relationRepo: ctx.relationRepo,
    project: project ?? ctx.defaultProject,
    additionalProjects: project ? undefined : ctx.boundaries?.map(b => b.project),
  });
  g.build();
  ctx.graphCache = g;
  ctx.graphCacheKey = key;
  ctx.graphCacheBuiltAt = Date.now();
  return g;
}

/** List the files that a given file directly imports. */
export function getDependencies(
  ctx: GildashContext,
  filePath: string,
  project?: string,
  limit = 10_000,
): string[] {
  return guard(ctx, 'search', 'getDependencies', () =>
    ctx.relationSearchFn({
      relationRepo: ctx.relationRepo, projectRoot: ctx.projectRoot,
      project: project ?? ctx.defaultProject,
      query: { srcFilePath: filePath, type: 'imports', project: project ?? ctx.defaultProject, limit },
    }).filter(r => r.dstFilePath !== null).map(r => r.dstFilePath!),
  );
}

/** List the files that directly import a given file. */
export function getDependents(
  ctx: GildashContext,
  filePath: string,
  project?: string,
  limit = 10_000,
): string[] {
  return guard(ctx, 'search', 'getDependents', () =>
    ctx.relationSearchFn({
      relationRepo: ctx.relationRepo, projectRoot: ctx.projectRoot,
      project: project ?? ctx.defaultProject,
      query: { dstFilePath: filePath, type: 'imports', project: project ?? ctx.defaultProject, limit },
    }).map(r => r.srcFilePath),
  );
}

/** Compute the full set of files transitively affected by changes. */
export async function getAffected(
  ctx: GildashContext,
  changedFiles: string[],
  project?: string,
): Promise<string[]> {
  return guard(ctx, 'search', 'getAffected', () => {
    const g = getOrBuildGraph(ctx, project);
    return g.getAffectedByChange(changedFiles.map(f => inboundRelPath(ctx.projectRoot, f)));
  });
}

/** Check whether the import graph contains a circular dependency. */
export async function hasCycle(
  ctx: GildashContext,
  project?: string,
): Promise<boolean> {
  return guard(ctx, 'search', 'hasCycle', () => {
    const g = getOrBuildGraph(ctx, project);
    return g.hasCycle();
  });
}

/** Return the full import graph as an adjacency list. */
export async function getImportGraph(
  ctx: GildashContext,
  project?: string,
): Promise<Map<string, string[]>> {
  return guard(ctx, 'search', 'getImportGraph', () => {
    const g = getOrBuildGraph(ctx, project);
    return g.getAdjacencyList();
  });
}

/** Return all files that `filePath` transitively imports (forward BFS). */
export async function getTransitiveDependencies(
  ctx: GildashContext,
  filePath: string,
  project?: string,
): Promise<string[]> {
  return guard(ctx, 'search', 'getTransitiveDependencies', () => {
    const g = getOrBuildGraph(ctx, project);
    return g.getTransitiveDependencies(inboundRelPath(ctx.projectRoot, filePath));
  });
}

/** Return all files that transitively depend on `filePath` (reverse BFS). */
export async function getTransitiveDependents(
  ctx: GildashContext,
  filePath: string,
  project?: string,
): Promise<string[]> {
  return guard(ctx, 'search', 'getTransitiveDependents', () => {
    const g = getOrBuildGraph(ctx, project);
    return g.getTransitiveDependents(inboundRelPath(ctx.projectRoot, filePath));
  });
}

/** Return all cycle paths in the import graph. */
export async function getCyclePaths(
  ctx: GildashContext,
  project?: string,
  options?: { maxCycles?: number },
): Promise<string[][]> {
  return guard(ctx, 'search', 'getCyclePaths', () => {
    const g = getOrBuildGraph(ctx, project);
    return g.getCyclePaths(options);
  });
}

/** Compute import-graph fan metrics (fan-in / fan-out) for a single file. */
export async function getFanMetrics(
  ctx: GildashContext,
  filePath: string,
  project?: string,
): Promise<FanMetrics> {
  return guard(ctx, 'search', 'getFanMetrics', () => {
    const g = getOrBuildGraph(ctx, project);
    const rel = inboundRelPath(ctx.projectRoot, filePath);
    return {
      filePath,
      fanIn: g.getDependents(rel).length,
      fanOut: g.getDependencies(rel).length,
    };
  });
}
