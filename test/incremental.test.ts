import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DbConnection } from '../src/store/connection';
import { FileRepository } from '../src/store/repositories/file.repository';
import { SymbolRepository } from '../src/store/repositories/symbol.repository';
import { RelationRepository } from '../src/store/repositories/relation.repository';
import { AnnotationRepository } from '../src/store/repositories/annotation.repository';
import { ChangelogRepository } from '../src/store/repositories/changelog.repository';
import { ParseCache } from '../src/parser/parse-cache';
import { IndexCoordinator } from '../src/indexer/index-coordinator';
import { Gildash } from '../src/gildash';

// ── Shared DB setup ────────────────────────────────────────────────────────

let tmpDir: string;
let db: DbConnection;
let fileRepo: FileRepository;
let symbolRepo: SymbolRepository;
let relationRepo: RelationRepository;
let annotationRepo: AnnotationRepository;
let changelogRepo: ChangelogRepository;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'gildash-incremental-test-'));
  db = new DbConnection({ projectRoot: tmpDir });
  db.open();
  fileRepo = new FileRepository(db);
  symbolRepo = new SymbolRepository(db);
  relationRepo = new RelationRepository(db);
  annotationRepo = new AnnotationRepository(db);
  changelogRepo = new ChangelogRepository(db);
});

afterEach(async () => {
  db.close();
  await rm(tmpDir, { recursive: true, force: true });
});

function makeCoordinator(projectDir: string) {
  return new IndexCoordinator({
    projectRoot: projectDir,
    boundaries: [{ dir: '.', project: 'test-project' }],
    extensions: ['.ts'],
    ignorePatterns: [],
    dbConnection: db,
    parseCache: new ParseCache(100),
    fileRepo,
    symbolRepo,
    relationRepo,
    annotationRepo,
    changelogRepo,
  });
}

// ── 1. Incremental rename/move detection with real files ──────────────────

describe('Incremental indexing: rename detection', () => {
  it('should detect renamed function via structural fingerprint when function name changes in same file', async () => {
    const projectDir = join(tmpDir, 'rename-proj');
    await mkdir(join(projectDir, 'src'), { recursive: true });
    await writeFile(
      join(projectDir, 'src', 'math.ts'),
      [
        'export function calculateSum(a: number, b: number): number {',
        '  return a + b;',
        '}',
      ].join('\n'),
    );

    const coordinator = makeCoordinator(projectDir);
    await coordinator.fullIndex();

    // Rename: calculateSum → addNumbers (same structure)
    await writeFile(
      join(projectDir, 'src', 'math.ts'),
      [
        'export function addNumbers(a: number, b: number): number {',
        '  return a + b;',
        '}',
      ].join('\n'),
    );

    const result = await coordinator.incrementalIndex([
      { eventType: 'change', filePath: 'src/math.ts' },
    ]);

    expect(result.renamedSymbols).toHaveLength(1);
    expect(result.renamedSymbols[0]!.oldName).toBe('calculateSum');
    expect(result.renamedSymbols[0]!.newName).toBe('addNumbers');
    expect(result.renamedSymbols[0]!.filePath).toBe('src/math.ts');
    expect(result.renamedSymbols[0]!.kind).toBe('function');
    expect(result.renamedSymbols[0]!.isExported).toBe(true);

    // Renamed symbol should NOT appear in changedSymbols added/removed
    expect(result.changedSymbols.added.find(s => s.name === 'addNumbers')).toBeUndefined();
    expect(result.changedSymbols.removed.find(s => s.name === 'calculateSum')).toBeUndefined();
  });

  it('should detect renamed class via structural fingerprint when class name changes in same file', async () => {
    const projectDir = join(tmpDir, 'rename-class-proj');
    await mkdir(join(projectDir, 'src'), { recursive: true });
    await writeFile(
      join(projectDir, 'src', 'service.ts'),
      [
        'export class UserService {',
        '  private name: string = "";',
        '  getName(): string { return this.name; }',
        '}',
      ].join('\n'),
    );

    const coordinator = makeCoordinator(projectDir);
    await coordinator.fullIndex();

    // Rename: UserService → AccountService (same structure)
    await writeFile(
      join(projectDir, 'src', 'service.ts'),
      [
        'export class AccountService {',
        '  private name: string = "";',
        '  getName(): string { return this.name; }',
        '}',
      ].join('\n'),
    );

    const result = await coordinator.incrementalIndex([
      { eventType: 'change', filePath: 'src/service.ts' },
    ]);

    const classRename = result.renamedSymbols.find(
      r => r.oldName === 'UserService' && r.newName === 'AccountService',
    );
    expect(classRename).toBeDefined();
    expect(classRename!.kind).toBe('class');
  });

  it('should not detect rename when structural fingerprint changes (e.g. parameter added)', async () => {
    const projectDir = join(tmpDir, 'no-rename-proj');
    await mkdir(join(projectDir, 'src'), { recursive: true });
    await writeFile(
      join(projectDir, 'src', 'calc.ts'),
      'export function calc(a: number): number { return a; }',
    );

    const coordinator = makeCoordinator(projectDir);
    await coordinator.fullIndex();

    // Change name AND structure (add parameter)
    await writeFile(
      join(projectDir, 'src', 'calc.ts'),
      'export function compute(a: number, b: number): number { return a + b; }',
    );

    const result = await coordinator.incrementalIndex([
      { eventType: 'change', filePath: 'src/calc.ts' },
    ]);

    // Different structure → not a rename, should be add + remove
    expect(result.renamedSymbols).toHaveLength(0);
    expect(result.changedSymbols.added.find(s => s.name === 'compute')).toBeDefined();
    expect(result.changedSymbols.removed.find(s => s.name === 'calc')).toBeDefined();
  });
});

