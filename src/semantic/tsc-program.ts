/**
 * TscProgram — tsc Program/TypeChecker/LanguageService lifecycle manager.
 *
 * Wraps `ts.createLanguageService()` with a custom `LanguageServiceHost`
 * that tracks file versions in-memory for incremental updates.
 *
 * All I/O is injected via the `TscProgramOptions` DI parameters so that
 * unit tests can run without touching the filesystem.
 */

import ts from "typescript";
import path from "node:path";
import { err, type Result } from "@zipbul/result";
import { GildashError } from "../errors";
import type { LanguagePluginRegistry } from "../lang/registry";
import type { PositionMap } from "../lang/position-map";
import { buildLineOffsets, getLineColumn } from "../parser/source-position";
import { matchTsconfigPaths } from "../common/tsconfig-resolver";

// ── DI contracts ─────────────────────────────────────────────────────────────

/**
 * Reads a file at `path` and returns its content, or `undefined` if missing.
 */
export type ReadConfigFileFn = (path: string) => string | undefined;

/**
 * Resolves content for files NOT tracked by the user project
 * (e.g. TypeScript lib declarations on disk).
 * Returns file content or `undefined` if not found.
 */
export type ResolveNonTrackedFileFn = (path: string) => string | undefined;

export interface TscProgramOptions {
  /** Reads tsconfig.json content. Injected for testability. */
  readConfigFile?: ReadConfigFileFn;
  /** Resolves non-tracked files (ts libs, node_modules). Injected for testability. */
  resolveNonTrackedFile?: ResolveNonTrackedFileFn;
  /**
   * Language plugins (e.g. Vue SFC). Raw plugin-owned files notified via
   * `notifyFileChanged` are expanded into virtual TS files, and imports of
   * plugin-owned specifiers resolve through the host's virtual-file table.
   */
  registry?: LanguagePluginRegistry;
}

// ── Default I/O (Bun fs) ────────────────────────────────────────────────────

function defaultReadConfigFile(filePath: string): string | undefined {
  try {
    // Synchronous read — ts.readConfigFile expects sync callback
    const fs = require("node:fs");
    return fs.readFileSync(filePath, "utf-8") as string;
  } catch {
    return undefined;
  }
}

function defaultResolveNonTrackedFile(filePath: string): string | undefined {
  try {
    const fs = require("node:fs");
    return fs.readFileSync(filePath, "utf-8") as string;
  } catch {
    return undefined;
  }
}

// ── TscProgram ──────────────────────────────────────────────────────────────

export class TscProgram {
  #languageService: ts.LanguageService;
  #host: TscLanguageServiceHost;
  #isDisposed = false;

  // ── Testing hook ────────────────────────────────────────────────────────

  /** @internal — exposed for unit test verification only. */
  readonly __testing__: { host: ts.LanguageServiceHost };

  private constructor(languageService: ts.LanguageService, host: TscLanguageServiceHost) {
    this.#languageService = languageService;
    this.#host = host;
    this.__testing__ = { host };
  }

