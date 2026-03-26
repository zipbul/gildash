import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { join } from "node:path";
import { clearTsconfigPathsCache, loadTsconfigPaths } from "./tsconfig-resolver";

const PROJECT_ROOT = "/fake/project";
const TSCONFIG_PATH = join(PROJECT_ROOT, "tsconfig.json");
const JSCONFIG_PATH = join(PROJECT_ROOT, "jsconfig.json");

function makeBunFile(content: Record<string, unknown> | null): ReturnType<typeof Bun.file> {
  return {
    exists: async () => content !== null,
    text: async () => content !== null ? JSON.stringify(content) : '',
  } as ReturnType<typeof Bun.file>;
}

afterEach(() => {
  clearTsconfigPathsCache();
  spyOn(Bun, "file").mockRestore();
});

describe("loadTsconfigPaths", () => {
  it("should return null when tsconfig file does not exist", async () => {
    spyOn(Bun, "file").mockImplementation(() => makeBunFile(null));

    const result = await loadTsconfigPaths(PROJECT_ROOT);

    expect(result).toBeNull();
  });

  it("should return parsed baseUrl and paths when tsconfig has compiler options", async () => {
    spyOn(Bun, "file").mockImplementation((p) => {
      if (String(p) === TSCONFIG_PATH) {
        return makeBunFile({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } });
      }
      return makeBunFile(null);
    });

    const result = await loadTsconfigPaths(PROJECT_ROOT);

    expect(result?.baseUrl).toBe(PROJECT_ROOT);
    expect(result?.paths.get("@/*")).toEqual(["src/*"]);
  });

  it("should return null when tsconfig has no baseUrl and no paths", async () => {
    spyOn(Bun, "file").mockImplementation((p) => {
      if (String(p) === TSCONFIG_PATH) return makeBunFile({ compilerOptions: {} });
      return makeBunFile(null);
    });

    const result = await loadTsconfigPaths(PROJECT_ROOT);

    expect(result).toBeNull();
  });

  it("should return null when tsconfig does not exist", async () => {
    spyOn(Bun, "file").mockImplementation((p) => {
      return makeBunFile(null);
    });

    const result = await loadTsconfigPaths(PROJECT_ROOT);

    expect(result).toBeNull();
  });

  it("should return cached value when file changes without invalidation", async () => {
    let callCount = 0;
    spyOn(Bun, "file").mockImplementation((p) => {
      if (String(p) === TSCONFIG_PATH) {
        callCount += 1;
        const alias = callCount === 1 ? "src/*" : "next/*";
        return makeBunFile({ compilerOptions: { baseUrl: ".", paths: { "@/*": [alias] } } });
      }
      return makeBunFile(null);
    });

    const first = await loadTsconfigPaths(PROJECT_ROOT);
    const second = await loadTsconfigPaths(PROJECT_ROOT);

    expect(first?.paths.get("@/*")).toEqual(["src/*"]);
    expect(second?.paths.get("@/*")).toEqual(["src/*"]);
  });

  it("should refresh cached value when project cache is cleared", async () => {
    let callCount = 0;
    spyOn(Bun, "file").mockImplementation((p) => {
      if (String(p) === TSCONFIG_PATH) {
        callCount += 1;
        const alias = callCount === 1 ? "src/*" : "updated/*";
        return makeBunFile({ compilerOptions: { baseUrl: ".", paths: { "@/*": [alias] } } });
      }
      return makeBunFile(null);
    });

    await loadTsconfigPaths(PROJECT_ROOT);
    clearTsconfigPathsCache(PROJECT_ROOT);
    const refreshed = await loadTsconfigPaths(PROJECT_ROOT);

    expect(refreshed?.paths.get("@/*")).toEqual(["updated/*"]);
  });

  it("should return null when tsconfig has no compilerOptions field", async () => {
    spyOn(Bun, "file").mockImplementation((p) => {
      if (String(p) === TSCONFIG_PATH) return makeBunFile({ include: ["src"] });
      return makeBunFile(null);
    });

    const result = await loadTsconfigPaths(PROJECT_ROOT);

    expect(result).toBeNull();
  });

  it("should return result with empty paths map when only baseUrl is present", async () => {
    spyOn(Bun, "file").mockImplementation((p) => {
      if (String(p) === TSCONFIG_PATH) return makeBunFile({ compilerOptions: { baseUrl: "." } });
      return makeBunFile(null);
    });

    const result = await loadTsconfigPaths(PROJECT_ROOT);

    expect(result).not.toBeNull();
    expect(result?.baseUrl).toBe(PROJECT_ROOT);
    expect(result?.paths.size).toBe(0);
  });

  it("should return result with projectRoot as baseUrl when only paths is present", async () => {
    spyOn(Bun, "file").mockImplementation((p) => {
      if (String(p) === TSCONFIG_PATH) {
        return makeBunFile({ compilerOptions: { paths: { "@/*": ["src/*"] } } });
      }
      return makeBunFile(null);
    });

    const result = await loadTsconfigPaths(PROJECT_ROOT);

    expect(result).not.toBeNull();
    expect(result?.baseUrl).toBe(PROJECT_ROOT);
    expect(result?.paths.get("@/*")).toEqual(["src/*"]);
  });

  it("should skip entry when paths value is not an array", async () => {
    spyOn(Bun, "file").mockImplementation((p) => {
      if (String(p) === TSCONFIG_PATH) {
        return makeBunFile({
          compilerOptions: { baseUrl: ".", paths: { "@/*": "src/*", "#/*": ["lib/*"] } },
        });
      }
      return makeBunFile(null);
    });

    const result = await loadTsconfigPaths(PROJECT_ROOT);

    expect(result?.paths.has("@/*")).toBe(false);
    expect(result?.paths.get("#/*")).toEqual(["lib/*"]);
  });

  it("should filter non-string values when resolving paths array entries", async () => {
    spyOn(Bun, "file").mockImplementation((p) => {
      if (String(p) === TSCONFIG_PATH) {
        return makeBunFile({
          compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*", 42, null, "lib/*"] } },
        });
      }
      return makeBunFile(null);
    });

    const result = await loadTsconfigPaths(PROJECT_ROOT);

    expect(result?.paths.get("@/*")).toEqual(["src/*", "lib/*"]);
  });

  it("should return null on second call when cached value is null", async () => {
    spyOn(Bun, "file").mockImplementation(() => makeBunFile(null));

    const first = await loadTsconfigPaths(PROJECT_ROOT);
    const second = await loadTsconfigPaths(PROJECT_ROOT);

    expect(first).toBeNull();
    expect(second).toBeNull();
  });

  it("should reload all projects when clearTsconfigPathsCache is called without argument", async () => {
    const rootA = "/fake/project-a";
    const rootB = "/fake/project-b";
    let callCountA = 0;

    spyOn(Bun, "file").mockImplementation((p) => {
      const s = String(p);
      if (s === join(rootA, "tsconfig.json")) {
        callCountA += 1;
        const alias = callCountA === 1 ? "old/*" : "new/*";
        return makeBunFile({ compilerOptions: { baseUrl: ".", paths: { "@/*": [alias] } } });
      }
      if (s === join(rootB, "tsconfig.json")) {
        return makeBunFile({ compilerOptions: { baseUrl: "." } });
      }
      return makeBunFile(null);
    });

    await loadTsconfigPaths(rootA);
    await loadTsconfigPaths(rootB);

    clearTsconfigPathsCache();

    const refreshedA = await loadTsconfigPaths(rootA);
    const refreshedB = await loadTsconfigPaths(rootB);

    expect(refreshedA?.paths.get("@/*")).toEqual(["new/*"]);
    expect(refreshedB?.paths.size).toBe(0);
  });

  it("should parse JSONC with line comments successfully", async () => {
    const jsonc = `{
      // This is a line comment
      "compilerOptions": {
        "baseUrl": ".",
        "paths": { "@/*": ["src/*"] }
      }
    }`;
    spyOn(Bun, "file").mockImplementation((p) => {
      if (String(p) === TSCONFIG_PATH) {
        return { exists: async () => true, text: async () => jsonc } as ReturnType<typeof Bun.file>;
      }
      return makeBunFile(null);
    });

    const result = await loadTsconfigPaths(PROJECT_ROOT);

    expect(result).not.toBeNull();
    expect(result?.paths.get("@/*")).toEqual(["src/*"]);
  });

  it("should parse JSONC with block comments successfully", async () => {
    const jsonc = `{
      /* block comment */
      "compilerOptions": {
        "baseUrl": ".",
        "paths": { "@/*": ["src/*"] }
      }
    }`;
    spyOn(Bun, "file").mockImplementation((p) => {
      if (String(p) === TSCONFIG_PATH) {
        return { exists: async () => true, text: async () => jsonc } as ReturnType<typeof Bun.file>;
      }
      return makeBunFile(null);
    });

    const result = await loadTsconfigPaths(PROJECT_ROOT);

    expect(result).not.toBeNull();
    expect(result?.paths.get("@/*")).toEqual(["src/*"]);
  });

  it("should parse JSONC with trailing commas successfully", async () => {
    const jsonc = `{
      "compilerOptions": {
        "baseUrl": ".",
        "paths": { "@/*": ["src/*",], },
      },
    }`;
    spyOn(Bun, "file").mockImplementation((p) => {
      if (String(p) === TSCONFIG_PATH) {
        return { exists: async () => true, text: async () => jsonc } as ReturnType<typeof Bun.file>;
      }
      return makeBunFile(null);
    });

    const result = await loadTsconfigPaths(PROJECT_ROOT);

    expect(result).not.toBeNull();
    expect(result?.paths.get("@/*")).toEqual(["src/*"]);
  });

  it("should resolve paths from extended tsconfig when child has no paths", async () => {
    const basePath = join(PROJECT_ROOT, "tsconfig.base.json");
    spyOn(Bun, "file").mockImplementation((p) => {
      const s = String(p);
      if (s === TSCONFIG_PATH) {
        return makeBunFile({ extends: "./tsconfig.base.json" });
      }
      if (s === basePath) {
        return makeBunFile({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } });
      }
      return makeBunFile(null);
    });

    const result = await loadTsconfigPaths(PROJECT_ROOT);

    expect(result).not.toBeNull();
    expect(result?.paths.get("@/*")).toEqual(["src/*"]);
  });

  it("should let child compilerOptions override parent when both define the same key", async () => {
    const basePath = join(PROJECT_ROOT, "tsconfig.base.json");
    spyOn(Bun, "file").mockImplementation((p) => {
      const s = String(p);
      if (s === TSCONFIG_PATH) {
        return makeBunFile({ extends: "./tsconfig.base.json", compilerOptions: { paths: { "#/*": ["lib/*"] } } });
      }
      if (s === basePath) {
        return makeBunFile({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } });
      }
      return makeBunFile(null);
    });

    const result = await loadTsconfigPaths(PROJECT_ROOT);

    expect(result?.baseUrl).toBe(PROJECT_ROOT);
    // Child paths override parent paths entirely (shallow merge of compilerOptions)
    expect(result?.paths.get("#/*")).toEqual(["lib/*"]);
    expect(result?.paths.has("@/*")).toBe(false);
  });

  it("should follow multi-level extends chain", async () => {
    const basePath = join(PROJECT_ROOT, "tsconfig.base.json");
    const grandparentPath = join(PROJECT_ROOT, "tsconfig.root.json");
    spyOn(Bun, "file").mockImplementation((p) => {
      const s = String(p);
      if (s === TSCONFIG_PATH) {
        return makeBunFile({ extends: "./tsconfig.base.json" });
      }
      if (s === basePath) {
        return makeBunFile({ extends: "./tsconfig.root.json", compilerOptions: { paths: { "@/*": ["src/*"] } } });
      }
      if (s === grandparentPath) {
        return makeBunFile({ compilerOptions: { baseUrl: "." } });
      }
      return makeBunFile(null);
    });

    const result = await loadTsconfigPaths(PROJECT_ROOT);

    expect(result?.baseUrl).toBe(PROJECT_ROOT);
    expect(result?.paths.get("@/*")).toEqual(["src/*"]);
  });

  it("should return null when file content is invalid JSONC", async () => {
    spyOn(Bun, "file").mockImplementation((p) => {
      if (String(p) === TSCONFIG_PATH) {
        return { exists: async () => true, text: async () => "not valid json at all {{{" } as ReturnType<typeof Bun.file>;
      }
      return makeBunFile(null);
    });

    const result = await loadTsconfigPaths(PROJECT_ROOT);

    expect(result).toBeNull();
  });

  it("should not infinite loop on circular extends and return child config", async () => {
    const basePath = join(PROJECT_ROOT, "tsconfig.base.json");
    spyOn(Bun, "file").mockImplementation((p) => {
      const s = String(p);
      if (s === TSCONFIG_PATH) {
        return makeBunFile({
          extends: "./tsconfig.base.json",
          compilerOptions: { paths: { "@/*": ["src/*"] } },
        });
      }
      if (s === basePath) {
        return makeBunFile({
          extends: "./tsconfig.json",
          compilerOptions: { baseUrl: "." },
        });
      }
      return makeBunFile(null);
    });

    const result = await loadTsconfigPaths(PROJECT_ROOT);

    expect(result).not.toBeNull();
    expect(result?.paths.get("@/*")).toEqual(["src/*"]);
    expect(result?.baseUrl).toBe(PROJECT_ROOT);
  });

  it("should return child compilerOptions when extended file does not exist", async () => {
    spyOn(Bun, "file").mockImplementation((p) => {
      const s = String(p);
      if (s === TSCONFIG_PATH) {
        return makeBunFile({
          extends: "./nonexistent.json",
          compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
        });
      }
      return makeBunFile(null);
    });

    const result = await loadTsconfigPaths(PROJECT_ROOT);

    expect(result).not.toBeNull();
    expect(result?.baseUrl).toBe(PROJECT_ROOT);
    expect(result?.paths.get("@/*")).toEqual(["src/*"]);
  });

  it("should resolve extends path without .json extension by appending .json", async () => {
    const basePath = join(PROJECT_ROOT, "tsconfig.base.json");
    spyOn(Bun, "file").mockImplementation((p) => {
      const s = String(p);
      if (s === TSCONFIG_PATH) {
        return makeBunFile({ extends: "./tsconfig.base" });
      }
      if (s === basePath) {
        return makeBunFile({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } });
      }
      return makeBunFile(null);
    });

    const result = await loadTsconfigPaths(PROJECT_ROOT);

    expect(result).not.toBeNull();
    expect(result?.baseUrl).toBe(PROJECT_ROOT);
    expect(result?.paths.get("@/*")).toEqual(["src/*"]);
  });

  it("should return partial results when extends chain exceeds maxDepth", async () => {
    // Build a chain 7 levels deep: tsconfig.json -> l1.json -> l2.json -> ... -> l6.json
    // maxDepth=5 means: tsconfig(5) -> l1(4) -> l2(3) -> l3(2) -> l4(1) -> l5(0=null)
    // So l5 and l6 are unreachable. l4 has baseUrl but its parent l5 is cut off.
    spyOn(Bun, "file").mockImplementation((p) => {
      const s = String(p);
      if (s === TSCONFIG_PATH) {
        return makeBunFile({ extends: "./l1.json", compilerOptions: { paths: { "@/*": ["src/*"] } } });
      }
      for (let i = 1; i <= 5; i++) {
        if (s === join(PROJECT_ROOT, `l${i}.json`)) {
          return makeBunFile({ extends: `./l${i + 1}.json` });
        }
      }
      if (s === join(PROJECT_ROOT, "l6.json")) {
        return makeBunFile({ compilerOptions: { baseUrl: "deep" } });
      }
      return makeBunFile(null);
    });

    const result = await loadTsconfigPaths(PROJECT_ROOT);

    // Child paths should still be available even though deep ancestor is unreachable
    expect(result).not.toBeNull();
    expect(result?.paths.get("@/*")).toEqual(["src/*"]);
    // baseUrl from l6.json is unreachable due to maxDepth, so defaults to projectRoot
    expect(result?.baseUrl).toBe(PROJECT_ROOT);
  });

  it("should shallow-merge child baseUrl with parent paths in compilerOptions", async () => {
    const basePath = join(PROJECT_ROOT, "tsconfig.base.json");
    spyOn(Bun, "file").mockImplementation((p) => {
      const s = String(p);
      if (s === TSCONFIG_PATH) {
        return makeBunFile({
          extends: "./tsconfig.base.json",
          compilerOptions: { baseUrl: "src" },
        });
      }
      if (s === basePath) {
        return makeBunFile({
          compilerOptions: { paths: { "@/*": ["lib/*"] } },
        });
      }
      return makeBunFile(null);
    });

    const result = await loadTsconfigPaths(PROJECT_ROOT);

    expect(result).not.toBeNull();
    // Child baseUrl overrides (shallow merge), resolved against projectRoot
    expect(result?.baseUrl).toBe(join(PROJECT_ROOT, "src"));
    // Parent paths are inherited since child doesn't override paths
    expect(result?.paths.get("@/*")).toEqual(["lib/*"]);
  });
});