describe('Incremental indexing: move detection', () => {
  it('should detect moved function when symbol is deleted from one file and appears in another', async () => {
    const projectDir = join(tmpDir, 'move-proj');
    await mkdir(join(projectDir, 'src'), { recursive: true });
    await writeFile(
      join(projectDir, 'src', 'old.ts'),
      'export function transferMe(): void {}',
    );
    await writeFile(
      join(projectDir, 'src', 'other.ts'),
      'export const placeholder = 1;',
    );

    const coordinator = makeCoordinator(projectDir);
    await coordinator.fullIndex();

    // Move: delete from old.ts, create in new.ts
    await unlink(join(projectDir, 'src', 'old.ts'));
    await writeFile(
      join(projectDir, 'src', 'new.ts'),
      'export function transferMe(): void {}',
    );

    const result = await coordinator.incrementalIndex([
      { eventType: 'delete', filePath: 'src/old.ts' },
      { eventType: 'create', filePath: 'src/new.ts' },
    ]);

    expect(result.movedSymbols).toHaveLength(1);
    expect(result.movedSymbols[0]!.name).toBe('transferMe');
    expect(result.movedSymbols[0]!.oldFilePath).toBe('src/old.ts');
    expect(result.movedSymbols[0]!.newFilePath).toBe('src/new.ts');
    expect(result.movedSymbols[0]!.kind).toBe('function');

    // Moved symbol should NOT appear in changedSymbols added/removed
    expect(result.changedSymbols.added.find(s => s.name === 'transferMe')).toBeUndefined();
    expect(result.changedSymbols.removed.find(s => s.name === 'transferMe')).toBeUndefined();
  });

  it('should retarget incoming relations when symbol moves to a different file', async () => {
    const projectDir = join(tmpDir, 'move-retarget-proj');
    await mkdir(join(projectDir, 'src'), { recursive: true });
    await writeFile(
      join(projectDir, 'src', 'utils.ts'),
      'export function helper(): void {}',
    );
    await writeFile(
      join(projectDir, 'src', 'consumer.ts'),
      "import { helper } from './utils';\nexport function run() { helper(); }",
    );

    const coordinator = makeCoordinator(projectDir);
    await coordinator.fullIndex();

    // Verify initial relation exists
    const beforeRels = relationRepo.getOutgoing('test-project', 'src/consumer.ts');
    const importRel = beforeRels.find(r => r.type === 'imports' && r.dstFilePath === 'src/utils.ts');
    expect(importRel).toBeDefined();

    // Move helper from utils.ts to helpers.ts, delete utils.ts
    await unlink(join(projectDir, 'src', 'utils.ts'));
    await writeFile(
      join(projectDir, 'src', 'helpers.ts'),
      'export function helper(): void {}',
    );

    const result = await coordinator.incrementalIndex([
      { eventType: 'delete', filePath: 'src/utils.ts' },
      { eventType: 'create', filePath: 'src/helpers.ts' },
    ]);

    expect(result.movedSymbols.length).toBeGreaterThanOrEqual(1);
    const moved = result.movedSymbols.find(m => m.name === 'helper');
    expect(moved).toBeDefined();
    expect(moved!.oldFilePath).toBe('src/utils.ts');
    expect(moved!.newFilePath).toBe('src/helpers.ts');
  });
});

