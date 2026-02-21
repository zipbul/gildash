import path from 'node:path';
import { existsSync } from 'node:fs';
import type { ParsedFile } from './parser/types';
import { parseSource as defaultParseSource } from './parser/parse-source';
import { ParseCache } from './parser/parse-cache';
import type { ExtractedSymbol } from './extractor/types';
import { extractSymbols as defaultExtractSymbols } from './extractor/symbol-extractor';
import { extractRelations as defaultExtractRelations } from './extractor/relation-extractor';
import type { CodeRelation } from './extractor/types';
import { DbConnection } from './store/connection';
import { FileRepository } from './store/repositories/file.repository';
import { SymbolRepository } from './store/repositories/symbol.repository';
import { RelationRepository } from './store/repositories/relation.repository';
import { ProjectWatcher } from './watcher/project-watcher';
import { IndexCoordinator } from './indexer/index-coordinator';
import type { IndexResult } from './indexer/index-coordinator';
import type { IndexCoordinatorOptions } from './indexer/index-coordinator';
import type { FileChangeEvent } from './watcher/types';
import { acquireWatcherRole, releaseWatcherRole, updateHeartbeat } from './watcher/ownership';
import type { WatcherOwnerStore } from './watcher/ownership';
import { discoverProjects } from './common/project-discovery';
import type { ProjectBoundary } from './common/project-discovery';
import { loadTsconfigPaths, clearTsconfigPathsCache } from './common/tsconfig-resolver';
import type { TsconfigPaths } from './common/tsconfig-resolver';
import { symbolSearch as defaultSymbolSearch } from './search/symbol-search';
import type { SymbolSearchQuery, SymbolSearchResult } from './search/symbol-search';
import { relationSearch as defaultRelationSearch } from './search/relation-search';
import type { RelationSearchQuery } from './search/relation-search';
import type { SymbolStats } from './store/repositories/symbol.repository';
import { DependencyGraph } from './search/dependency-graph';

// ── Constants ─────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEALTHCHECK_INTERVAL_MS = 60_000;
const MAX_HEALTHCHECK_RETRIES = 10;

// ── Types ─────────────────────────────────────────────────────────────────

export interface Logger {
  error(...args: unknown[]): void;
}

export interface CodeledgerOptions {
  projectRoot: string;
  extensions?: string[];
  ignorePatterns?: string[];
  parseCacheCapacity?: number;
  logger?: Logger;
}

/** @internal */
interface CodeledgerInternalOptions {
  existsSyncFn?: (p: string) => boolean;
  dbConnectionFactory?: () => Pick<DbConnection, 'open' | 'close' | 'transaction'> & WatcherOwnerStore;
  watcherFactory?: () => Pick<ProjectWatcher, 'start' | 'close'>;
  coordinatorFactory?: () => Pick<IndexCoordinator, 'fullIndex' | 'shutdown' | 'onIndexed'> & {
    tsconfigPaths?: Promise<TsconfigPaths | null>;
    handleWatcherEvent?(event: FileChangeEvent): void;
  };
  repositoryFactory?: () => {
    fileRepo: Pick<FileRepository, 'upsertFile' | 'getAllFiles' | 'getFilesMap' | 'deleteFile'>;
    symbolRepo: SymbolRepository;
    relationRepo: RelationRepository;
    parseCache: Pick<ParseCache, 'set' | 'get' | 'invalidate'>;
  };
  acquireWatcherRoleFn?: typeof acquireWatcherRole;
  releaseWatcherRoleFn?: typeof releaseWatcherRole;
  updateHeartbeatFn?: typeof updateHeartbeat;
  discoverProjectsFn?: typeof discoverProjects;
  parseSourceFn?: typeof defaultParseSource;
  extractSymbolsFn?: typeof defaultExtractSymbols;
  extractRelationsFn?: typeof defaultExtractRelations;
  symbolSearchFn?: typeof defaultSymbolSearch;
  relationSearchFn?: typeof defaultRelationSearch;
  loadTsconfigPathsFn?: typeof loadTsconfigPaths;
}

// ── Codeledger ────────────────────────────────────────────────────────────

export class Codeledger {
  readonly projectRoot: string;

