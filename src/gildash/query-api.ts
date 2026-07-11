import path from 'node:path';
import { inboundRelPath } from '../common/path-utils';
import type { SymbolSearchQuery, SymbolSearchResult } from '../search/symbol-search';
import type { RelationSearchQuery, StoredCodeRelation } from '../search/relation-search';
import type { FileRecord } from '../store/repositories/file.repository';
import type { SymbolStats } from '../store/repositories/symbol.repository';
import { GildashError } from '../errors';
import { guard } from './guard';
import type { GildashContext } from './context';
import type { FullSymbol, FileStats, ModuleInterface } from './types';

/** Return aggregate symbol statistics for the given project. */
export function getStats(
  ctx: GildashContext,
  project?: string,
): SymbolStats {
  return guard(ctx, 'store', 'getStats', () =>
    ctx.symbolRepo.getStats(project ?? ctx.defaultProject),
  );
}

/** Search indexed symbols by name, kind, file path, or export status. */
export function searchSymbols(
  ctx: GildashContext,
  query: SymbolSearchQuery,
): SymbolSearchResult[] {
  return guard(ctx, 'search', 'searchSymbols', () =>
    ctx.symbolSearchFn({ symbolRepo: ctx.symbolRepo, projectRoot: ctx.projectRoot, project: ctx.defaultProject, query }),
  );
}

/** Search indexed code relationships (imports, calls, extends, implements). */
export function searchRelations(
  ctx: GildashContext,
  query: RelationSearchQuery,
): StoredCodeRelation[] {
  return guard(ctx, 'search', 'searchRelations', () =>
    ctx.relationSearchFn({ relationRepo: ctx.relationRepo, projectRoot: ctx.projectRoot, project: ctx.defaultProject, query }),
  );
}

/** Search symbols across all projects (no project filter). */
export function searchAllSymbols(
  ctx: GildashContext,
  query: Omit<SymbolSearchQuery, 'project'> & { project?: string },
): SymbolSearchResult[] {
  return guard(ctx, 'search', 'searchAllSymbols', () =>
    ctx.symbolSearchFn({ symbolRepo: ctx.symbolRepo, projectRoot: ctx.projectRoot, project: undefined, query }),
  );
}

/** Search relations across all projects (no project filter). */
export function searchAllRelations(
  ctx: GildashContext,
  query: RelationSearchQuery,
): StoredCodeRelation[] {
  return guard(ctx, 'search', 'searchAllRelations', () =>
    ctx.relationSearchFn({ relationRepo: ctx.relationRepo, projectRoot: ctx.projectRoot, project: undefined, query }),
  );
}

/** List all files indexed for a given project. */
export function listIndexedFiles(
  ctx: GildashContext,
  project?: string,
): FileRecord[] {
  return guard(ctx, 'store', 'listIndexedFiles', () =>
    ctx.fileRepo.getAllFiles(project ?? ctx.defaultProject),
  );
}

/** Get all intra-file relations for a given file. */
export function getInternalRelations(
  ctx: GildashContext,
  filePath: string,
  project?: string,
): StoredCodeRelation[] {
  return guard(ctx, 'search', 'getInternalRelations', () =>
    ctx.relationSearchFn({
      relationRepo: ctx.relationRepo, projectRoot: ctx.projectRoot,
      project: project ?? ctx.defaultProject,
      query: { srcFilePath: filePath, dstFilePath: filePath, limit: 10_000 },
    }),
  );
}