describe('Incremental indexing: changedSymbols diff', () => {
  it('should detect added and removed symbols after incremental file change', async () => {
    const projectDir = join(tmpDir, 'diff-proj');
    await mkdir(join(projectDir, 'src'), { recursive: true });
    await writeFile(
      join(projectDir, 'src', 'api.ts'),
      [
        'export function getUser(): void {}',
        'export function listUsers(page: number): void {}',
      ].join('\n'),
    );

    const coordinator = makeCoordinator(projectDir);
    await coordinator.fullIndex();

    // Remove listUsers (1 param), add createUser (2 params) — structurally different to avoid rename match
    await writeFile(
      join(projectDir, 'src', 'api.ts'),
      [
        'export function getUser(): void {}',
        'export function createUser(name: string, email: string): void {}',
      ].join('\n'),
    );

    const result = await coordinator.incrementalIndex([
      { eventType: 'change', filePath: 'src/api.ts' },
    ]);

    expect(result.changedSymbols.added.find(s => s.name === 'createUser')).toBeDefined();
    expect(result.changedSymbols.removed.find(s => s.name === 'listUsers')).toBeDefined();
    // getUser should not appear in added/removed (unchanged)
    expect(result.changedSymbols.added.find(s => s.name === 'getUser')).toBeUndefined();
    expect(result.changedSymbols.removed.find(s => s.name === 'getUser')).toBeUndefined();
  });

  it('should detect modified symbol when export status changes', async () => {
    const projectDir = join(tmpDir, 'export-change-proj');
    await mkdir(join(projectDir, 'src'), { recursive: true });
    await writeFile(
      join(projectDir, 'src', 'mod.ts'),
      'function internal(): void {}',
    );

    const coordinator = makeCoordinator(projectDir);
    await coordinator.fullIndex();

    // Make it exported
    await writeFile(
      join(projectDir, 'src', 'mod.ts'),
      'export function internal(): void {}',
    );

    const result = await coordinator.incrementalIndex([
      { eventType: 'change', filePath: 'src/mod.ts' },
    ]);

    expect(result.changedSymbols.modified.find(s => s.name === 'internal')).toBeDefined();
    expect(result.changedSymbols.modified[0]!.isExported).toBe(true);
  });

  it('should report changedRelations when imports are added incrementally', async () => {
    const projectDir = join(tmpDir, 'inc-rel-proj');
    await mkdir(join(projectDir, 'src'), { recursive: true });
    await writeFile(join(projectDir, 'src', 'utils.ts'), 'export function helper(): void {}');
    await writeFile(join(projectDir, 'src', 'app.ts'), 'export const x = 1;');

    const coordinator = makeCoordinator(projectDir);
    await coordinator.fullIndex();

    // Add import
    await writeFile(
      join(projectDir, 'src', 'app.ts'),
      "import { helper } from './utils';\nexport const x = helper();",
    );

    const result = await coordinator.incrementalIndex([
      { eventType: 'change', filePath: 'src/app.ts' },
    ]);

    const addedImport = result.changedRelations.added.find(
      r => r.type === 'imports' && r.srcFilePath === 'src/app.ts' && r.dstFilePath === 'src/utils.ts',
    );
    expect(addedImport).toBeDefined();
  });
});

// ── 2. Monorepo cross-project relations ───────────────────────────────────

