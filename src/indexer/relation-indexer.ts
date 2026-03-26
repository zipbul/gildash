import type { Program } from 'oxc-parser';
import { extractRelations } from '../extractor/relation-extractor';
import { toAbsolutePath, toRelativePath } from '../common/path-utils';
import { resolveImport } from '../extractor/extractor-utils';
import { resolveFileProject } from '../common/project-discovery';
import type { ProjectBoundary } from '../common/project-discovery';
import type { TsconfigPaths } from '../common/tsconfig-resolver';

export interface RelationDbRow {
  project: string;
  type: string;
  srcFilePath: string;
  srcSymbolName: string | null;
  dstProject: string | null;
  dstFilePath: string | null;
  dstSymbolName: string | null;
  metaJson: string | null;
  specifier: string | null;
  isExternal: number;
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
  /** 인덱싱된 파일 경로 Set. `${project}::${filePath}` 형식. */
  knownFiles?: Set<string>;
  /** 프로젝트 경계 목록 (dstProject 결정용) */
  boundaries?: ProjectBoundary[];
  /** Pre-extracted module metadata for re-export pattern B/C detection. */
  module?: import('oxc-parser').EcmaScriptModule;
}

export function indexFileRelations(opts: IndexFileRelationsOptions): number {
  const { ast, project, filePath, relationRepo, projectRoot, tsconfigPaths, knownFiles, boundaries, module: moduleData } = opts;

  const absFilePath = toAbsolutePath(projectRoot, filePath);

  // knownFiles가 주어지면, 후보 중 knownFiles에 있는 경로를 선택하는 커스텀 resolver 조립
  const customResolver = knownFiles
    ? (currentFile: string, importPath: string, paths?: TsconfigPaths) => {
        // 기본 해석 (상대경로 + tsconfig paths)
        const candidates = resolveImport(currentFile, importPath, paths);

        // 후보 중 knownFiles에 있는 첫 번째 선택
        for (const c of candidates) {
          const rel = toRelativePath(projectRoot, c);
          // 모든 project에서 검색
          if (boundaries) {
            const p = resolveFileProject(rel, boundaries);
            if (knownFiles.has(`${p}::${rel}`)) return [c];
          } else {
            if (knownFiles.has(`${project}::${rel}`)) return [c];
          }
        }
        return []; // knownFiles에 없으면 빈 배열 → unresolved/external로 처리됨
      }
    : undefined;

  const rawRelations = extractRelations(ast, absFilePath, tsconfigPaths, customResolver, moduleData);

  const rows: RelationDbRow[] = [];

  for (const rel of rawRelations) {
    // External/unresolved imports have null dstFilePath
    if (rel.dstFilePath === null) {
      const relSrc = toRelativePath(projectRoot, rel.srcFilePath);
      let meta: Record<string, unknown> | undefined;
      if (rel.metaJson) {
        try { meta = JSON.parse(rel.metaJson) as Record<string, unknown>; } catch { /* ignore */ }
      }
      const isExternal = meta?.isExternal === true;

      rows.push({
        project,
        type: rel.type,
        srcFilePath: relSrc,
        srcSymbolName: rel.srcSymbolName ?? null,
        dstProject: null,
        dstFilePath: null,
        dstSymbolName: rel.dstSymbolName ?? null,
        metaJson: rel.metaJson ?? null,
        specifier: rel.specifier ?? null,
        isExternal: isExternal ? 1 : 0,
      });
      continue;
    }

    const relDst = toRelativePath(projectRoot, rel.dstFilePath);

    if (relDst.startsWith('..')) continue;

    const relSrc = toRelativePath(projectRoot, rel.srcFilePath);

    // dstProject 결정: boundaries가 있으면 dstFilePath 기준으로 project 해석
    const dstProject = boundaries
      ? resolveFileProject(relDst, boundaries)
      : project;

    rows.push({
      project,
      type: rel.type,
      srcFilePath: relSrc,
      srcSymbolName: rel.srcSymbolName ?? null,
      dstProject,
      dstFilePath: relDst,
      dstSymbolName: rel.dstSymbolName ?? null,
      metaJson: rel.metaJson ?? null,
      specifier: rel.specifier ?? null,
      isExternal: 0,
    });
  }

  relationRepo.replaceFileRelations(project, filePath, rows);
  return rows.length;
}