  private readonly db: Pick<DbConnection, 'open' | 'close' | 'transaction'> & WatcherOwnerStore;
  private readonly symbolRepo: SymbolRepository;
  private readonly relationRepo: RelationRepository;
  private readonly parseCache: Pick<ParseCache, 'set' | 'get' | 'invalidate'>;
  private coordinator: (Pick<IndexCoordinator, 'fullIndex' | 'shutdown' | 'onIndexed'> & {
    tsconfigPaths?: Promise<TsconfigPaths | null>;
    handleWatcherEvent?(event: FileChangeEvent): void;
  }) | null;
  private watcher: Pick<ProjectWatcher, 'start' | 'close'> | null;
  private readonly releaseWatcherRoleFn: typeof releaseWatcherRole;
  private readonly parseSourceFn: typeof defaultParseSource;
  private readonly extractSymbolsFn: typeof defaultExtractSymbols;
  private readonly extractRelationsFn: typeof defaultExtractRelations;
  private readonly symbolSearchFn: typeof defaultSymbolSearch;
  private readonly relationSearchFn: typeof defaultRelationSearch;
  private readonly logger: Logger;
  private readonly defaultProject: string;
  private readonly role: 'owner' | 'reader';
  private timer: ReturnType<typeof setInterval> | null = null;
  private signalHandlers: Array<[string, () => void]> = [];
  private closed = false;
  private tsconfigPaths: TsconfigPaths | null = null;
  private boundaries: ProjectBoundary[] = [];
  private readonly onIndexedCallbacks = new Set<(result: IndexResult) => void>();

  private constructor(opts: {
    projectRoot: string;
    db: Pick<DbConnection, 'open' | 'close' | 'transaction'> & WatcherOwnerStore;
    symbolRepo: SymbolRepository;
    relationRepo: RelationRepository;
    parseCache: Pick<ParseCache, 'set' | 'get' | 'invalidate'>;
    coordinator: (Pick<IndexCoordinator, 'fullIndex' | 'shutdown' | 'onIndexed'> & {
      tsconfigPaths?: Promise<TsconfigPaths | null>;
      handleWatcherEvent?(event: FileChangeEvent): void;
    }) | null;
    watcher: Pick<ProjectWatcher, 'start' | 'close'> | null;
    releaseWatcherRoleFn: typeof releaseWatcherRole;
    parseSourceFn: typeof defaultParseSource;
    extractSymbolsFn: typeof defaultExtractSymbols;
    extractRelationsFn: typeof defaultExtractRelations;
    symbolSearchFn: typeof defaultSymbolSearch;
    relationSearchFn: typeof defaultRelationSearch;
    logger: Logger;
    defaultProject: string;
    role: 'owner' | 'reader';
  }) {
    this.projectRoot = opts.projectRoot;
    this.db = opts.db;
    this.symbolRepo = opts.symbolRepo;
    this.relationRepo = opts.relationRepo;
    this.parseCache = opts.parseCache;
    this.coordinator = opts.coordinator;
    this.watcher = opts.watcher;
    this.releaseWatcherRoleFn = opts.releaseWatcherRoleFn;
    this.parseSourceFn = opts.parseSourceFn;
    this.extractSymbolsFn = opts.extractSymbolsFn;
    this.extractRelationsFn = opts.extractRelationsFn;
    this.symbolSearchFn = opts.symbolSearchFn;
    this.relationSearchFn = opts.relationSearchFn;
    this.logger = opts.logger;
    this.defaultProject = opts.defaultProject;
    this.role = opts.role;
  }

  // ── Static factory ──────────────────────────────────────────────────────

