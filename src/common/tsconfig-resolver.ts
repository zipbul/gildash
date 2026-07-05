import path from "node:path";

export interface TsconfigPaths {
  baseUrl: string;
  paths: Map<string, string[]>;
}

/** Literal-prefix length of a `paths` pattern (longer = more specific). */
function patternPrefixLength(pattern: string): number {
  const star = pattern.indexOf("*");
  return star === -1 ? pattern.length : star;
}

/**
 * If a tsconfig `paths` `pattern` (at most one `*`) matches `specifier`, return
 * the `*` capture (`''` for an exact, star-less pattern); else `null`.
 */
function matchPathPattern(pattern: string, specifier: string): string | null {
  const star = pattern.indexOf("*");
  if (star === -1) return pattern === specifier ? "" : null;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (
    specifier.length >= prefix.length + suffix.length &&
    specifier.startsWith(prefix) &&
    specifier.endsWith(suffix)
  ) {
    return specifier.slice(prefix.length, specifier.length - suffix.length);
  }
  return null;
}

/**
 * Substituted target module-paths for `specifier` under tsconfig `paths`, using
 * the SINGLE best-matching pattern's targets (in order) — exactly as TypeScript
 * selects: an exact (star-less) pattern wins over any wildcard, and among
 * wildcards the longest literal prefix wins. Only that pattern's targets are
 * returned (no fallback to weaker patterns, matching `tsc`), so the semantic
 * resolver and the import-relation resolver stay identical. Empty when nothing
 * matches. The single source of truth for `paths` matching.
 */
export function matchTsconfigPaths(
  specifier: string,
  patternEntries: Iterable<readonly [string, string[]]>,
): string[] {
  let best: { rank: number; targets: string[]; captured: string } | null = null;
  for (const [pattern, targets] of patternEntries) {
    if (targets.length === 0) continue;
    const captured = matchPathPattern(pattern, specifier);
    if (captured === null) continue;
    // Exact patterns are the most specific (outrank every wildcard).
    const rank = pattern.includes("*") ? patternPrefixLength(pattern) : Number.POSITIVE_INFINITY;
    if (!best || rank > best.rank) best = { rank, targets, captured };
  }
  if (!best) return [];
  return best.targets.map((target) => (target.includes("*") ? target.replace("*", best.captured) : target));
}

/** Subset of `tsconfig.json` we read. The remaining fields are preserved
 *  for the extends-merge via the index signature but otherwise ignored. */
interface TsconfigCompilerOptions {
  baseUrl?: string;
  paths?: Record<string, string[]>;
}
interface TsconfigJson {
  extends?: string;
  compilerOptions?: TsconfigCompilerOptions;
  [key: string]: unknown;
}

const cache = new Map<string, TsconfigPaths | null>();

async function readConfig(configPath: string): Promise<TsconfigJson | null> {
  const file = Bun.file(configPath);
  if (!(await file.exists())) {
    return null;
  }

  try {
    const text = await file.text();
    // `Bun.JSONC.parse` yields untyped JSON; assert the shape we read once here
    // (the single sanctioned boundary cast — every field access below is typed).
    const parsed: unknown = Bun.JSONC.parse(text);
    return typeof parsed === "object" && parsed !== null ? (parsed as TsconfigJson) : null;
  } catch {
    return null;
  }
}

/** Resolve a tsconfig extends value to an absolute config path. */
function resolveExtendsPath(fromDir: string, extendsValue: string): string {
  // Relative path: ./tsconfig.base.json
  if (extendsValue.startsWith('.')) {
    const resolved = path.resolve(fromDir, extendsValue);
    return resolved.endsWith('.json') ? resolved : resolved + '.json';
  }
  // Bare specifier (npm package): try node_modules resolution
  return path.resolve(fromDir, 'node_modules', extendsValue);
}

/** Read a tsconfig and recursively merge extends chain (up to maxDepth). */
async function readConfigWithExtends(
  configPath: string,
  maxDepth: number = 5,
): Promise<TsconfigJson | null> {
  if (maxDepth <= 0) return null;

  const config = await readConfig(configPath);
  if (!config) return null;

  const extendsValue = config.extends;
  if (typeof extendsValue !== 'string' || !extendsValue) return config;

  const parentPath = resolveExtendsPath(path.dirname(configPath), extendsValue);
  const parentConfig = await readConfigWithExtends(parentPath, maxDepth - 1);
  if (!parentConfig) return config;

  // Merge: child compilerOptions override parent compilerOptions
  return {
    ...parentConfig,
    ...config,
    compilerOptions: { ...parentConfig.compilerOptions, ...config.compilerOptions },
  };
}

export async function loadTsconfigPaths(projectRoot: string): Promise<TsconfigPaths | null> {
  if (cache.has(projectRoot)) {
    return cache.get(projectRoot) ?? null;
  }

  const tsconfigPath = path.join(projectRoot, "tsconfig.json");

  const config = await readConfigWithExtends(tsconfigPath);
  if (!config) {
    cache.set(projectRoot, null);
    return null;
  }

  const compilerOptions = config.compilerOptions ?? null;

  if (!compilerOptions) {
    cache.set(projectRoot, null);
    return null;
  }

  const rawBaseUrl = typeof compilerOptions.baseUrl === "string" ? compilerOptions.baseUrl : null;
  const rawPaths =
    typeof compilerOptions.paths === "object" && compilerOptions.paths !== null
      ? compilerOptions.paths
      : null;

  if (!rawBaseUrl && !rawPaths) {
    cache.set(projectRoot, null);
    return null;
  }

  const resolvedBaseUrl = rawBaseUrl ? path.resolve(projectRoot, rawBaseUrl) : projectRoot;
  const paths = new Map<string, string[]>();

  if (rawPaths) {
    for (const [pattern, targets] of Object.entries(rawPaths)) {
      if (!Array.isArray(targets)) {
        continue;
      }

      const normalizedTargets = targets.filter((value): value is string => typeof value === "string");
      paths.set(pattern, normalizedTargets);
    }
  }

  const result: TsconfigPaths = {
    baseUrl: resolvedBaseUrl,
    paths,
  };

  cache.set(projectRoot, result);
  return result;
}

export function clearTsconfigPathsCache(projectRoot?: string): void {
  if (projectRoot) {
    cache.delete(projectRoot);
    return;
  }

  cache.clear();
}
