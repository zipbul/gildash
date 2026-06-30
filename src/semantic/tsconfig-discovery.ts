/**
 * tsconfig-discovery — find the TypeScript projects (tsconfigs) under a root.
 *
 * A monorepo is modelled as one semantic program per governing tsconfig. This
 * module finds those configs by:
 *  - scanning for `tsconfig.json` files (respecting ignore globs), OR using an
 *    explicit caller-provided list (authoritative), and
 *  - following each config's `references` via TypeScript's own parser, so
 *    solution-style roots (`files: []` + `references`) and non-standard
 *    reference targets (e.g. `tsconfig.app.json`) are included.
 *
 * Membership of individual files inside a config (`files`/`include`/`exclude`)
 * is deliberately NOT computed here — routing uses nearest-up directory
 * ({@link SemanticProjectResolver}); discovery only enumerates the configs.
 */

import { realpathSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export interface DiscoveredTsconfig {
  /** Absolute, realpath-normalized path to the tsconfig file. */
  configPath: string;
  /** Absolute directory containing the config. */
  dir: string;
}

export interface DiscoverTsconfigsOptions {
  /** Glob patterns (relative to root) whose matches are skipped during scanning. */
  ignorePatterns?: string[];
  /** Explicit config paths; when given, scanning is skipped and these are authoritative. */
  explicit?: string[];
}

const parseConfigHost: ts.ParseConfigFileHost = {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic: () => { /* discovery tolerates bad configs */ },
};

/** Normalize to a realpath when the file exists, else fall back to the resolved path. */
function canonical(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** Resolve a `references[].path` (dir or file) to its tsconfig file path. */
function resolveReference(configDir: string, refPath: string): string {
  const resolved = path.resolve(configDir, refPath);
  return resolved.endsWith('.json') ? resolved : path.join(resolved, 'tsconfig.json');
}

/** Seed config paths: explicit list, or a scan for `tsconfig.json` under root. */
function seedConfigs(projectRoot: string, options: DiscoverTsconfigsOptions): string[] {
  if (options.explicit && options.explicit.length > 0) {
    return options.explicit.map((c) => path.resolve(projectRoot, c));
  }
  const ignoreGlobs = (options.ignorePatterns ?? []).map((p) => new Bun.Glob(p));
  const seeds: string[] = [];
  try {
    for (const rel of new Bun.Glob('**/tsconfig.json').scanSync({ cwd: projectRoot, followSymlinks: false })) {
      const normalized = rel.split(path.sep).join('/');
      if (ignoreGlobs.some((g) => g.match(normalized))) continue;
      seeds.push(path.join(projectRoot, rel));
    }
  } catch {
    // projectRoot missing/unreadable — no configs to scan; caller falls back.
  }
  return seeds;
}

/**
 * Discover all tsconfig projects under `projectRoot`, following project
 * references. Returns one entry per distinct config, deduplicated by realpath.
 */
export function discoverTsconfigs(
  projectRoot: string,
  options: DiscoverTsconfigsOptions = {},
): DiscoveredTsconfig[] {
  // Dedup by realpath (so two symlinked paths to one config collapse), but store
  // and route on the resolved (non-realpath) path so routing matches query paths,
  // which arrive as `path.resolve(projectRoot, file)` (not realpath-normalized).
  const seenReal = new Set<string>();
  const result: DiscoveredTsconfig[] = [];
  const queue = seedConfigs(projectRoot, options).map((p) => path.resolve(p));

  while (queue.length > 0) {
    const configPath = queue.shift()!;
    const real = canonical(configPath);
    if (seenReal.has(real)) continue;
    seenReal.add(real);

    const dir = path.dirname(configPath);
    result.push({ configPath, dir });

    const parsed = ts.getParsedCommandLineOfConfigFile(configPath, undefined, parseConfigHost);
    for (const ref of parsed?.projectReferences ?? []) {
      const refConfig = resolveReference(dir, ref.path);
      if (!seenReal.has(canonical(refConfig))) queue.push(refConfig);
    }
  }

  return result;
}