describe('Monorepo: cross-project relations', () => {
  it('should record correct dstProject when package A imports from package B', async () => {
    const projectDir = join(tmpDir, 'monorepo-proj');
    await mkdir(join(projectDir, 'packages', 'core', 'src'), { recursive: true });
    await mkdir(join(projectDir, 'packages', 'app', 'src'), { recursive: true });

    // Root package.json
    await writeFile(
      join(projectDir, 'package.json'),
      JSON.stringify({ name: 'monorepo-root' }),
    );
    // Core package
    await writeFile(
      join(projectDir, 'packages', 'core', 'package.json'),
      JSON.stringify({ name: '@mono/core' }),
    );
    await writeFile(
      join(projectDir, 'packages', 'core', 'src', 'utils.ts'),
      'export function coreHelper(): void {}',
    );
    // App package — imports from core via relative path
    await writeFile(
      join(projectDir, 'packages', 'app', 'package.json'),
      JSON.stringify({ name: '@mono/app' }),
    );
    await writeFile(
      join(projectDir, 'packages', 'app', 'src', 'main.ts'),
      "import { coreHelper } from '../../core/src/utils';\nexport function run() { coreHelper(); }",
    );

    const coordinator = new IndexCoordinator({
      projectRoot: projectDir,
      boundaries: [
        { dir: 'packages/app', project: '@mono/app' },
        { dir: 'packages/core', project: '@mono/core' },
        { dir: '.', project: 'monorepo-root' },
      ],
      extensions: ['.ts'],
      ignorePatterns: [],
      dbConnection: db,
      parseCache: new ParseCache(100),
      fileRepo,
      symbolRepo,
      relationRepo,
    });

    await coordinator.fullIndex();

    // Verify symbols are assigned to correct projects
    const coreSymbols = symbolRepo.getFileSymbols('@mono/core', 'packages/core/src/utils.ts');
    expect(coreSymbols.length).toBeGreaterThanOrEqual(1);
    expect(coreSymbols[0]!.name).toBe('coreHelper');

    const appSymbols = symbolRepo.getFileSymbols('@mono/app', 'packages/app/src/main.ts');
    expect(appSymbols.length).toBeGreaterThanOrEqual(1);

    // Verify cross-project relation: app → core
    const appRelations = relationRepo.getOutgoing('@mono/app', 'packages/app/src/main.ts');
    const crossProjectImport = appRelations.find(
      r => r.type === 'imports' && r.dstFilePath === 'packages/core/src/utils.ts',
    );
    expect(crossProjectImport).toBeDefined();
    expect(crossProjectImport!.dstProject).toBe('@mono/core');
  });

  it('should resolve file project correctly with nested package boundaries', async () => {
    const projectDir = join(tmpDir, 'nested-mono-proj');
    await mkdir(join(projectDir, 'libs', 'shared', 'src'), { recursive: true });
    await mkdir(join(projectDir, 'apps', 'web', 'src'), { recursive: true });

    await writeFile(join(projectDir, 'package.json'), JSON.stringify({ name: 'root' }));
    await writeFile(join(projectDir, 'libs', 'shared', 'package.json'), JSON.stringify({ name: '@ws/shared' }));
    await writeFile(join(projectDir, 'apps', 'web', 'package.json'), JSON.stringify({ name: '@ws/web' }));

    await writeFile(join(projectDir, 'libs', 'shared', 'src', 'lib.ts'), 'export const SHARED = 1;');
    await writeFile(
      join(projectDir, 'apps', 'web', 'src', 'page.ts'),
      "import { SHARED } from '../../../libs/shared/src/lib';\nexport const val = SHARED;",
    );

    const coordinator = new IndexCoordinator({
      projectRoot: projectDir,
      boundaries: [
        { dir: 'apps/web', project: '@ws/web' },
        { dir: 'libs/shared', project: '@ws/shared' },
        { dir: '.', project: 'root' },
      ],
      extensions: ['.ts'],
      ignorePatterns: [],
      dbConnection: db,
      parseCache: new ParseCache(100),
      fileRepo,
      symbolRepo,
      relationRepo,
    });

    await coordinator.fullIndex();

    // Verify shared symbols indexed under @ws/shared
    const sharedSymbols = symbolRepo.getFileSymbols('@ws/shared', 'libs/shared/src/lib.ts');
    expect(sharedSymbols.find(s => s.name === 'SHARED')).toBeDefined();

    // Verify web symbols indexed under @ws/web
    const webSymbols = symbolRepo.getFileSymbols('@ws/web', 'apps/web/src/page.ts');
    expect(webSymbols.find(s => s.name === 'val')).toBeDefined();

    // Verify cross-project relation
    const webRelations = relationRepo.getOutgoing('@ws/web', 'apps/web/src/page.ts');
    const crossImport = webRelations.find(r => r.type === 'imports' && r.dstFilePath === 'libs/shared/src/lib.ts');
    expect(crossImport).toBeDefined();
    expect(crossImport!.dstProject).toBe('@ws/shared');
  });
});

// ── 3. External import: isExternal & specifier ────────────────────────────

