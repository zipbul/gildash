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

export async function discoverProjects(
  projectRoot: string,
  scanProjectsFn: ScanProjectsFn = defaultScanProjects,
): Promise<ProjectBoundary[]> {
  const boundaries: ProjectBoundary[] = [];

  for await (const relativePackageJson of scanProjectsFn(projectRoot)) {
    const normalizedPath = normalizePath(relativePackageJson);
    if (DISCOVERY_EXCLUDE_GLOBS.some((g) => g.match(normalizedPath))) continue;
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

  boundaries.sort((left, right) => right.dir.length - left.dir.length);
  return boundaries;
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