  static async open(options: CodeledgerOptions & CodeledgerInternalOptions): Promise<Codeledger> {
    const {
      projectRoot,
      extensions = ['.ts', '.mts', '.cts'],
      ignorePatterns = [],
      parseCacheCapacity = 500,
      logger = console,
      existsSyncFn = existsSync,
      dbConnectionFactory,
      watcherFactory,
      coordinatorFactory,
      repositoryFactory,
      acquireWatcherRoleFn = acquireWatcherRole,
      releaseWatcherRoleFn = releaseWatcherRole,
      updateHeartbeatFn = updateHeartbeat,
      discoverProjectsFn = discoverProjects,
      parseSourceFn = defaultParseSource,
      extractSymbolsFn = defaultExtractSymbols,
      extractRelationsFn = defaultExtractRelations,
      symbolSearchFn = defaultSymbolSearch,
      relationSearchFn = defaultRelationSearch,
      loadTsconfigPathsFn = loadTsconfigPaths,
    } = options;

    // ── 1. Validate options ─────────────────────────────────────────────
    if (!path.isAbsolute(projectRoot)) {
      throw new Error(`Codeledger: projectRoot must be an absolute path, got: "${projectRoot}"`);
    }
    if (!existsSyncFn(projectRoot)) {
      throw new Error(`Codeledger: projectRoot does not exist: "${projectRoot}"`);
    }

    // ── 2. Open DB ──────────────────────────────────────────────────────
    const db = dbConnectionFactory
      ? dbConnectionFactory()
      : new DbConnection({ projectRoot });
    db.open();
    try {

    // ── 3. Discover projects ────────────────────────────────────────────
    const boundaries: ProjectBoundary[] = await discoverProjectsFn(projectRoot);
    const defaultProject = boundaries[0]?.project ?? path.basename(projectRoot);

    // ── 4. Create repositories ──────────────────────────────────────────
    const repos = repositoryFactory
      ? repositoryFactory()
      : (() => {
          const connection = db as DbConnection;
          return {
            fileRepo: new FileRepository(connection),
            symbolRepo: new SymbolRepository(connection),
            relationRepo: new RelationRepository(connection),
            parseCache: new ParseCache(parseCacheCapacity),
          };
        })();

    // ── 5. Acquire watcher role ─────────────────────────────────────────
    const role = await Promise.resolve(
      acquireWatcherRoleFn(db, process.pid, {}),
    );

    let coordinator: (Pick<IndexCoordinator, 'fullIndex' | 'shutdown' | 'onIndexed'> & {
      tsconfigPaths?: Promise<TsconfigPaths | null>;
      handleWatcherEvent?(event: FileChangeEvent): void;
    }) | null = null;
    let watcher: Pick<ProjectWatcher, 'start' | 'close'> | null = null;

    const instance = new Codeledger({
      projectRoot,
      db,
      symbolRepo: repos.symbolRepo,
      relationRepo: repos.relationRepo,
      parseCache: repos.parseCache,
      coordinator,
      watcher,
      releaseWatcherRoleFn: releaseWatcherRoleFn,
      parseSourceFn: parseSourceFn,
      extractSymbolsFn: extractSymbolsFn,
      extractRelationsFn: extractRelationsFn,
      symbolSearchFn: symbolSearchFn,
      relationSearchFn: relationSearchFn,
      logger,
      defaultProject,
      role,
    });
    clearTsconfigPathsCache(projectRoot);
    instance.tsconfigPaths = await loadTsconfigPathsFn(projectRoot);
    instance.boundaries = boundaries;
    // ── 6. Role-specific setup ──────────────────────────────────────────
    if (role === 'owner') {
      // Create watcher
      const w = watcherFactory
        ? watcherFactory()
        : new ProjectWatcher({ projectRoot, ignorePatterns, extensions }, undefined, logger);

      // Create coordinator
      const c = coordinatorFactory
        ? coordinatorFactory()
        : new IndexCoordinator({
            projectRoot,
            boundaries,
            extensions,
            ignorePatterns,
            dbConnection: db,
            parseCache: repos.parseCache,
            fileRepo: repos.fileRepo,
            symbolRepo: repos.symbolRepo,
            relationRepo: repos.relationRepo,
            logger,
          });

      // Assign after construction
      instance.coordinator = c;
      instance.watcher = w;

      // Start watcher
      await w.start((event) => c.handleWatcherEvent?.(event));

      // Start heartbeat
      const timer = setInterval(() => {
        updateHeartbeatFn(db, process.pid);
      }, HEARTBEAT_INTERVAL_MS);
      instance.timer = timer;

      // Initial full index
      await c.fullIndex();
    } else {
      // Reader: start healthcheck timer
      let retryCount = 0;
      const healthcheck = async () => {
        try {
          const newRole = await Promise.resolve(
            acquireWatcherRoleFn(db, process.pid, {}),
          );
          retryCount = 0; // A-1: 성공 시 retry 횟수 초기화
          if (newRole === 'owner') {
            clearInterval(instance.timer!);
            instance.timer = null;
            // A-2: owner 승격 setup 실패 시 타이머 복원
            let promotedWatcher: Pick<ProjectWatcher, 'start' | 'close'> | null = null;
            let promotedCoordinator: (Pick<IndexCoordinator, 'fullIndex' | 'shutdown' | 'onIndexed'> & {
              tsconfigPaths?: Promise<TsconfigPaths | null>;
              handleWatcherEvent?(event: FileChangeEvent): void;
            }) | null = null;
            try {
              promotedWatcher = watcherFactory
                ? watcherFactory()
                : new ProjectWatcher({ projectRoot, ignorePatterns, extensions }, undefined, logger);
              promotedCoordinator = coordinatorFactory
                ? coordinatorFactory()
                : new IndexCoordinator({
                    projectRoot,
                    boundaries,
                    extensions,
                    ignorePatterns,
                    dbConnection: db,
                    parseCache: repos.parseCache,
                    fileRepo: repos.fileRepo,
                    symbolRepo: repos.symbolRepo,
                    relationRepo: repos.relationRepo,
                    logger,
                  });
              // Forward registered onIndexed callbacks to new coordinator
              for (const cb of instance.onIndexedCallbacks) {
                promotedCoordinator.onIndexed(cb);
              }
              await promotedWatcher.start((event) => promotedCoordinator?.handleWatcherEvent?.(event));
              const hbTimer = setInterval(() => {
                updateHeartbeatFn(db, process.pid);
              }, HEARTBEAT_INTERVAL_MS);
              instance.timer = hbTimer; // A-2: heartbeat 타이머 먼저 설정
              instance.coordinator = promotedCoordinator;  // A-2: 타이머 설정 이후에 할당
              instance.watcher = promotedWatcher;           // A-2: 타이머 설정 이후에 할당
              await promotedCoordinator.fullIndex();
            } catch (setupErr) {
              logger.error('[Codeledger] owner promotion failed, reverting to reader', setupErr);
              // SRC-8: cleanup already-started resources before reverting to reader
              if (promotedWatcher) {
                await promotedWatcher.close().catch((e) =>
                  logger.error('[Codeledger] watcher close error during promotion rollback', e),
                );
                instance.watcher = null;
              }
              if (promotedCoordinator) {
                await promotedCoordinator.shutdown().catch((e) =>
                  logger.error('[Codeledger] coordinator shutdown error during promotion rollback', e),
                );
                instance.coordinator = null;
              }
              if (instance.timer === null) { // A-2: hbTimer 미설정 시 healthcheck 복원
                instance.timer = setInterval(healthcheck, HEALTHCHECK_INTERVAL_MS);
              }
            }
          }
        } catch (err) {
          retryCount++; // A-1: 연속 실패 횟수 증가
          logger.error('[Codeledger] healthcheck error', err);
          if (retryCount >= MAX_HEALTHCHECK_RETRIES) { // A-1: 최대 retry 초과 시 종료
            logger.error('[Codeledger] healthcheck failed too many times, shutting down');
            clearInterval(instance.timer!);
            instance.timer = null;
            instance.close().catch((closeErr) =>
              logger.error('[Codeledger] close error during healthcheck shutdown', closeErr),
            );
          }
        }
      };
      const timer = setInterval(healthcheck, HEALTHCHECK_INTERVAL_MS);
      instance.timer = timer;
    }

    // ── 7. Signal handlers ──────────────────────────────────────────────
    const signals: Array<NodeJS.Signals | 'beforeExit'> = ['SIGTERM', 'SIGINT', 'beforeExit'];
    for (const sig of signals) {
      const handler = () => { instance.close().catch(err => logger.error('[Codeledger] close error during signal', sig, err)); };
      if (sig === 'beforeExit') {
        process.on('beforeExit', handler);
      } else {
        process.on(sig, handler);
      }
      instance.signalHandlers.push([sig, handler]);
    }

    return instance;
    } catch (err) {
      db.close();
      throw err;
    }
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    const closeErrors: Error[] = [];

    // Remove signal handlers
    for (const [sig, handler] of this.signalHandlers) {
      if (sig === 'beforeExit') {
        process.off('beforeExit', handler);
      } else {
        process.off(sig as NodeJS.Signals, handler);
      }
    }
    this.signalHandlers = [];

    // Shutdown coordinator if owner
    if (this.coordinator) {
      try {
        await this.coordinator.shutdown();
      } catch (err) {
        closeErrors.push(err instanceof Error ? err : new Error(String(err)));
      }
    }

    // Close watcher if owner
    if (this.watcher) {
      try {
        await this.watcher.close();
      } catch (err) {
        closeErrors.push(err instanceof Error ? err : new Error(String(err)));
      }
    }

    // Clear timer (heartbeat or healthcheck)
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }

