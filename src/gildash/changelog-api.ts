import type { GildashContext } from './context';
import type { SymbolChange, SymbolChangeQueryOptions } from './types';
import { assertOpen } from './guard';

export function getSymbolChanges(
  ctx: GildashContext,
  since: Date | string,
  options?: SymbolChangeQueryOptions,
): SymbolChange[] {
  assertOpen(ctx);
  if (!ctx.changelogRepo) return [];

  const sinceStr = since instanceof Date ? since.toISOString() : since;
  const project = options?.project ?? ctx.defaultProject;
  const limit = options?.limit ?? 1000;

  const records = ctx.changelogRepo.getSince({
    project,
    since: sinceStr,
    symbolName: options?.symbolName,
    changeTypes: options?.changeTypes,
    filePath: options?.filePath,
    includeFullIndex: options?.includeFullIndex,
    indexRunId: options?.indexRunId,
    afterId: options?.afterId,
    limit,
  });

  return records.map((r) => ({
    // The change_type column only ever holds a valid SymbolChangeType (written
    // exclusively as the literals 'added'|'modified'|'removed'|'renamed'|'moved'
    // in index-coordinator). A schema-level enum would require relocating
    // SymbolChangeType out of the facade layer, so we assert at this boundary.
    changeType: r.changeType as SymbolChange['changeType'],
    symbolName: r.symbolName,
    symbolKind: r.symbolKind,
    filePath: r.filePath,
    oldName: r.oldName,
    oldFilePath: r.oldFilePath,
    fingerprint: r.fingerprint,
    changedAt: r.changedAt,
    isFullIndex: r.isFullIndex === 1,
    indexRunId: r.indexRunId,
  }));
}

export function pruneChangelog(
  ctx: GildashContext,
  before: Date | string,
): number {
  assertOpen(ctx);
  if (!ctx.changelogRepo) return 0;

  const beforeStr = before instanceof Date ? before.toISOString() : before;
  let total = 0;
  const projects = [ctx.defaultProject, ...ctx.boundaries.map(b => b.project)];
  const unique = [...new Set(projects)];
  for (const project of unique) {
    total += ctx.changelogRepo.pruneOlderThan(project, beforeStr);
  }
  return total;
}
