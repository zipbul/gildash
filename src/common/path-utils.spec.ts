import { describe, expect, it } from "bun:test";
import { normalizePath, toAbsolutePath, toRelativePath } from "./path-utils";

describe("normalizePath", () => {
  it("should replace backslashes with forward slashes", () => {
    expect(normalizePath("src\\main.ts")).toBe("src/main.ts");
  });

  it("should leave forward slashes unchanged", () => {
    expect(normalizePath("src/main.ts")).toBe("src/main.ts");
  });

  it("should handle mixed separators", () => {
    expect(normalizePath("src\\utils/helpers\\index.ts")).toBe("src/utils/helpers/index.ts");
  });

  it("should return empty string when given empty string", () => {
    expect(normalizePath("")).toBe("");
  });

  it("should normalize Windows absolute paths", () => {
    expect(normalizePath("C:\\Users\\dev\\project\\src\\main.ts")).toBe("C:/Users/dev/project/src/main.ts");
  });
});

describe("toRelativePath", () => {
  it("should return forward-slash normalized relative path when inside root", () => {
    const result = toRelativePath("/repo", "/repo/src\\main.ts");

    expect(result).toBe("src/main.ts");
  });

  it("should return traversal path when target is outside root", () => {
    const result = toRelativePath("/repo/apps/web", "/repo/shared/types.ts");

    expect(result).toBe("../../shared/types.ts");
  });

  it("should normalize mixed separators when traversal segments are present", () => {
    const result = toRelativePath("C:/repo", "C:/repo/apps\\web/..\\shared\\a.ts");

    expect(result).toBe("apps/web/../shared/a.ts");
  });

  it("should return empty string when root and target are the same path", () => {
    const result = toRelativePath("/repo", "/repo");

    expect(result).toBe("");
  });

  it("should return same result when called repeatedly with same input", () => {
    const first = toRelativePath("/repo", "/repo/src/main.ts");
    const second = toRelativePath("/repo", "/repo/src/main.ts");

    expect(first).toBe(second);
  });
});

describe("toAbsolutePath", () => {
  it("should resolve absolute path when relative path is provided", () => {
    const result = toAbsolutePath("/repo", "src/main.ts");

    expect(result).toBe("/repo/src/main.ts");
  });

  it("should resolve traversal segments when relative path contains dot-dot", () => {
    const result = toAbsolutePath("/repo/apps/web", "../shared/a.ts");

    expect(result).toBe("/repo/apps/shared/a.ts");
  });

  it("should keep absolute input path as absolute result when input is absolute", () => {
    const result = toAbsolutePath("/repo", "/external/file.ts");

    expect(result).toBe("/external/file.ts");
  });

});
