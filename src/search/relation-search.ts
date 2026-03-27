import type { CodeRelation } from '../extractor/types';
import { GildashError } from '../errors';
import type { RelationRecord } from '../store/repositories/relation.repository';

/**
 * A {@link CodeRelation} enriched with the destination project identifier
 * as stored in the relation index.
 */
export interface StoredCodeRelation extends Omit<CodeRelation, 'specifier'> {
  dstProject: string | null;
  /** Whether this relation targets an external (bare specifier) package. */
  isExternal: boolean;
  /** The raw import specifier string (e.g. `'lodash'`, `'./missing'`). `null` when the import was resolved to a file. */
  specifier: string | null;
}

/**
 * Filters for {@link relationSearch}.
 *
 * All fields are optional. Omitted fields impose no constraint.
 */
export interface RelationSearchQuery {
  /** Source file path. */
  srcFilePath?: string;
  /** Source symbol name. */
  srcSymbolName?: string;
  /** Destination file path. */
  dstFilePath?: string;
  /** Destination symbol name. */
  dstSymbolName?: string;
  /** Destination project. */
  dstProject?: string;
  /** Glob pattern for source file path filtering (app-level, via Bun.Glob). Mutually exclusive with srcFilePath. */
  srcFilePathPattern?: string;
  /** Glob pattern for destination file path filtering (app-level, via Bun.Glob). Mutually exclusive with dstFilePath. */
  dstFilePathPattern?: string;
  /** Relationship type: `'imports'`, `'calls'`, `'extends'`, or `'implements'`. */
  type?: CodeRelation['type'];
  /** Limit results to this project. */
  project?: string;
  /** Maximum number of results. When omitted, no limit is applied. */
  limit?: number;
  /** Filter by raw import specifier. */
  specifier?: string;
  /** Filter by external package flag. */
  isExternal?: boolean;
}

export interface IRelationRepo {
  searchRelations(opts: {
    srcFilePath?: string;
    srcSymbolName?: string;
    dstFilePath?: string;
    dstSymbolName?: string;
    dstProject?: string;
    type?: string;
    project?: string;
    specifier?: string;
    isExternal?: boolean;
    limit?: number;
  }): RelationRecord[];
}

/**
 * Search the relation index using the given query filters.
 *
 * @param options - Relation repository, default project, and search query.
 * @returns An array of {@link CodeRelation} entries matching the query.
 */
export function relationSearch(options: {
  relationRepo: IRelationRepo;
  project?: string;
  query: RelationSearchQuery;
}): StoredCodeRelation[] {
  const { relationRepo, project, query } = options;

  if (query.srcFilePath && query.srcFilePathPattern) {
    throw new GildashError('validation', 'srcFilePath and srcFilePathPattern are mutually exclusive');
  }
  if (query.dstFilePath && query.dstFilePathPattern) {
    throw new GildashError('validation', 'dstFilePath and dstFilePathPattern are mutually exclusive');
  }

  const effectiveProject = query.project ?? project;
  const limit = query.limit;

  const usePatternFilter = !!(query.srcFilePathPattern || query.dstFilePathPattern);
  const dbLimit = usePatternFilter ? undefined : limit;

  const records = relationRepo.searchRelations({
    srcFilePath: query.srcFilePath,
    srcSymbolName: query.srcSymbolName,
    dstFilePath: query.dstFilePath,
    dstSymbolName: query.dstSymbolName,
    dstProject: query.dstProject,
    type: query.type,
    project: effectiveProject,
    specifier: query.specifier,
    isExternal: query.isExternal,
    limit: dbLimit,
  });

  let results = records.map(r => {
    let meta: Record<string, unknown> | undefined;
    if (r.metaJson) {
      try {
        meta = JSON.parse(r.metaJson) as Record<string, unknown>;
      } catch {
        // malformed JSON → meta stays undefined
      }
    }
    return {
      type: r.type as CodeRelation['type'],
      srcFilePath: r.srcFilePath,
      srcSymbolName: r.srcSymbolName,
      dstFilePath: r.dstFilePath,
      dstSymbolName: r.dstSymbolName,
      dstProject: r.dstProject,
      isExternal: r.isExternal === 1,
      specifier: r.specifier,
      metaJson: r.metaJson ?? undefined,
      meta,
    };
  });

  if (query.srcFilePathPattern || query.dstFilePathPattern) {
    const srcGlob = query.srcFilePathPattern ? new Bun.Glob(query.srcFilePathPattern) : null;
    const dstGlob = query.dstFilePathPattern ? new Bun.Glob(query.dstFilePathPattern) : null;
    results = results.filter(r =>
      (!srcGlob || srcGlob.match(r.srcFilePath)) &&
      (!dstGlob || r.dstFilePath === null || dstGlob.match(r.dstFilePath))
    );
  }

  // Apply consumer limit at app level when pattern was used
  if (usePatternFilter && limit !== undefined && results.length > limit) {
    results = results.slice(0, limit);
  }

  return results;
}