    // Release watcher role
    try {
      this.releaseWatcherRoleFn(this.db, process.pid);
    } catch (err) {
      closeErrors.push(err instanceof Error ? err : new Error(String(err)));
    }

    // Close DB
    try {
      this.db.close();
    } catch (err) {
      closeErrors.push(err instanceof Error ? err : new Error(String(err)));
    }

    if (closeErrors.length > 0) {
      throw new AggregateError(closeErrors, 'Codeledger: one or more errors occurred during close()');
    }
  }

  // ── Event subscription ──────────────────────────────────────────────────

  onIndexed(callback: (result: IndexResult) => void): () => void {
    this.onIndexedCallbacks.add(callback);
    if (!this.coordinator) {
      return () => { this.onIndexedCallbacks.delete(callback); };
    }
    const unsubscribe = this.coordinator.onIndexed(callback);
    return () => {
      this.onIndexedCallbacks.delete(callback);
      unsubscribe();
    };
  }

  // ── Stateless API ───────────────────────────────────────────────────────

  parseSource(filePath: string, sourceText: string): ParsedFile {
    if (this.closed) throw new Error('Codeledger: instance is closed');
    const parsed = this.parseSourceFn(filePath, sourceText);
    this.parseCache.set(filePath, parsed);
    return parsed;
  }

  extractSymbols(parsed: ParsedFile): ExtractedSymbol[] {
    if (this.closed) throw new Error('Codeledger: instance is closed');
    return this.extractSymbolsFn(parsed);
  }

  extractRelations(parsed: ParsedFile): CodeRelation[] {
    if (this.closed) throw new Error('Codeledger: instance is closed');
    return this.extractRelationsFn(
      parsed.program,
      parsed.filePath,
      this.tsconfigPaths ?? undefined,
    );
  }

  // ── Search API ──────────────────────────────────────────────────────────

  async reindex(): Promise<IndexResult> {
    if (this.closed) throw new Error('Codeledger: instance is closed');
    if (!this.coordinator) {
      throw new Error('Codeledger: reindex() is not available for readers');
    }
    return this.coordinator.fullIndex();
  }

  get projects(): ProjectBoundary[] {
    return [...this.boundaries];
  }

  getStats(project?: string): SymbolStats {
    if (this.closed) throw new Error('Codeledger: instance is closed');
    return this.symbolRepo.getStats(project ?? this.defaultProject);
  }

  searchSymbols(query: SymbolSearchQuery): SymbolSearchResult[] {
    if (this.closed) throw new Error('Codeledger: instance is closed');
    return this.symbolSearchFn({ symbolRepo: this.symbolRepo, project: this.defaultProject, query });
  }

  searchRelations(query: RelationSearchQuery): CodeRelation[] {
    if (this.closed) throw new Error('Codeledger: instance is closed');
    return this.relationSearchFn({ relationRepo: this.relationRepo, project: this.defaultProject, query });
  }

  // ── Dependency graph helpers ────────────────────────────────────────────

  getDependencies(filePath: string, project?: string, limit = 10_000): string[] {
    if (this.closed) throw new Error('Codeledger: instance is closed');
    return this.relationSearchFn({
      relationRepo: this.relationRepo,
      project: project ?? this.defaultProject,
      query: { srcFilePath: filePath, type: 'imports', project: project ?? this.defaultProject, limit },
    }).map(r => r.dstFilePath);
  }

  getDependents(filePath: string, project?: string, limit = 10_000): string[] {
    if (this.closed) throw new Error('Codeledger: instance is closed');
    return this.relationSearchFn({
      relationRepo: this.relationRepo,
      project: project ?? this.defaultProject,
      query: { dstFilePath: filePath, type: 'imports', project: project ?? this.defaultProject, limit },
    }).map(r => r.srcFilePath);
  }

  async getAffected(changedFiles: string[], project?: string): Promise<string[]> {
    if (this.closed) throw new Error('Codeledger: instance is closed');
    const g = new DependencyGraph({
      relationRepo: this.relationRepo,
      project: project ?? this.defaultProject,
    });
    await g.build();
    return g.getAffectedByChange(changedFiles);
  }

  async hasCycle(project?: string): Promise<boolean> {
    if (this.closed) throw new Error('Codeledger: instance is closed');
    const g = new DependencyGraph({
      relationRepo: this.relationRepo,
      project: project ?? this.defaultProject,
    });
    await g.build();
    return g.hasCycle();
  }
}
