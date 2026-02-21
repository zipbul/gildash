import type { SymbolKind } from '../extractor/types';
import type { SymbolRecord } from '../store/repositories/symbol.repository';
import { toFtsPrefixQuery } from '../store/repositories/fts-utils';

export interface SymbolSearchQuery {
  text?: string;
  kind?: SymbolKind;
  filePath?: string;
  isExported?: boolean;
  project?: string;
  limit?: number;
}

export interface SymbolSearchResult {
  id: number;
  filePath: string;
  kind: SymbolKind;
  name: string;
  span: { start: { line: number; column: number }; end: { line: number; column: number } };
  isExported: boolean;
  signature: string | null;
  fingerprint: string | null;
  detail: Record<string, unknown>;
}

export interface ISymbolRepo {
  searchByQuery(opts: {
    ftsQuery?: string;
    kind?: string;
    filePath?: string;
    isExported?: boolean;
    project?: string;
    limit: number;
  }): (SymbolRecord & { id: number })[];
}

export function symbolSearch(options: {
  symbolRepo: ISymbolRepo;
  project?: string;
  query: SymbolSearchQuery;
}): SymbolSearchResult[] {
  const { symbolRepo, project, query } = options;
  const effectiveProject = query.project ?? project;
  const limit = query.limit ?? 100;

  const opts: Parameters<ISymbolRepo['searchByQuery']>[0] = {
    kind: query.kind,
    filePath: query.filePath,
    isExported: query.isExported,
    project: effectiveProject,
    limit,
  };

  if (query.text) {
    const ftsQuery = toFtsPrefixQuery(query.text);
    if (ftsQuery) opts.ftsQuery = ftsQuery;
  }

  const records = symbolRepo.searchByQuery(opts);

  return records.map(r => ({
    id: r.id,
    filePath: r.filePath,
    kind: r.kind as SymbolKind,
    name: r.name,
    span: {
      start: { line: r.startLine, column: r.startColumn },
      end: { line: r.endLine, column: r.endColumn },
    },
    isExported: r.isExported === 1,
    signature: r.signature,
    fingerprint: r.fingerprint,
    detail: r.detailJson ? (() => {
      try { return JSON.parse(r.detailJson!) as Record<string, unknown>; }
      catch { return {}; }
    })() : {},
  }));
}
