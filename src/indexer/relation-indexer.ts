import type { Program } from 'oxc-parser';
import { extractRelations } from '../extractor/relation-extractor';
import { toAbsolutePath, toRelativePath } from '../common/path-utils';
import type { TsconfigPaths } from '../common/tsconfig-resolver';

export interface RelationDbRow {
  project: string;
  type: string;
  srcFilePath: string;
  srcSymbolName: string | null;
  dstFilePath: string;
  dstSymbolName: string | null;
  metaJson: string | null;
}

interface RelationRepoPart {
  replaceFileRelations(
    project: string,
    filePath: string,
    relations: RelationDbRow[],
  ): void;
}

export interface IndexFileRelationsOptions {
  ast: Program;
  project: string;
  filePath: string;
  relationRepo: RelationRepoPart;
  projectRoot: string;
  tsconfigPaths?: TsconfigPaths;
}

export function indexFileRelations(opts: IndexFileRelationsOptions): number {
  const { ast, project, filePath, relationRepo, projectRoot, tsconfigPaths } = opts;

  const absFilePath = toAbsolutePath(projectRoot, filePath);
  const rawRelations = extractRelations(ast, absFilePath, tsconfigPaths);

  const rows: RelationDbRow[] = [];

  for (const rel of rawRelations) {
    const relDst = toRelativePath(projectRoot, rel.dstFilePath);

    if (relDst.startsWith('..')) continue;

    const relSrc = toRelativePath(projectRoot, rel.srcFilePath);

    rows.push({
      project,
      type: rel.type,
      srcFilePath: relSrc,
      srcSymbolName: rel.srcSymbolName ?? null,
      dstFilePath: relDst,
      dstSymbolName: rel.dstSymbolName ?? null,
      metaJson: rel.metaJson ?? null,
    });
  }

  relationRepo.replaceFileRelations(project, filePath, rows);
  return rows.length;
}