describe('External imports: isExternal and specifier', () => {
  it('should mark bare specifier imports as isExternal with correct specifier', async () => {
    const projectDir = join(tmpDir, 'external-proj');
    await mkdir(join(projectDir, 'src'), { recursive: true });
    await writeFile(join(projectDir, 'package.json'), JSON.stringify({ name: 'ext-test' }));
    await writeFile(
      join(projectDir, 'src', 'app.ts'),
      [
        "import express from 'express';",
        "import { useState } from 'react';",
        "import { helper } from './utils';",
        'export function run() {}',
      ].join('\n'),
    );
    await writeFile(
      join(projectDir, 'src', 'utils.ts'),
      'export function helper(): void {}',
    );

    const coordinator = new IndexCoordinator({
      projectRoot: projectDir,
      boundaries: [{ dir: '.', project: 'ext-test' }],
      extensions: ['.ts'],
      ignorePatterns: [],
      dbConnection: db,
      parseCache: new ParseCache(100),
      fileRepo,
      symbolRepo,
      relationRepo,
    });

    await coordinator.fullIndex();

    const relations = relationRepo.getOutgoing('ext-test', 'src/app.ts');

    // express — bare specifier, external
    const expressRel = relations.find(r => r.specifier === 'express');
    expect(expressRel).toBeDefined();
    expect(expressRel!.isExternal).toBe(1);
    expect(expressRel!.dstFilePath).toBeNull();

    // react — bare specifier, external
    const reactRel = relations.find(r => r.specifier === 'react');
    expect(reactRel).toBeDefined();
    expect(reactRel!.isExternal).toBe(1);
    expect(reactRel!.dstFilePath).toBeNull();

    // ./utils — relative import, internal
    const utilsRel = relations.find(r => r.dstFilePath === 'src/utils.ts');
    expect(utilsRel).toBeDefined();
    expect(utilsRel!.isExternal).toBe(0);
  });

  it('should mark scoped package imports as isExternal', async () => {
    const projectDir = join(tmpDir, 'scoped-ext-proj');
    await mkdir(join(projectDir, 'src'), { recursive: true });
    await writeFile(join(projectDir, 'package.json'), JSON.stringify({ name: 'scoped-test' }));
    await writeFile(
      join(projectDir, 'src', 'index.ts'),
      [
        "import { z } from '@hono/zod-validator';",
        "import Anthropic from '@anthropic-ai/sdk';",
        'export const app = {};',
      ].join('\n'),
    );

    const coordinator = new IndexCoordinator({
      projectRoot: projectDir,
      boundaries: [{ dir: '.', project: 'scoped-test' }],
      extensions: ['.ts'],
      ignorePatterns: [],
      dbConnection: db,
      parseCache: new ParseCache(100),
      fileRepo,
      symbolRepo,
      relationRepo,
    });

    await coordinator.fullIndex();

    const relations = relationRepo.getOutgoing('scoped-test', 'src/index.ts');

    const honoRel = relations.find(r => r.specifier === '@hono/zod-validator');
    expect(honoRel).toBeDefined();
    expect(honoRel!.isExternal).toBe(1);
    expect(honoRel!.dstFilePath).toBeNull();

    const anthropicRel = relations.find(r => r.specifier === '@anthropic-ai/sdk');
    expect(anthropicRel).toBeDefined();
    expect(anthropicRel!.isExternal).toBe(1);
    expect(anthropicRel!.dstFilePath).toBeNull();
  });

  it('should mark dynamic import of external module as isExternal', async () => {
    const projectDir = join(tmpDir, 'dynamic-ext-proj');
    await mkdir(join(projectDir, 'src'), { recursive: true });
    await writeFile(join(projectDir, 'package.json'), JSON.stringify({ name: 'dynamic-test' }));
    await writeFile(
      join(projectDir, 'src', 'loader.ts'),
      [
        "export async function load() {",
        "  const mod = await import('lodash');",
        "  return mod;",
        "}",
      ].join('\n'),
    );

    const coordinator = new IndexCoordinator({
      projectRoot: projectDir,
      boundaries: [{ dir: '.', project: 'dynamic-test' }],
      extensions: ['.ts'],
      ignorePatterns: [],
      dbConnection: db,
      parseCache: new ParseCache(100),
      fileRepo,
      symbolRepo,
      relationRepo,
    });

    await coordinator.fullIndex();

    const relations = relationRepo.getOutgoing('dynamic-test', 'src/loader.ts');
    const dynamicImport = relations.find(r => r.specifier === 'lodash');
    expect(dynamicImport).toBeDefined();
    expect(dynamicImport!.isExternal).toBe(1);
    expect(dynamicImport!.dstFilePath).toBeNull();
  });

  it('should store specifier as null for resolved relative imports', async () => {
    const projectDir = join(tmpDir, 'specifier-null-proj');
    await mkdir(join(projectDir, 'src'), { recursive: true });
    await writeFile(join(projectDir, 'package.json'), JSON.stringify({ name: 'spec-null-test' }));
    await writeFile(join(projectDir, 'src', 'a.ts'), "import { b } from './b';");
    await writeFile(join(projectDir, 'src', 'b.ts'), 'export const b = 1;');

    const coordinator = new IndexCoordinator({
      projectRoot: projectDir,
      boundaries: [{ dir: '.', project: 'spec-null-test' }],
      extensions: ['.ts'],
      ignorePatterns: [],
      dbConnection: db,
      parseCache: new ParseCache(100),
      fileRepo,
      symbolRepo,
      relationRepo,
    });

    await coordinator.fullIndex();

    const relations = relationRepo.getOutgoing('spec-null-test', 'src/a.ts');
    const internalRel = relations.find(r => r.dstFilePath === 'src/b.ts');
    expect(internalRel).toBeDefined();
    expect(internalRel!.specifier).toBeNull();
    expect(internalRel!.isExternal).toBe(0);
  });
});

