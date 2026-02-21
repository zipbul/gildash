import type { FileChangeEvent } from '../watcher/types';
import type { ProjectBoundary } from '../common/project-discovery';
import { resolveFileProject, discoverProjects } from '../common/project-discovery';
import { loadTsconfigPaths, clearTsconfigPathsCache } from '../common/tsconfig-resolver';
import type { TsconfigPaths } from '../common/tsconfig-resolver';
import { toAbsolutePath } from '../common/path-utils';
import { hashString } from '../common/hasher';
import { parseSource } from '../parser/parse-source';
import { detectChanges } from './file-indexer';
import { indexFileSymbols } from './symbol-indexer';
import { indexFileRelations } from './relation-indexer';
import type { DbConnection } from '../store/connection';
import type { FileRecord } from '../store/repositories/file.repository';
import type { SymbolRecord } from '../store/repositories/symbol.repository';
import type { RelationRecord } from '../store/repositories/relation.repository';
import type { Logger } from '../codeledger';

// ── Constants ─────────────────────────────────────────────────────────────

export const WATCHER_DEBOUNCE_MS = 100;

// ── Result type ────────────────────────────────────────────────────────────

export interface IndexResult {
  indexedFiles: number;
  removedFiles: number;
  totalSymbols: number;
  totalRelations: number;
  durationMs: number;
  changedFiles: string[];
  deletedFiles: string[];
  failedFiles: string[];
}

// ── Options ────────────────────────────────────────────────────────────────

export interface IndexCoordinatorOptions {
  projectRoot: string;
  boundaries: ProjectBoundary[];
  extensions: string[];
  ignorePatterns: string[];
  dbConnection: { transaction<T>(fn: (tx: DbConnection) => T): T };
  parseCache: {
    set(key: string, value: unknown): void;
    get(key: string): unknown;
    invalidate(key: string): void;
  };
  fileRepo: {
    getFilesMap(project: string): Map<string, FileRecord>;
    getAllFiles(project: string): FileRecord[];
    upsertFile(record: FileRecord): void;
    deleteFile(project: string, filePath: string): void;
  };
  symbolRepo: {
    replaceFileSymbols(project: string, filePath: string, contentHash: string, symbols: ReadonlyArray<Partial<SymbolRecord>>): void;
    getFileSymbols(project: string, filePath: string): SymbolRecord[];
    getByFingerprint(project: string, fingerprint: string): SymbolRecord[];
    deleteFileSymbols(project: string, filePath: string): void;
  };
  relationRepo: {
    replaceFileRelations(project: string, filePath: string, relations: ReadonlyArray<Partial<RelationRecord>>): void;
    retargetRelations(project: string, oldFile: string, oldSymbol: string | null, newFile: string, newSymbol: string | null): void;
    deleteFileRelations(project: string, filePath: string): void;
  };
  /** DI seam for parseSource — defaults to the real implementation. */
  parseSourceFn?: typeof parseSource;
  /** DI seam for discoverProjects — defaults to the real implementation. */
  discoverProjectsFn?: typeof discoverProjects;
  /** Logger instance — defaults to console. */
  logger?: Logger;
}

// ── IndexCoordinator ───────────────────────────────────────────────────────

export class IndexCoordinator {
  private readonly opts: IndexCoordinatorOptions;
  private readonly logger: Logger;

  /** Registered post-index callbacks. */
  private readonly callbacks = new Set<(result: IndexResult) => void>();

  /** Prevents concurrent indexing operations. */
  private indexingLock = false;

  /** Buffer for watcher events received while indexing is in progress. */
  private pendingEvents: FileChangeEvent[] = [];

  /** Handle to the active debounce timer (fake or real). */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** The currently running indexing promise (for shutdown). */
  private currentIndexing: Promise<IndexResult> | null = null;

  /** Set to true when fullIndex() is called while the lock is active (queued). */
  private pendingFullIndex = false;

  /** Promises waiting for queued fullIndex completion while a run is in progress. */
  private pendingFullIndexWaiters: Array<{ resolve: (r: IndexResult) => void; reject: (e: unknown) => void }> = [];

  /** Resolved tsconfig path mappings promise loaded from tsconfig-resolver. */
  private tsconfigPathsRaw: Promise<TsconfigPaths | null>;

  /** Pending boundaries refresh (resolved async). */
  private boundariesRefresh: Promise<void> | null = null;

