import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { discoverProjects, pickDefaultProject, resolveFileProject, type ProjectBoundary } from "./project-discovery";

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

    const boundaries = await discoverProjects("/fake/root", { scanProjectsFn: mockScan as any });
    const webBoundary = boundaries.find((item) => item.dir === "apps/web");

    expect(webBoundary?.project).toBe("web");
  });

  it("should return only the synthetic root boundary when directory has no package json files", async () => {
    // Intended change (root boundary invariant): discovery always yields a `.`
    // boundary so defaultProject and resolveFileProject's catch-all stay aligned.
    mockScan.mockImplementation(async function* () {});

    const boundaries = await discoverProjects("/fake/root", { scanProjectsFn: mockScan as any });

    expect(boundaries).toEqual([{ dir: ".", project: "root" }]);
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

    const boundaries = await discoverProjects("/fake/root", { scanProjectsFn: mockScan as any });

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

    const boundaries = await discoverProjects("/fake/root", { scanProjectsFn: mockScan as any });

    expect(boundaries[0]?.project).toBe("core");
  });

  it("should use dirname fallback when package name is null", async () => {
    setupGlobAndFiles({
      "packages/utils/package.json": { name: null },
    });

    const boundaries = await discoverProjects("/fake/root", { scanProjectsFn: mockScan as any });

    expect(boundaries[0]?.project).toBe("utils");
  });

  it("should use projectRoot basename when root level package json has no name", async () => {
    setupGlobAndFiles({
      "package.json": {},
    });

    const boundaries = await discoverProjects("/fake/root-basename", { scanProjectsFn: mockScan as any });

    expect(boundaries[0]?.project).toBe("root-basename");
  });
});

describe("pickDefaultProject", () => {
  it("should pick the root boundary project when nested boundaries exist", () => {
    const boundaries: ProjectBoundary[] = [
      { dir: "test/__fixtures__/a.dir", project: "fixture-pkg" },
      { dir: "packages/core", project: "@ws/core" },
      { dir: ".", project: "main-repo" },
    ];

    expect(pickDefaultProject(boundaries)).toBe("main-repo");
  });

  it("should return null when boundaries array is empty", () => {
    expect(pickDefaultProject([])).toBeNull();
  });

  it("should return null when no root boundary exists (defensive contract)", () => {
    const boundaries: ProjectBoundary[] = [{ dir: "packages/core", project: "@ws/core" }];

    expect(pickDefaultProject(boundaries)).toBeNull();
  });
});

describe("discoverProjects — root boundary invariant", () => {
  it("should append a synthetic root boundary when no root package.json exists", async () => {
    setupGlobAndFiles({
      "test/__fixtures__/a.dir/package.json": { name: "fixture-pkg" },
    });

    const boundaries = await discoverProjects("/fake/my-repo", { scanProjectsFn: mockScan as any });

    const root = boundaries.find((b) => b.dir === ".");
    expect(root?.project).toBe("my-repo");
  });

  it("should append a synthetic root boundary when no package.json exists at all", async () => {
    mockScan.mockImplementation(async function* () {});

    const boundaries = await discoverProjects("/fake/bare-repo", { scanProjectsFn: mockScan as any });

    expect(boundaries).toEqual([{ dir: ".", project: "bare-repo" }]);
  });

  it("should not duplicate the root boundary when a root package.json exists", async () => {
    setupGlobAndFiles({
      "package.json": { name: "main-repo" },
      "packages/core/package.json": { name: "@ws/core" },
    });

    const boundaries = await discoverProjects("/fake/root", { scanProjectsFn: mockScan as any });

    const roots = boundaries.filter((b) => b.dir === ".");
    expect(roots).toEqual([{ dir: ".", project: "main-repo" }]);
  });

  it("should keep the synthetic root consistent with resolveFileProject for boundary-less files", async () => {
    setupGlobAndFiles({
      "test/__fixtures__/a.dir/package.json": { name: "fixture-pkg" },
    });

    const boundaries = await discoverProjects("/fake/my-repo", { scanProjectsFn: mockScan as any });

    // The invariant that kills the empty-query bug: defaultProject and the project
    // that boundary-less files index into must be the same name.
    expect(resolveFileProject("src/index.ts", boundaries)).toBe(pickDefaultProject(boundaries)!);
  });
});

describe("discoverProjects — ignorePatterns", () => {
  it("should not create a boundary for a package.json under an ignored directory", async () => {
    setupGlobAndFiles({
      "package.json": { name: "main-repo" },
      "test/__fixtures__/a.dir/package.json": { name: "fixture-pkg" },
    });

    const boundaries = await discoverProjects("/fake/root", {
      scanProjectsFn: mockScan as any,
      ignorePatterns: ["**/__fixtures__/**"],
    });

    expect(boundaries.map((b) => b.project)).toEqual(["main-repo"]);
  });

  it("should combine user patterns with built-in excludes", async () => {
    mockScan.mockImplementation(async function* () {
      yield "package.json";
      yield "node_modules/dep/package.json";
      yield "test/__fixtures__/a.dir/package.json";
    });
    spyOn(Bun, "file").mockImplementation(() => ({ json: async () => ({ name: "x" }) }) as any);

    const boundaries = await discoverProjects("/fake/root", {
      scanProjectsFn: mockScan as any,
      ignorePatterns: ["**/__fixtures__/**"],
    });

    expect(boundaries.map((b) => b.dir)).toEqual(["."]);
  });
});

describe("discoverProjects — deterministic ordering", () => {
  it("should order equal-length boundary dirs deterministically", async () => {
    setupGlobAndFiles({
      "bbb/x/package.json": { name: "b-pkg" },
      "aaa/x/package.json": { name: "a-pkg" },
      "package.json": { name: "main-repo" },
    });

    const boundaries = await discoverProjects("/fake/root", { scanProjectsFn: mockScan as any });

    expect(boundaries.map((b) => b.dir)).toEqual(["aaa/x", "bbb/x", "."]);
  });
});

describe("discoverProjects — root boundary ordering and naming", () => {
  it("should sort the root boundary last even when a package dir ties on length", async () => {
    // '.' ties on length with a 1-char package dir; if the root sorts first,
    // its catch-all in resolveFileProject swallows the nested package's files.
    setupGlobAndFiles({
      "package.json": { name: "root-app" },
      "a/package.json": { name: "pkg-a" },
    });

    const boundaries = await discoverProjects("/fake/root", { scanProjectsFn: mockScan as any });

    expect(boundaries.map((b) => b.dir)).toEqual(["a", "."]);
    expect(resolveFileProject("a/src/index.ts", boundaries)).toBe("pkg-a");
  });

  it("should give the synthetic root a non-colliding name when basename matches a package name", async () => {
    // repo dir named 'utils' containing packages/utils named 'utils' — the
    // synthetic root must not merge scopes with the real package.
    setupGlobAndFiles({
      "packages/utils/package.json": { name: "utils" },
    });

    const boundaries = await discoverProjects("/fake/utils", { scanProjectsFn: mockScan as any });

    const root = boundaries.find((b) => b.dir === ".")!;
    expect(root.project).not.toBe("utils");
    expect(pickDefaultProject(boundaries)).toBe(root.project);
    expect(resolveFileProject("src/index.ts", boundaries)).toBe(root.project);
  });
});
