import { beforeEach, describe, expect, it, mock } from 'bun:test';

const mockExtractRelations = mock((ast: any, filePath: string, tsconfig?: any) => [] as any[]);

const mockToRelativePath = mock((root: string, abs: string) => '');
const mockToAbsolutePath = mock((root: string, rel: string) => '');
mock.module('../extractor/relation-extractor', () => ({ extractRelations: mockExtractRelations }));
mock.module('../common/path-utils', () => ({
  toRelativePath: mockToRelativePath,
  toAbsolutePath: mockToAbsolutePath,
}));
import { indexFileRelations } from './relation-indexer';

const PROJECT = 'test-project';
const PROJECT_ROOT = '/project';
const REL_FILE = 'src/index.ts';
const ABS_FILE = '/project/src/index.ts';

function makeRelation(overrides: Partial<{
  type: string; srcFilePath: string; srcSymbolName: string | null;
  dstFilePath: string; dstSymbolName: string | null; metaJson: string | null;
}> = {}) {
  return {
    type: 'imports',
    srcFilePath: ABS_FILE,
    srcSymbolName: null,
    dstFilePath: '/project/src/utils.ts',
    dstSymbolName: null,
    metaJson: null,
    ...overrides,
  };
}

function makeRelationRepo() {
  return { replaceFileRelations: mock((p: any, f: any, rels: any) => {}) };
}

describe('indexFileRelations', () => {
  beforeEach(() => {
    mock.module('../extractor/relation-extractor', () => ({ extractRelations: mockExtractRelations }));
    mock.module('../common/path-utils', () => ({
      toRelativePath: mockToRelativePath,
      toAbsolutePath: mockToAbsolutePath,
    }));
    mockExtractRelations.mockReset();
    mockExtractRelations.mockReturnValue([]);
    mockToRelativePath.mockReset();
    mockToAbsolutePath.mockReset();
    mockToAbsolutePath.mockImplementation((root: string, rel: string) => `/project/${rel}`);
    mockToRelativePath.mockImplementation((root: string, abs: string) =>
      abs.replace('/project/', ''),
    );
  });
  it('should include relation when dst is within project root', () => {
    mockExtractRelations.mockReturnValue([makeRelation()]);
    mockToRelativePath.mockReturnValue('src/utils.ts');
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT });

    const [, , rels] = relationRepo.replaceFileRelations.mock.calls[0]!;
    expect(rels.length).toBe(1);
  });

  it('should filter out relation when dst normalizes to path starting with ..', () => {
    mockExtractRelations.mockReturnValue([makeRelation({ dstFilePath: '/other/project/file.ts' })]);
    mockToRelativePath.mockImplementation((root: string, abs: string) =>
      abs.startsWith('/project') ? abs.replace('/project/', '') : `../other/project/${abs.split('/').pop()}`,
    );
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT });

    const [, , rels] = relationRepo.replaceFileRelations.mock.calls[0]!;
    expect(rels).toEqual([]);
  });

  it('should call extractRelations when absolute filePath is provided', () => {
    mockToAbsolutePath.mockReturnValue(ABS_FILE);
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT });

    expect(mockExtractRelations).toHaveBeenCalledWith(expect.anything(), ABS_FILE, undefined);
  });

  it('should call replaceFileRelations when relative filePath is computed', () => {
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT });

    const [, filePath] = relationRepo.replaceFileRelations.mock.calls[0]!;
    expect(filePath).toBe(REL_FILE);
  });

  it('should normalize absolute dst paths when writing output relations', () => {
    mockExtractRelations.mockReturnValue([makeRelation({ dstFilePath: '/project/src/utils.ts' })]);
    mockToRelativePath.mockReturnValue('src/utils.ts');
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT });

    const [, , rels] = relationRepo.replaceFileRelations.mock.calls[0]!;
    expect(rels[0].dstFilePath).toBe('src/utils.ts');
  });

  it('should call replaceFileRelations with empty array when extractRelations returns nothing', () => {
    mockExtractRelations.mockReturnValue([]);
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT });

    const [, , rels] = relationRepo.replaceFileRelations.mock.calls[0]!;
    expect(rels).toEqual([]);
  });

  it('should retain only in-project relations when mix of in/out-project are returned', () => {
    mockExtractRelations.mockReturnValue([
      makeRelation({ dstFilePath: '/project/src/utils.ts' }),
      makeRelation({ dstFilePath: '/external/lib.ts' }),
    ]);
    mockToRelativePath.mockImplementation((root: string, abs: string) =>
      abs.startsWith('/project') ? 'src/utils.ts' : '../external/lib.ts',
    );
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT });

    const [, , rels] = relationRepo.replaceFileRelations.mock.calls[0]!;
    expect(rels.length).toBe(1);
    expect(rels[0].dstFilePath).toBe('src/utils.ts');
  });

  it('should pass tsconfigPaths to extractRelations when provided', () => {
    const tsconfigPaths = { baseUrl: '/project', paths: new Map() };
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT, tsconfigPaths });

    expect(mockExtractRelations).toHaveBeenCalledWith(expect.anything(), expect.anything(), tsconfigPaths);
  });

  it('should pass empty array to replaceFileRelations when all relations are filtered', () => {
    mockExtractRelations.mockReturnValue([
      makeRelation({ dstFilePath: '/other1/file.ts' }),
      makeRelation({ dstFilePath: '/other2/file.ts' }),
    ]);
    mockToRelativePath.mockReturnValue('../other/file.ts');
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT });

    const [, , rels] = relationRepo.replaceFileRelations.mock.calls[0]!;
    expect(rels).toEqual([]);
  });

  it('should produce identical calls when invoked twice with same input', () => {
    mockExtractRelations.mockReturnValue([makeRelation()]);
    mockToRelativePath.mockReturnValue('src/utils.ts');
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT });
    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT });

    const [, , rels1] = relationRepo.replaceFileRelations.mock.calls[0]!;
    const [, , rels2] = relationRepo.replaceFileRelations.mock.calls[1]!;
    expect(rels1.length).toBe(rels2.length);
  });

  it('should set srcFilePath to relative path when relation output is created', () => {
    mockExtractRelations.mockReturnValue([makeRelation({ srcFilePath: ABS_FILE })]);
    mockToRelativePath.mockImplementation((root: string, abs: string) => {
      if (abs === ABS_FILE) return REL_FILE;
      return 'src/utils.ts';
    });
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT });

    const [, , rels] = relationRepo.replaceFileRelations.mock.calls[0]!;
    expect(rels[0].srcFilePath).toBe(REL_FILE);
  });
});
