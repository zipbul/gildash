import path from "node:path";

export interface TsconfigPaths {
  baseUrl: string;
  paths: Map<string, string[]>;
}

const cache = new Map<string, TsconfigPaths | null>();

async function readConfig(configPath: string): Promise<Record<string, unknown> | null> {
  const file = Bun.file(configPath);
  if (!(await file.exists())) {
    return null;
  }

  try {
    const text = await file.text();
    const parsed = Bun.JSONC.parse(text);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
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
): Promise<Record<string, unknown> | null> {
  if (maxDepth <= 0) return null;

  const config = await readConfig(configPath);
  if (!config) return null;

  const extendsValue = config.extends;
  if (typeof extendsValue !== 'string' || !extendsValue) return config;

  const parentPath = resolveExtendsPath(path.dirname(configPath), extendsValue);
  const parentConfig = await readConfigWithExtends(parentPath, maxDepth - 1);
  if (!parentConfig) return config;

  // Merge: child compilerOptions override parent compilerOptions
  const parentCompilerOptions =
    typeof parentConfig.compilerOptions === 'object' && parentConfig.compilerOptions !== null
      ? (parentConfig.compilerOptions as Record<string, unknown>)
      : {};
  const childCompilerOptions =
    typeof config.compilerOptions === 'object' && config.compilerOptions !== null
      ? (config.compilerOptions as Record<string, unknown>)
      : {};

  return {
    ...parentConfig,
    ...config,
    compilerOptions: { ...parentCompilerOptions, ...childCompilerOptions },
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

  const compilerOptions =
    typeof config.compilerOptions === "object" && config.compilerOptions !== null
      ? (config.compilerOptions as Record<string, unknown>)
      : null;

  if (!compilerOptions) {
    cache.set(projectRoot, null);
    return null;
  }

  const rawBaseUrl = typeof compilerOptions.baseUrl === "string" ? compilerOptions.baseUrl : null;
  const rawPaths =
    typeof compilerOptions.paths === "object" && compilerOptions.paths !== null
      ? (compilerOptions.paths as Record<string, unknown>)
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
