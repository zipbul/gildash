import path from "node:path";

/**
 * Normalize a file path to always use forward slashes.
 *
 * On Windows, Node.js `path.resolve` / `path.relative` return backslash
 * separators.  Gildash stores and returns forward-slash paths exclusively,
 * so every path that enters the system must pass through this function.
 */
export function normalizePath(p: string): string {
  return p.replaceAll("\\", "/");
}

export function toRelativePath(projectRoot: string, absolutePath: string): string {
  return normalizePath(path.relative(projectRoot, absolutePath));
}

export function toAbsolutePath(projectRoot: string, relativePath: string): string {
  return normalizePath(path.resolve(projectRoot, relativePath));
}