// ── 4. Changelog records for incremental rename/move ──────────────────────

describe('Incremental indexing: changelog recording', () => {
  it('should record renamed changeType in changelog when function is renamed', async () => {
    const projectDir = join(tmpDir, 'changelog-rename-proj');
    await mkdir(join(projectDir, 'src'), { recursive: true });
    await writeFile(
      join(projectDir, 'src', 'svc.ts'),
      'export function oldName(x: number): number { return x; }',
    );

    const coordinator = makeCoordinator(projectDir);
    await coordinator.fullIndex();

    await writeFile(
      join(projectDir, 'src', 'svc.ts'),
      'export function newName(x: number): number { return x; }',
    );

    await coordinator.incrementalIndex([
      { eventType: 'change', filePath: 'src/svc.ts' },
    ]);

    const changes = changelogRepo.getSince({
      project: 'test-project',
      since: new Date(Date.now() - 60_000).toISOString(),
      changeTypes: ['renamed'],
      includeFullIndex: false,
      limit: 100,
    });

    expect(changes.length).toBeGreaterThanOrEqual(1);
    const renamed = changes.find(c => c.symbolName === 'newName' && c.changeType === 'renamed');
    expect(renamed).toBeDefined();
    expect(renamed!.oldName).toBe('oldName');
  });

  it('should record moved changeType in changelog when function moves to another file', async () => {
    const projectDir = join(tmpDir, 'changelog-move-proj');
    await mkdir(join(projectDir, 'src'), { recursive: true });
    await writeFile(
      join(projectDir, 'src', 'source.ts'),
      'export function migrateFn(): void {}',
    );
    await writeFile(
      join(projectDir, 'src', 'keep.ts'),
      'export const keep = 1;',
    );

    const coordinator = makeCoordinator(projectDir);
    await coordinator.fullIndex();

    await unlink(join(projectDir, 'src', 'source.ts'));
    await writeFile(
      join(projectDir, 'src', 'target.ts'),
      'export function migrateFn(): void {}',
    );

    await coordinator.incrementalIndex([
      { eventType: 'delete', filePath: 'src/source.ts' },
      { eventType: 'create', filePath: 'src/target.ts' },
    ]);

    const changes = changelogRepo.getSince({
      project: 'test-project',
      since: new Date(Date.now() - 60_000).toISOString(),
      changeTypes: ['moved'],
      includeFullIndex: false,
      limit: 100,
    });

    expect(changes.length).toBeGreaterThanOrEqual(1);
    const moved = changes.find(c => c.symbolName === 'migrateFn' && c.changeType === 'moved');
    expect(moved).toBeDefined();
    expect(moved!.oldFilePath).toBe('src/source.ts');
    expect(moved!.filePath).toBe('src/target.ts');
  });
});

// ── 5. Gildash facade: external import search & cross-project relations ───

