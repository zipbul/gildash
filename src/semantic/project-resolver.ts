/**
 * project-resolver — route a source file to the tsconfig that governs it.
 *
 * A file's governing tsconfig is the **nearest-up** config: the discovered
 * config whose directory is the longest ancestor of the file. This decides
 * which compiler options (and therefore which semantic program) apply to the
 * file. Files with no ancestor config resolve to `null` (no semantic project —
 * callers fall back to program-independent/local handling).
 *
 * Membership of files explicitly listed/excluded by a config is a separate
 * concern handled at discovery time; routing here is purely about which
 * config's *options* govern a given path.
 */

export interface SemanticProjectEntry {
  /** Absolute path to the tsconfig file. */
  configPath: string;
  /** Absolute directory containing the config (its ancestor scope). */
  dir: string;
}

/** Strip a single trailing slash so ancestor checks compare clean boundaries. */
function normalizeDir(dir: string): string {
  return dir.length > 1 && dir.endsWith('/') ? dir.slice(0, -1) : dir;
}

/** True when `dir` is `filePath` itself or a directory ancestor of it. */
function isAncestor(dir: string, filePath: string): boolean {
  return filePath === dir || filePath.startsWith(`${dir}/`);
}

export class SemanticProjectResolver {
  /** Entries sorted by directory length descending, so the first match is nearest-up. */
  readonly #entries: SemanticProjectEntry[];

  constructor(entries: SemanticProjectEntry[]) {
    this.#entries = entries
      .map((e) => ({ configPath: e.configPath, dir: normalizeDir(e.dir) }))
      .sort((a, b) => b.dir.length - a.dir.length);
  }

  /** Return the configPath of the nearest-up governing config, or `null` if none. */
  resolve(absFilePath: string): string | null {
    for (const entry of this.#entries) {
      if (isAncestor(entry.dir, absFilePath)) return entry.configPath;
    }
    return null;
  }

  /**
   * The most general (shortest-directory) config, used as a compiler-options
   * template for program-independent operations on files no config governs.
   */
  rootConfig(): string | null {
    return this.#entries.length > 0 ? this.#entries[this.#entries.length - 1]!.configPath : null;
  }
}
