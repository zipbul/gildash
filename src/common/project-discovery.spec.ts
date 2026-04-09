import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { discoverProjects, resolveFileProject, type ProjectBoundary } from "./project-discovery";

const mockScan = mock(async function* (): AsyncGenerator<string> {});

beforeEach(() => {
  mockScan.mockReset();
});

afterEach(() => {
  spyOn(Bun, "file").mockRestore();
});

function setupGlobAndFiles(entries: Record<string, Record<string, unknown> | null>): void {
  const paths = Object.keys(entries);
  const sortedPaths = [...paths].sort((a, b) => b.length - a.length);

  mockScan.mockImplementation(async function* () {
    for (const p of paths) {
      yield p;
    }
  });

  spyOn(Bun, "file").mockImplementation((p) => {
    const key = String(p).replaceAll("\\", "/");
    const matchedPath = sortedPaths.find((pk) => key.endsWith(pk));
    const content = matchedPath !== undefined ? entries[matchedPath] : null;
    return {
      json: async () => content,
    } as ReturnType<typeof Bun.file>;
  });
}

describe("resolveFileProject", () => {
  it("should return deepest matched project when file path matches nested boundary", () => {
    const boundaries: ProjectBoundary[] = [
      { dir: "apps/web", project: "@ws/web" },
      { dir: "apps", project: "@ws/apps" },
      { dir: ".", project: "@ws/root" },
    ];

    const result = resolveFileProject("apps/web/src/app.ts", boundaries, "@ws/root");

    expect(result).toBe("@ws/web");
  });

  it("should return fallback project when no boundary matches", () => {
    const boundaries: ProjectBoundary[] = [{ dir: "apps/web", project: "@ws/web" }];

    const result = resolveFileProject("scripts/deploy.ts", boundaries, "@ws/root");

    expect(result).toBe("@ws/root");
  });

  it("should return root boundary project when root boundary exists", () => {
    const boundaries: ProjectBoundary[] = [{ dir: ".", project: "@ws/root" }];

    const result = resolveFileProject("scripts/deploy.ts", boundaries, "default");

    expect(result).toBe("@ws/root");
  });

  it("should return rootProject when boundaries array is empty", () => {
    const result = resolveFileProject("apps/web/src/app.ts", [], "fallback");

    expect(result).toBe("fallback");
  });

  it("should return matched project when file path is exactly equal to boundary dir", () => {
    const boundaries: ProjectBoundary[] = [{ dir: "apps/web", project: "@ws/web" }];

    const result = resolveFileProject("apps/web", boundaries, "default");

    expect(result).toBe("@ws/web");
  });

  it("should match boundary when file path uses backslash separators", () => {
    const boundaries: ProjectBoundary[] = [{ dir: "apps/web", project: "@ws/web" }];

    const result = resolveFileProject("apps\\web\\src\\app.ts", boundaries, "default");

    expect(result).toBe("@ws/web");
  });
});

describe("discoverProjects", () => {
  it("should use directory basename when package name is missing", async () => {
    setupGlobAndFiles({
      "package.json": { name: "@ws/root" },
      "apps/web/package.json": {},
    });

    const boundaries = await discoverProjects("/fake/root", mockScan as any);
    const webBoundary = boundaries.find((item) => item.dir === "apps/web");

    expect(webBoundary?.project).toBe("web");
  });

  it("should return empty array when directory has no package json files", async () => {
    mockScan.mockImplementation(async function* () {});

    const boundaries = await discoverProjects("/fake/root", mockScan as any);

    expect(boundaries).toEqual([]);
  });

  it("should exclude node_modules git and dist directories from results", async () => {
    mockScan.mockImplementation(async function* () {
      yield "package.json";
      yield "node_modules/pkg/package.json";
      yield ".git/hooks/package.json";
      yield "dist/package.json";
      yield "packages/core/package.json";
    });
    spyOn(Bun, "file").mockImplementation((p) => {
      const key = String(p).replaceAll("\\", "/");
      if (key.includes("packages/core")) return { json: async () => ({ name: "@ws/core" }) } as any;
      return { json: async () => ({ name: "@ws/root" }) } as any;
    });

    const boundaries = await discoverProjects("/fake/root", mockScan as any);

    const dirs = boundaries.map((b) => b.dir);
    expect(dirs).toContain(".");
    expect(dirs).toContain("packages/core");
    expect(dirs).not.toContain("node_modules/pkg");
    expect(dirs).not.toContain(".git/hooks");
    expect(dirs).not.toContain("dist");
  });

  it("should use dirname fallback when package name is empty string", async () => {
    setupGlobAndFiles({
      "packages/core/package.json": { name: "" },
    });

    const boundaries = await discoverProjects("/fake/root", mockScan as any);

    expect(boundaries[0]?.project).toBe("core");
  });

  it("should use dirname fallback when package name is null", async () => {
    setupGlobAndFiles({
      "packages/utils/package.json": { name: null },
    });

    const boundaries = await discoverProjects("/fake/root", mockScan as any);

    expect(boundaries[0]?.project).toBe("utils");
  });

  it("should use projectRoot basename when root level package json has no name", async () => {
    setupGlobAndFiles({
      "package.json": {},
    });

    const boundaries = await discoverProjects("/fake/root-basename", mockScan as any);

    expect(boundaries[0]?.project).toBe("root-basename");
  });
});
