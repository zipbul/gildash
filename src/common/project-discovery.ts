import path from "node:path";
import { DATA_DIR } from "../constants";
import { normalizePath } from "./path-utils";

/**
 * A discovered sub-project within the indexed project root.
 *
 * Returned by {@link Gildash.projects}.
 */
export interface ProjectBoundary {
  /** Relative directory path from the project root. */
  dir: string;
  /** Unique project name (typically the `name` field from `package.json`). */
  project: string;
}

const DISCOVERY_EXCLUDE = ["**/node_modules/**", "**/.git/**", `**/${DATA_DIR}/**`, "**/dist/**"];
const DISCOVERY_EXCLUDE_GLOBS = DISCOVERY_EXCLUDE.map((p) => new Bun.Glob(p));

export type ScanProjectsFn = (projectRoot: string) => AsyncIterable<string>;

function defaultScanProjects(projectRoot: string): AsyncIterable<string> {
  return new Bun.Glob("**/package.json").scan({ cwd: projectRoot, followSymlinks: false });
}

export interface DiscoverProjectsOptions {
  /**
   * User ignore globs (relative paths, same semantics as file indexing). A
   * `package.json` whose path matches is not a boundary — ignored paths must
   * not reshape the project structure. Combined with the built-in excludes.
   */
  ignorePatterns?: string[];
  /** Test seam: overrides the package.json scanner. */
  scanProjectsFn?: ScanProjectsFn;
}

/**
 * Discover package boundaries under `projectRoot`, sorted by directory depth
 * (longest first, then lexicographic — the order `resolveFileProject` matches in).
 *
 * **Root boundary invariant**: the result always contains a `.` boundary. When
 * no root `package.json` exists, a synthetic one is appended (named after the
 * projectRoot basename), so `pickDefaultProject` and the `.` catch-all in
 * `resolveFileProject` agree on where boundary-less files belong.
 */
export async function discoverProjects(
  projectRoot: string,
  options: DiscoverProjectsOptions = {},
): Promise<ProjectBoundary[]> {
  const { ignorePatterns = [], scanProjectsFn = defaultScanProjects } = options;
  const userIgnoreGlobs = ignorePatterns.map((p) => new Bun.Glob(p));
  const boundaries: ProjectBoundary[] = [];

  for await (const relativePackageJson of scanProjectsFn(projectRoot)) {
    const normalizedPath = normalizePath(relativePackageJson);
    if (DISCOVERY_EXCLUDE_GLOBS.some((g) => g.match(normalizedPath))) continue;
    if (userIgnoreGlobs.some((g) => g.match(normalizedPath))) continue;
    const packageDir = normalizePath(path.dirname(relativePackageJson));
    const packagePath = path.join(projectRoot, relativePackageJson);
    const content = await Bun.file(packagePath).json();

    const packageName =
      typeof content?.name === "string" && content.name.length > 0
        ? content.name
        : path.basename(packageDir === "." ? projectRoot : packageDir);

    boundaries.push({
      dir: packageDir,
      project: packageName,
    });
  }

  return ensureRootBoundary(boundaries, projectRoot);
}

/**
 * Normalize a boundary set to the discovery contract: deepest-dir first with a
 * deterministic tie-break, the root (`.`) boundary always LAST (it is the
 * catch-all in `resolveFileProject` — sorted earlier it would swallow files of
 * any boundary after it), and always present (synthesized from the projectRoot
 * basename when missing, deduplicated against discovered names so the synthetic
 * root never merges scopes with a real package).
 */
export function ensureRootBoundary(
  boundaries: ProjectBoundary[],
  projectRoot: string,
): ProjectBoundary[] {
  const sorted = [...boundaries].sort((left, right) => {
    if (left.dir === ".") return 1;
    if (right.dir === ".") return -1;
    return right.dir.length - left.dir.length || left.dir.localeCompare(right.dir);
  });

  if (!sorted.some((b) => b.dir === ".")) {
    const taken = new Set(sorted.map((b) => b.project));
    const base = path.basename(projectRoot);
    let name = base;
    for (let i = 2; taken.has(name); i++) name = `${base}-root${i > 2 ? `-${i}` : ""}`;
    sorted.push({ dir: ".", project: name });
  }

  return sorted;
}

/**
 * The default project for a boundary set: the root (`.`) boundary's name.
 * Always present for `discoverProjects` output (root boundary invariant);
 * `null` only for defensively-handled foreign inputs.
 */
export function pickDefaultProject(boundaries: ProjectBoundary[]): string | null {
  return boundaries.find((b) => b.dir === ".")?.project ?? null;
}

export function resolveFileProject(
  filePath: string,
  boundaries: ProjectBoundary[],
  rootProject = "default",
): string {
  const normalizedFilePath = normalizePath(filePath);
  for (const boundary of boundaries) {
    if (boundary.dir === ".") {
      return boundary.project;
    }

    if (
      normalizedFilePath === boundary.dir ||
      normalizedFilePath.startsWith(`${boundary.dir}/`)
    ) {
      return boundary.project;
    }
  }

  return rootProject;
}
