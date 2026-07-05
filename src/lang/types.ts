import type { PositionMap } from './position-map';

/**
 * A language plugin teaches gildash a non-TS source format (e.g. Vue SFC) on
 * BOTH pipeline sides:
 *
 * - **syntax**: `transform` turns raw file text into parseable TS text plus an
 *   exact raw↔virtual {@link PositionMap} (extractor output is remapped to raw
 *   coordinates before storage — the position invariant).
 * - **semantics**: `virtualFiles` provides the TS file set fed to the owning
 *   project's tsc program; the host's virtual-file table then resolves imports
 *   of the raw file (e.g. `./Foo.vue`) to those virtual files (content-aware, so
 *   the plugin does not participate in module resolution itself).
 *
 * TS-family files (`.ts/.mts/.cts/.tsx`) have no plugin: the registry returns
 * `null` and the pipeline bypasses transformation entirely.
 */
export interface LanguagePlugin {
  /** Extensions this plugin owns, lowercase with dot (e.g. `['.vue']`). */
  extensions: string[];
  /** Raw file text → parseable TS text + exact position map + parser dialect. */
  transform(
    filePath: string,
    raw: string,
  ): { parseText: string; map: PositionMap | null; lang?: 'ts' | 'tsx' };
  /** Virtual TS file set for the semantic program (collision-proof names). */
  virtualFiles(filePath: string, raw: string): Array<{ path: string; text: string }>;
}
