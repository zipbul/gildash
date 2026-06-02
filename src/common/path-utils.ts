import path from "node:path";

// ── Nominal path brands ──────────────────────────────────────────────────────
//
// Paths in gildash are not interchangeable strings: the store and its queries
// use **project-relative, forward-slash** paths, while the fs / tsc layer uses
// **absolute** paths. Encoding that in the type makes "forgot to normalize"
// (the recurring Windows-path bug class) a COMPILE error rather than a silent
// runtime miss: `string` is not assignable to `RelPath`/`AbsPath`, so a caller
// cannot hand a raw string to a sink that requires a brand — it must mint one
// here first. A brand is assignable back to `string`, so consumers (drizzle
// binds, `Bun.file`, `node:path`) need no changes.
//
// The brands are phantom (`unique symbol`, never materialized at runtime), so
// this is purely a compile-time contract with zero runtime cost.
//
// ⚠️ The casts below are the type system's SANCTIONED minting escape, isolated
// to this module and gated by lint (`as RelPath`/`as AbsPath` are forbidden
// elsewhere). They are sound: every minted value has first passed through
// `normalizePath` / `path.relative` / `path.resolve`.

declare const RelBrand: unique symbol;
declare const AbsBrand: unique symbol;

/** A project-relative, forward-slash-normalized path (store/query domain). */
export type RelPath = string & { readonly [RelBrand]: never };
/** An absolute, forward-slash-normalized path (fs / tsc domain). */
export type AbsPath = string & { readonly [AbsBrand]: never };

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

/** Project-relative, normalized path from an absolute one. */
export function toRelativePath(projectRoot: string, absolutePath: string): RelPath {
  return normalizePath(path.relative(projectRoot, absolutePath)) as RelPath;
}

/** Absolute, normalized path from a project-relative one. */
export function toAbsolutePath(projectRoot: string, relativePath: string): AbsPath {
  return normalizePath(path.resolve(projectRoot, relativePath)) as AbsPath;
}

/**
 * Brand a string that is already a project-relative path (e.g. a value read
 * back from the store, or a relative input from a caller) as {@link RelPath},
 * normalizing separators. Use {@link toRelativePath} when the input may be
 * absolute.
 */
export function relPath(p: string): RelPath {
  return normalizePath(p) as RelPath;
}

/**
 * Normalize an inbound caller path (which may be absolute or relative) to the
 * store's {@link RelPath} domain. This is the single entry-point every public
 * facade method routes a `filePath` argument through.
 */
export function inboundRelPath(projectRoot: string, filePath: string): RelPath {
  return path.isAbsolute(filePath) ? toRelativePath(projectRoot, filePath) : relPath(filePath);
}