  constructor(opts: IndexCoordinatorOptions) {
    this.opts = opts;
    this.logger = opts.logger ?? console;
    // Load tsconfig paths on construction — result may be a Promise or null.
    this.tsconfigPathsRaw = loadTsconfigPaths(opts.projectRoot);
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /** Exposes current tsconfig paths promise (used by Codeledger.extractRelations). */
  get tsconfigPaths(): Promise<TsconfigPaths | null> {
    return this.tsconfigPathsRaw;
  }

  /** Full re-index: runs detectChanges then processes all changed files. */
  fullIndex(): Promise<IndexResult> {
    return this.startIndex(undefined, true);
  }

  /**
   * Incremental index:
   *  - With explicit events → processes those files directly.
   *  - Without events → calls detectChanges to discover changes.
   */
  incrementalIndex(events?: FileChangeEvent[]): Promise<IndexResult> {
    return this.startIndex(events, false);
  }

  /** Registers a callback to fire after each indexing run. Returns unsubscribe. */
  onIndexed(cb: (result: IndexResult) => void): () => void {
    this.callbacks.add(cb);
    return () => this.callbacks.delete(cb);
  }

  /** Handles a raw watcher event with debouncing. */
  handleWatcherEvent(event: FileChangeEvent): void {
    // tsconfig.json change → reload paths and trigger full re-index.
    if (event.filePath.endsWith('tsconfig.json')) {
      clearTsconfigPathsCache(this.opts.projectRoot);
      this.tsconfigPathsRaw = loadTsconfigPaths(this.opts.projectRoot);
      this.fullIndex().catch((err) => {
        this.logger.error('[IndexCoordinator] fullIndex failed after tsconfig change:', err);
      });
      return;
    }

    // package.json change → refresh project boundaries.
    if (event.filePath.endsWith('package.json')) {
      const discover = this.opts.discoverProjectsFn ?? discoverProjects;
      this.boundariesRefresh = discover(this.opts.projectRoot).then((b) => {
        this.opts.boundaries = b;
      });
    }

    this.pendingEvents.push(event);

    // Only start the debounce timer once — do not restart if already pending.
    if (this.debounceTimer === null) {
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.flushPending();
      }, WATCHER_DEBOUNCE_MS);
    }
  }

  /** Waits for any in-flight indexing to complete then stops all activity. */
  async shutdown(): Promise<void> {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.currentIndexing) {
      await this.currentIndexing;
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /** Starts an indexing run and maintains the lock / pending queue. */
  private startIndex(events: FileChangeEvent[] | undefined, useTransaction: boolean): Promise<IndexResult> {
    if (this.indexingLock) {
      if (useTransaction) {
        this.pendingFullIndex = true;
        return new Promise<IndexResult>((resolve, reject) => {
          this.pendingFullIndexWaiters.push({ resolve, reject });
        });
      }
      return this.currentIndexing!;
    }
    this.indexingLock = true;

    const work = this.doIndex(events, useTransaction)
      .then((result) => {
        this.fireCallbacks(result);
        return result;
      })
      .finally(() => {
        this.indexingLock = false;
        this.currentIndexing = null;
        // Drain: pending fullIndex takes priority over incremental events.
        if (this.pendingFullIndex) {
          this.pendingFullIndex = false;
          const waiters = this.pendingFullIndexWaiters.splice(0);
          this.startIndex(undefined, true)
            .then((result) => {
              for (const waiter of waiters) waiter.resolve(result);
            })
            .catch((error) => {
              for (const waiter of waiters) waiter.reject(error);
            });
        } else if (this.pendingEvents.length > 0) {
          const drained = this.pendingEvents.splice(0);
          this.startIndex(drained, false).catch((err) =>
            this.logger.error('[IndexCoordinator] incremental drain error', err),
          );
        }
      });

    this.currentIndexing = work;
    return work;
  }

  /** Core indexing logic — determines what to process, then processes it. */
  private async doIndex(events: FileChangeEvent[] | undefined, useTransaction: boolean): Promise<IndexResult> {
    const start = Date.now();
    const { fileRepo, symbolRepo, relationRepo, dbConnection } = this.opts;

    // Await any pending boundaries refresh.
    if (this.boundariesRefresh) {
      await this.boundariesRefresh;
      this.boundariesRefresh = null;
    }

    let changed: Array<{ filePath: string; contentHash: string; mtimeMs: number; size: number }>;
    let deleted: string[];

    if (events !== undefined) {
      // Explicit event list — classify by event type.
      // NOTE: No preceding `await` so the lock test can verify detectChanges is
      //       NOT called in this branch.
      changed = events
        .filter((e) => e.eventType === 'create' || e.eventType === 'change')
        .map((e) => ({
          filePath: e.filePath,
          contentHash: '',   // computed below during processing
          mtimeMs: 0,
          size: 0,
        }));
      deleted = events.filter((e) => e.eventType === 'delete').map((e) => e.filePath);
    } else {
      // No explicit events — aggregate existingMap from all boundaries then call detectChanges.
      const existingMap = new Map<string, FileRecord>();
      for (const boundary of this.opts.boundaries) {
        for (const [key, val] of fileRepo.getFilesMap(boundary.project)) {
          existingMap.set(key, val);
        }
      }
      const result = await detectChanges({
        projectRoot: this.opts.projectRoot,
        extensions: this.opts.extensions,
        ignorePatterns: this.opts.ignorePatterns,
        fileRepo: { getFilesMap: () => existingMap },
      });
      changed = result.changed;
      deleted = result.deleted;
    }

    // Resolve tsconfig paths after the detect step.
    const tsconfigPaths = (await this.tsconfigPathsRaw) ?? undefined;

    // ── Move detection: collect fingerprints of deleted symbols BEFORE deletion ──
    const deletedSymbols = new Map<string, SymbolRecord[]>();
    for (const filePath of deleted) {
      const project = resolveFileProject(filePath, this.opts.boundaries);
      const syms = symbolRepo.getFileSymbols(project, filePath);
      deletedSymbols.set(filePath, syms);
    }

    // ── Delete removed files ──────────────────────────────────────────────
    const processDeleted = () => {
      for (const filePath of deleted) {
        const project = resolveFileProject(filePath, this.opts.boundaries);
        symbolRepo.deleteFileSymbols(project, filePath);
        relationRepo.deleteFileRelations(project, filePath);
        fileRepo.deleteFile(project, filePath);
      }
    };

    // ── Index changed / new files ─────────────────────────────────────────
    const processChanged = async (): Promise<{ symbols: number; relations: number; failedFiles: string[] }> => {
      let symbols = 0;
      let relations = 0;
      const failedFiles: string[] = [];
      for (const file of changed) {
        try {
          const r = await this.processFile(file.filePath, file.contentHash || undefined, tsconfigPaths);
          symbols += r.symbolCount;
          relations += r.relCount;
        } catch (err) {
          this.logger.error(`[IndexCoordinator] Failed to index ${file.filePath}:`, err);
          failedFiles.push(file.filePath);
        }
      }
      return { symbols, relations, failedFiles };
    };

    let totalSymbols = 0;
    let totalRelations = 0;
    let allFailedFiles: string[] = [];

    if (useTransaction) {
      // CRIT-2: Pre-read files async BEFORE the transaction (bun:sqlite tx must be sync).
      const { projectRoot, boundaries } = this.opts;
      const { parseCache } = this.opts;
      const prereadResults = await Promise.allSettled(
        changed.map(async (file) => {
          const absPath = toAbsolutePath(projectRoot, file.filePath);
          const bunFile = Bun.file(absPath);
          const text = await bunFile.text();
          const contentHash = file.contentHash || hashString(text);
          return { filePath: file.filePath, text, contentHash, mtimeMs: bunFile.lastModified, size: bunFile.size };
        }),
      );
      const preread = prereadResults
        .filter((r): r is PromiseFulfilledResult<{ filePath: string; text: string; contentHash: string; mtimeMs: number; size: number }> => r.status === 'fulfilled')
        .map((r) => r.value);
      for (const r of prereadResults) {
        if (r.status === 'rejected') {
          this.logger.error('[IndexCoordinator] Failed to pre-read file:', r.reason);
        }
      }

      const parsedCacheEntries: Array<{ filePath: string; parsed: unknown }> = [];

      // Atomic: delete all existing + re-index all changed in ONE transaction.
      dbConnection.transaction(() => {
        for (const boundary of boundaries) {
          const projectFiles = fileRepo.getAllFiles(boundary.project);
          for (const f of projectFiles) {
            fileRepo.deleteFile(f.project, f.filePath);
          }
        }
        const parseFn = this.opts.parseSourceFn ?? parseSource;
        for (const fd of preread) {
          const project = resolveFileProject(fd.filePath, boundaries);
          const parsed = parseFn(toAbsolutePath(projectRoot, fd.filePath), fd.text);
          parsedCacheEntries.push({ filePath: fd.filePath, parsed });
          fileRepo.upsertFile({
            project,
            filePath: fd.filePath,
            mtimeMs: fd.mtimeMs,
            size: fd.size,
            contentHash: fd.contentHash,
            updatedAt: new Date().toISOString(),
          });
          indexFileSymbols({ parsed, project, filePath: fd.filePath, contentHash: fd.contentHash, symbolRepo });
          totalRelations += indexFileRelations({
            ast: parsed.program,
            project,
            filePath: fd.filePath,
            relationRepo,
            projectRoot,
            tsconfigPaths,
          });
          totalSymbols += symbolRepo.getFileSymbols(project, fd.filePath).length;
        }
      });

      for (const entry of parsedCacheEntries) {
        parseCache.set(entry.filePath, entry.parsed);
      }
    } else {
      processDeleted();
      const counts = await processChanged();
      totalSymbols = counts.symbols;
      totalRelations = counts.relations;
      allFailedFiles = counts.failedFiles;
    }

    // ── Move detection: retarget relations ────────────────────────────────
    if (!useTransaction) {
      for (const [oldFile, syms] of deletedSymbols) {
        for (const sym of syms) {
          if (!sym.fingerprint) continue;
          const oldProject = resolveFileProject(oldFile, this.opts.boundaries);
          const matches = symbolRepo.getByFingerprint(oldProject, sym.fingerprint);
          if (matches.length === 1) {
            const newSym = matches[0]!;
            relationRepo.retargetRelations(
              oldProject,
              oldFile,
              sym.name,
              newSym.filePath,
              newSym.name,
            );
          }
        }
      }
    }

    return {
      indexedFiles: changed.length,
      removedFiles: deleted.length,
      totalSymbols,
      totalRelations,
      durationMs: Date.now() - start,
      changedFiles: changed.map((f) => f.filePath),
      deletedFiles: [...deleted],
      failedFiles: allFailedFiles,
    };
  }

  /** Reads, parses, and indexes a single file. Returns symbol and relation counts. */
  private async processFile(
    filePath: string,
    knownHash: string | undefined,
    tsconfigPaths: TsconfigPaths | undefined,
  ): Promise<{ symbolCount: number; relCount: number }> {
    const { projectRoot, boundaries } = this.opts;
    const { fileRepo, symbolRepo, relationRepo, parseCache } = this.opts;

    const absPath = toAbsolutePath(projectRoot, filePath);
    const bunFile = Bun.file(absPath);
    const text = await bunFile.text();
    const contentHash = knownHash || hashString(text);

    const project = resolveFileProject(filePath, boundaries);

    // ── Parse ──────────────────────────────────────────────────────────────
    const parseFn = this.opts.parseSourceFn ?? parseSource;
    const parsed = parseFn(absPath, text);
    parseCache.set(filePath, parsed);

    // ── Upsert file record ─────────────────────────────────────────────────
    fileRepo.upsertFile({
      project,
      filePath,
      mtimeMs: bunFile.lastModified,
      size: bunFile.size,
      contentHash,
      updatedAt: new Date().toISOString(),
    });

    // ── Index symbols ──────────────────────────────────────────────────────
    indexFileSymbols({ parsed, project, filePath, contentHash, symbolRepo });

    // ── Index relations ────────────────────────────────────────────────────
    const relCount = indexFileRelations({
      ast: parsed.program,
      project,
      filePath,
      relationRepo,
      projectRoot,
      tsconfigPaths,
    });

    const symbolCount = symbolRepo.getFileSymbols(project, filePath).length;
    return { symbolCount, relCount };
  }

  /** Fires all registered callbacks, logging but not propagating errors. */
  private fireCallbacks(result: IndexResult): void {
    for (const cb of this.callbacks) {
      try {
        cb(result);
      } catch (err) {
        this.logger.error('[IndexCoordinator] onIndexed callback threw:', err);
      }
    }
  }

  /** Called when the debounce timer fires. */
  private flushPending(): void {
    if (this.indexingLock) {
      // Lock is active — events remain in pendingEvents and will be consumed
      // by the finally block of the in-flight indexing run.
      return;
    }
    if (this.pendingEvents.length > 0) {
      const events = this.pendingEvents.splice(0);
      this.startIndex(events, false).catch((err) =>
        this.logger.error('[IndexCoordinator] flushPending startIndex error:', err),
      );
    }
  }
}