  /**
   * Create a TscProgram from a tsconfig.json path.
   *
   * Parses the config, creates a LanguageServiceHost, and initializes the LanguageService.
   * Returns `Err<GildashError>` on config read/parse failure.
   */
  static create(
    tsconfigPath: string,
    options: TscProgramOptions = {},
  ): Result<TscProgram, GildashError> {
    const readConfigFn = options.readConfigFile ?? defaultReadConfigFile;
    const resolveNonTracked = options.resolveNonTrackedFile ?? defaultResolveNonTrackedFile;

    const projectDir = path.dirname(tsconfigPath);

    // 1. Read tsconfig.json content
    const configContent = readConfigFn(tsconfigPath);
    if (configContent === undefined) {
      return err(new GildashError("semantic", `tsconfig not found: ${tsconfigPath}`));
    }

    // 2. Parse JSON via ts.parseJsonText (handles JSONC comments)
    const jsonSourceFile = ts.parseJsonText(tsconfigPath, configContent);

    // parseDiagnostics exists at runtime on every SourceFile but is not in the public typings.
    const parseDiags = (jsonSourceFile as unknown as { parseDiagnostics?: ts.Diagnostic[] })
      .parseDiagnostics;
    if (parseDiags && parseDiags.length > 0) {
      const msg = parseDiags
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))
        .join("; ");
      return err(new GildashError("semantic", `tsconfig parse error: ${msg}`));
    }

    // 3. Parse config content into compilerOptions + fileNames
    const parsed = ts.parseJsonSourceFileConfigFileContent(
      jsonSourceFile,
      {
        useCaseSensitiveFileNames: true,
        readDirectory: () => [],
        fileExists: (p) => readConfigFn(p) !== undefined || resolveNonTracked(p) !== undefined,
        readFile: (p) => readConfigFn(p) ?? resolveNonTracked(p),
      },
      projectDir,
    );

    if (parsed.errors.length > 0) {
      // TS18003 "No inputs were found in config file" is expected — files are added
      // dynamically via notifyFileChanged, so the initial program has no source files.
      const fatalErrors = parsed.errors.filter(
        (d) => d.category === ts.DiagnosticCategory.Error && d.code !== 18003,
      );
      if (fatalErrors.length > 0) {
        const msg = fatalErrors
          .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))
          .join("; ");
        return err(new GildashError("semantic", `tsconfig compile error: ${msg}`));
      }
    }

    // 4. Create the host + LanguageService
    const host = new TscLanguageServiceHost(
      parsed.fileNames,
      parsed.options,
      projectDir,
      resolveNonTracked,
      options.registry ?? null,
    );

    const languageService = ts.createLanguageService(host);

    return new TscProgram(languageService, host);
  }

  // ── Public API ──────────────────────────────────────────────────────────

  get isDisposed(): boolean {
    return this.#isDisposed;
  }

  getProgram(): ts.Program {
    this.#assertNotDisposed();
    const program = this.#languageService.getProgram();
    if (!program) {
      throw new Error("TscProgram: LanguageService returned null Program");
    }
    return program;
  }

  /**
   * The project's compiler options, read from the host without forcing a
   * Program sync (so callers that don't need the Program stay cheap).
   */
  getCompilerOptions(): ts.CompilerOptions {
    this.#assertNotDisposed();
    return this.#host.getCompilationSettings();
  }

  getLanguageService(): ts.LanguageService {
    this.#assertNotDisposed();
    return this.#languageService;
  }

  /**
   * Notify that a file's content has changed (or a new file was added).
   * Bumps the internal version so the LanguageService will re-evaluate on next query.
   *
   * No-op if already disposed.
   */
  notifyFileChanged(filePath: string, content: string): void {
    if (this.#isDisposed) return;
    this.#host.updateFile(filePath, content);
  }

  /**
   * Remove a tracked file from the LanguageService host.
   * After removal the file will no longer appear in `getScriptFileNames()`
   * and `getScriptSnapshot()` will return `undefined` for it.
   *
   * No-op if already disposed or the file was never tracked.
   */
  removeFile(filePath: string): void {
    if (this.#isDisposed) return;
    this.#host.removeFile(filePath);
  }

  // ── Raw↔virtual coordinate translation (language plugins) ────────────────
  // The public semantic boundary speaks RAW file coordinates; sub-modules and
  // the TypeChecker speak virtual. These delegates are the only bridge.

  /** Query-side: raw plugin file → its virtual module + offset translation. */
  getVirtualTarget(rawPath: string): VirtualTarget | null {
    return this.#host.getVirtualTarget(rawPath);
  }

  /** Result-side: any program fileName/position → raw location (identity for plain files). */
  toRawLocation(fileName: string, position: number): { filePath: string; position: number } | null {
    return this.#host.toRawLocation(fileName, position);
  }

  /** Raw line/column (1-based line, 0-based column) for a raw offset in a plugin file. */
  rawLineColumn(rawPath: string, offset: number): { line: number; column: number } | null {
    return this.#host.rawLineColumn(rawPath, offset);
  }

  /** Raw offset for a raw line/column in a plugin file. */
  rawOffsetOf(rawPath: string, line: number, column: number): number | null {
    return this.#host.rawOffsetOf(rawPath, line, column);
  }

  /**
   * Dispose the LanguageService and release references.
   * Idempotent — safe to call multiple times.
   */
  dispose(): void {
    if (this.#isDisposed) return;
    this.#isDisposed = true;
    this.#languageService.dispose();
  }

  #assertNotDisposed(): void {
    if (this.#isDisposed) {
      throw new Error("TscProgram is disposed");
    }
  }
}

// ── LanguageServiceHost ─────────────────────────────────────────────────────

interface VirtualEntry {
  paths: string[];
  map: PositionMap | null;
  rawText: string;
  parseText: string;
  rawLineOffsets: number[] | null;
  virtualLineOffsets: number[] | null;
}

/** Query-side handle for a raw plugin file inside a program. */
export interface VirtualTarget {
  virtualPath: string;
  toVirtualOffset(rawOffset: number): number | null;
  toVirtualEndOffset(rawOffset: number): number | null;
}

class TscLanguageServiceHost implements ts.LanguageServiceHost {
  #rootFileNames: Set<string>;
  #compilerOptions: ts.CompilerOptions;
  #projectDir: string;
  #resolveNonTracked: ResolveNonTrackedFileFn;

  /** tracked file path → { version: number, content: string } */
  #files = new Map<string, { version: number; content: string }>();
  /** Cached snapshots for tracked files: "path:version" → snapshot */
  #snapshotCache = new Map<string, ts.IScriptSnapshot>();
  /** Cached snapshots for non-tracked files (lib.d.ts, node_modules): path → snapshot */
  #nonTrackedSnapshotCache = new Map<string, ts.IScriptSnapshot>();

  /** Language plugin registry, or null when no plugins are configured. */
  #registry: LanguagePluginRegistry | null;
  /** raw plugin-owned path → its virtual expansion + coordinate map. */
  #virtualTable = new Map<string, VirtualEntry>();
  /** virtual file path → owning raw path (result-side reverse lookup). */
  #virtualToRaw = new Map<string, string>();

  constructor(
    rootFileNames: string[],
    compilerOptions: ts.CompilerOptions,
    projectDir: string,
    resolveNonTracked: ResolveNonTrackedFileFn,
    registry: LanguagePluginRegistry | null = null,
  ) {
    this.#rootFileNames = new Set(rootFileNames);
    this.#compilerOptions = compilerOptions;
    this.#projectDir = projectDir;
    this.#resolveNonTracked = resolveNonTracked;
    this.#registry = registry;
    if (registry) {
      // Defined only when plugins exist, so plugin-less hosts keep TS's
      // built-in resolution path entirely untouched.
      this.resolveModuleNameLiterals = (literals, containingFile, _redirected, opts) =>
        literals.map((literal) => this.#resolveLiteral(literal.text, containingFile, opts));
    }
  }

  /** Present only when a registry exists (see constructor). */
  declare resolveModuleNameLiterals?: (
    literals: readonly ts.StringLiteralLike[],
    containingFile: string,
    redirectedReference: ts.ResolvedProjectReference | undefined,
    options: ts.CompilerOptions,
  ) => ts.ResolvedModuleWithFailedLookupLocations[];

  #resolveLiteral(
    specifier: string,
    containingFile: string,
    options: ts.CompilerOptions,
  ): ts.ResolvedModuleWithFailedLookupLocations {
    if (this.#registry?.pluginFor(specifier)) {
      // TS cannot resolve plugin extensions (`.vue`/`.svelte`), so map the
      // specifier to a raw path ourselves — honoring relative imports AND the
      // tsconfig `baseUrl`/`paths` aliases that Vite/Nuxt/SvelteKit rely on —
      // then look it up in the virtual-file table.
      for (const rawPath of this.#pluginRawCandidates(specifier, containingFile, options)) {
        const virtual = this.#virtualTable.get(rawPath)?.paths[0];
        if (virtual) {
          return {
            resolvedModule: {
              resolvedFileName: virtual,
              extension: virtual.endsWith('.tsx') ? ts.Extension.Tsx : ts.Extension.Ts,
              isExternalLibraryImport: false,
            },
          };
        }
      }
      return { resolvedModule: undefined };
    }
    return ts.resolveModuleName(specifier, containingFile, options, {
      fileExists: (f) => this.fileExists(f),
      readFile: (f) => this.readFile(f),
    });
  }

  /**
   * Ordered raw-path candidates a plugin import specifier may refer to. Relative
   * specifiers resolve against the importer; non-relative ones honor tsconfig
   * `paths` (longest-matching pattern first) then a `baseUrl`-relative fallback,
   * mirroring TypeScript's own module resolution for extensions TS can't handle.
   */
  #pluginRawCandidates(specifier: string, containingFile: string, options: ts.CompilerOptions): string[] {
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      return [path.resolve(path.dirname(containingFile), specifier)];
    }
    const base = options.baseUrl ?? this.#projectDir;
    const candidates = matchTsconfigPaths(specifier, Object.entries(options.paths ?? {}))
      .map((target) => path.resolve(base, target));
    // baseUrl-relative bare specifier as a final fallback.
    candidates.push(path.resolve(base, specifier));
    return candidates;
  }

  // ── File tracking ───────────────────────────────────────────────────────

  updateFile(filePath: string, content: string): void {
    const plugin = this.#registry?.pluginFor(filePath);
    if (plugin) {
      // Raw plugin-owned file: track its VIRTUAL expansion, never the raw text
      // (tsc cannot parse it). Stale virtual names (e.g. a lang flip changing
      // .ts → .tsx) are retired so the program never serves outdated modules.
      const virtuals = plugin.virtualFiles(filePath, content);
      const { map, parseText } = plugin.transform(filePath, content);
      const nextPaths = virtuals.map((v) => v.path);
      for (const stale of this.#virtualTable.get(filePath)?.paths ?? []) {
        if (!nextPaths.includes(stale)) {
          this.#removeTracked(stale);
          this.#virtualToRaw.delete(stale);
        }
      }
      for (const v of virtuals) {
        this.#setTracked(v.path, v.text);
        this.#virtualToRaw.set(v.path, filePath);
      }
      this.#virtualTable.set(filePath, {
        paths: nextPaths,
        map,
        rawText: content,
        parseText,
        rawLineOffsets: null,
        virtualLineOffsets: null,
      });
      return;
    }
    this.#setTracked(filePath, content);
  }

  #setTracked(filePath: string, content: string): void {
    const existing = this.#files.get(filePath);
    if (existing) {
      // Idempotent: identical content is a no-op, so the version is not bumped
      // and the next query does not trigger a needless Program recompute.
      if (existing.content === content) return;
      // Remove stale snapshot cache entry
      this.#snapshotCache.delete(`${filePath}:${existing.version}`);
      existing.version += 1;
      existing.content = content;
    } else {
      this.#files.set(filePath, { version: 1, content });
    }
  }

  removeFile(filePath: string): void {
    const entry = this.#virtualTable.get(filePath);
    if (entry) {
      for (const v of entry.paths) {
        this.#removeTracked(v);
        this.#virtualToRaw.delete(v);
      }
      this.#virtualTable.delete(filePath);
      return;
    }
    this.#removeTracked(filePath);
  }

  // ── Raw↔virtual translation ──────────────────────────────────────────────

  getVirtualTarget(rawPath: string): VirtualTarget | null {
    const entry = this.#virtualTable.get(rawPath);
    const virtualPath = entry?.paths[0];
    if (!entry || !virtualPath) return null;
    return {
      virtualPath,
      toVirtualOffset: (offset) => entry.map?.toVirtual(offset) ?? null,
      toVirtualEndOffset: (offset) => entry.map?.toVirtualEnd(offset) ?? null,
    };
  }

  toRawLocation(fileName: string, position: number): { filePath: string; position: number } | null {
    const rawPath = this.#virtualToRaw.get(fileName);
    if (rawPath === undefined) return { filePath: fileName, position };
    const rawPosition = this.#virtualTable.get(rawPath)?.map?.toRaw(position) ?? null;
    return rawPosition === null ? null : { filePath: rawPath, position: rawPosition };
  }

  rawLineColumn(rawPath: string, offset: number): { line: number; column: number } | null {
    const entry = this.#virtualTable.get(rawPath);
    if (!entry) return null;
    entry.rawLineOffsets ??= buildLineOffsets(entry.rawText);
    return getLineColumn(entry.rawLineOffsets, offset);
  }

  rawOffsetOf(rawPath: string, line: number, column: number): number | null {
    const entry = this.#virtualTable.get(rawPath);
    if (!entry) return null;
    entry.rawLineOffsets ??= buildLineOffsets(entry.rawText);
    const lineStart = entry.rawLineOffsets[line - 1];
    return lineStart === undefined ? null : lineStart + column;
  }

  #removeTracked(filePath: string): void {
    const existing = this.#files.get(filePath);
    if (existing) {
      this.#snapshotCache.delete(`${filePath}:${existing.version}`);
    }
    this.#files.delete(filePath);
    this.#rootFileNames.delete(filePath);
  }

  // ── ts.LanguageServiceHost implementation ───────────────────────────────

  getScriptFileNames(): string[] {
    const tracked = [...this.#files.keys()];
    const rootsNotTracked = [...this.#rootFileNames].filter((f) => !this.#files.has(f));
    return [...rootsNotTracked, ...tracked];
  }

  getScriptVersion(fileName: string): string {
    const entry = this.#files.get(fileName);
    return entry ? String(entry.version) : "0";
  }

  getScriptSnapshot(fileName: string): ts.IScriptSnapshot | undefined {
    // 1. Tracked files — cache by path:version
    const entry = this.#files.get(fileName);
    if (entry) {
      const cacheKey = `${fileName}:${entry.version}`;
      let snapshot = this.#snapshotCache.get(cacheKey);
      if (!snapshot) {
        snapshot = ts.ScriptSnapshot.fromString(entry.content);
        this.#snapshotCache.set(cacheKey, snapshot);
      }
      return snapshot;
    }

    // 2. Non-tracked files (ts libs, node_modules) — cache permanently
    let snapshot = this.#nonTrackedSnapshotCache.get(fileName);
    if (snapshot) return snapshot;

    const content = this.#resolveNonTracked(fileName);
    if (content !== undefined) {
      snapshot = ts.ScriptSnapshot.fromString(content);
      this.#nonTrackedSnapshotCache.set(fileName, snapshot);
      return snapshot;
    }

    return undefined;
  }

  getCurrentDirectory(): string {
    return this.#projectDir;
  }

  getCompilationSettings(): ts.CompilerOptions {
    return this.#compilerOptions;
  }

  getDefaultLibFileName(options: ts.CompilerOptions): string {
    return ts.getDefaultLibFilePath(options);
  }

  fileExists(filePath: string): boolean {
    if (this.#files.has(filePath)) return true;
    return this.#resolveNonTracked(filePath) !== undefined;
  }

  readFile(filePath: string): string | undefined {
    const entry = this.#files.get(filePath);
    if (entry) return entry.content;
    return this.#resolveNonTracked(filePath);
  }
}