/** Retrieve full details for a named symbol in a specific file. */
export function getFullSymbol(
  ctx: GildashContext,
  symbolName: string,
  filePath: string,
  project?: string,
): FullSymbol | null {
  return guard(ctx, 'search', 'getFullSymbol', () => {
    const effectiveProject = project ?? ctx.defaultProject;
    const results = ctx.symbolSearchFn({
      symbolRepo: ctx.symbolRepo, projectRoot: ctx.projectRoot,
      project: effectiveProject,
      query: { text: symbolName, exact: true, filePath, limit: 1 },
    });
    if (results.length === 0) {
      return null;
    }
    const sym = results[0]!;
    const d = sym.detail;
    const full: FullSymbol = {
      ...sym,
      members: d.members,
      jsDoc: d.jsDoc,
      parameters: d.parameters,
      returnType: d.returnType,
      heritage: d.heritage,
      decorators: d.decorators,
      typeParameters: d.typeParameters,
      initializer: d.initializer,
      isDefault: d.isDefault,
    };
    if (ctx.semanticLayer) {
      try {
        const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.projectRoot, filePath);
        const declPos = ctx.semanticLayer.lineColumnToPosition(
          absPath, sym.span.start.line, sym.span.start.column,
        );
        if (declPos !== null) {
          const pos = ctx.semanticLayer.findNamePosition(absPath, declPos, sym.name) ?? declPos;
          const resolvedType = ctx.semanticLayer.collectTypeAt(absPath, pos);
          if (resolvedType) {
            full.resolvedType = resolvedType;
          }
        }
      } catch {
        // semantic enrichment is best-effort — don't fail the whole call
      }
    }
    return full;
  });
}

/** Retrieve statistics for an indexed file. */
export function getFileStats(
  ctx: GildashContext,
  filePath: string,
  project?: string,
): FileStats {
  return guard(ctx, 'store', 'getFileStats', () => {
    const effectiveProject = project ?? ctx.defaultProject;
    const rel = inboundRelPath(ctx.projectRoot, filePath);
    const fileRecord = ctx.fileRepo.getFile(effectiveProject, rel);
    if (!fileRecord) {
      throw new GildashError('search', `Gildash: file '${filePath}' is not in the index`);
    }
    const symbols = ctx.symbolRepo.getFileSymbols(effectiveProject, rel);
    const relations = ctx.relationRepo.getOutgoing(effectiveProject, rel);
    return {
      filePath: fileRecord.filePath,
      lineCount: fileRecord.lineCount ?? 0,
      size: fileRecord.size,
      symbolCount: symbols.length,
      exportedSymbolCount: symbols.filter((s) => s.isExported).length,
      relationCount: relations.length,
    };
  });
}

/** Retrieve metadata for an indexed file. */
export function getFileInfo(
  ctx: GildashContext,
  filePath: string,
  project?: string,
): FileRecord | null {
  return guard(ctx, 'store', 'getFileInfo', () =>
    ctx.fileRepo.getFile(project ?? ctx.defaultProject, inboundRelPath(ctx.projectRoot, filePath)),
  );
}

/** List all symbols declared in a specific file. */
export function getSymbolsByFile(
  ctx: GildashContext,
  filePath: string,
  project?: string,
): SymbolSearchResult[] {
  return searchSymbols(ctx, { filePath, project: project ?? undefined, limit: 10_000 });
}

/** Return the public interface of a module. */
export function getModuleInterface(
  ctx: GildashContext,
  filePath: string,
  project?: string,
): ModuleInterface {
  return guard(ctx, 'search', 'getModuleInterface', () => {
    const symbols = ctx.symbolSearchFn({
      symbolRepo: ctx.symbolRepo, projectRoot: ctx.projectRoot,
      project: project ?? ctx.defaultProject,
      query: { filePath, isExported: true },
    });
    const exports = symbols.map((s) => ({
      name: s.name,
      kind: s.kind,
      parameters: s.detail.parameters
        ? `(${s.detail.parameters.map(p => `${p.name}${p.isOptional ? '?' : ''}: ${p.type ?? 'unknown'}`).join(', ')})`
        : undefined,
      returnType: s.detail.returnType ?? undefined,
      jsDoc: s.detail.jsDoc?.description ?? undefined,
      isDefault: s.detail.isDefault || undefined,
    }));
    return { filePath, exports };
  });
}