describe('Gildash facade: searchRelations with isExternal and specifier', () => {
  let facadeTmpDir: string;
  let g: Gildash;

  beforeAll(async () => {
    facadeTmpDir = await mkdtemp(join(tmpdir(), 'gildash-facade-ext-'));
    await mkdir(join(facadeTmpDir, 'src'), { recursive: true });
    await writeFile(join(facadeTmpDir, 'package.json'), JSON.stringify({ name: 'facade-ext-test' }));
    await writeFile(
      join(facadeTmpDir, 'src', 'app.ts'),
      [
        "import express from 'express';",
        "import { helper } from './utils';",
        'export function main() {}',
      ].join('\n'),
    );
    await writeFile(
      join(facadeTmpDir, 'src', 'utils.ts'),
      'export function helper(): void {}',
    );

    g = await Gildash.open({
      projectRoot: facadeTmpDir,
      extensions: ['.ts'],
      watchMode: false,
    } as any);
  });

  afterAll(async () => {
    await g.close();
    await rm(facadeTmpDir, { recursive: true, force: true });
  });

  it('should return external relations when filtering by isExternal: true', () => {
    const externals = g.searchRelations({ isExternal: true });
    expect(externals.length).toBeGreaterThanOrEqual(1);
    for (const rel of externals) {
      expect(rel.isExternal).toBe(true);
    }
    expect(externals.find(r => r.specifier === 'express')).toBeDefined();
  });

  it('should return only internal relations when filtering by isExternal: false', () => {
    const internals = g.searchRelations({ isExternal: false, type: 'imports' });
    for (const rel of internals) {
      expect(rel.isExternal).toBe(false);
    }
    expect(internals.find(r => r.dstFilePath?.includes('utils'))).toBeDefined();
  });

  it('should find relation by specifier string', () => {
    const results = g.searchRelations({ specifier: 'express' });
    expect(results).toHaveLength(1);
    expect(results[0]!.isExternal).toBe(true);
    expect(results[0]!.specifier).toBe('express');
  });
});

describe('Gildash facade: monorepo cross-project searchRelations', () => {
  let monoTmpDir: string;
  let g: Gildash;

  beforeAll(async () => {
    monoTmpDir = await mkdtemp(join(tmpdir(), 'gildash-facade-mono-'));
    await mkdir(join(monoTmpDir, 'packages', 'lib', 'src'), { recursive: true });
    await mkdir(join(monoTmpDir, 'packages', 'app', 'src'), { recursive: true });

    await writeFile(join(monoTmpDir, 'package.json'), JSON.stringify({ name: 'mono-root' }));
    await writeFile(join(monoTmpDir, 'packages', 'lib', 'package.json'), JSON.stringify({ name: '@m/lib' }));
    await writeFile(join(monoTmpDir, 'packages', 'app', 'package.json'), JSON.stringify({ name: '@m/app' }));

    await writeFile(
      join(monoTmpDir, 'packages', 'lib', 'src', 'index.ts'),
      'export function libFn(): void {}',
    );
    await writeFile(
      join(monoTmpDir, 'packages', 'app', 'src', 'main.ts'),
      "import { libFn } from '../../lib/src/index';\nexport function appMain() { libFn(); }",
    );

    g = await Gildash.open({
      projectRoot: monoTmpDir,
      extensions: ['.ts'],
      watchMode: false,
    } as any);
  });

  afterAll(async () => {
    await g.close();
    await rm(monoTmpDir, { recursive: true, force: true });
  });

  it('should return cross-project dstProject via searchAllRelations', () => {
    // searchRelations uses defaultProject (first boundary), which may not be @m/app.
    // searchAllRelations queries across all projects.
    const allRels = g.searchAllRelations({
      srcFilePath: 'packages/app/src/main.ts',
      type: 'imports',
    });
    const crossRel = allRels.find(r => r.dstFilePath?.includes('lib'));
    expect(crossRel).toBeDefined();
    expect(crossRel!.dstProject).toBe('@m/lib');
  });

  it('should include cross-project imports when searching all relations without srcFilePath filter', () => {
    const allRels = g.searchAllRelations({ type: 'imports' });
    const crossRel = allRels.find(
      r => r.srcFilePath === 'packages/app/src/main.ts' && r.dstFilePath?.includes('lib'),
    );
    expect(crossRel).toBeDefined();
    expect(crossRel!.dstProject).toBe('@m/lib');
  });
});
