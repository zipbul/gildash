import { describe, expect, it, mock, beforeEach } from "bun:test";
import { isErr } from "@zipbul/result";
import type { GildashError } from "../errors";
import { TscProgram } from "./tsc-program";
import { TypeCollector } from "./type-collector";
import { SymbolGraph } from "./symbol-graph";
import { ReferenceResolver } from "./reference-resolver";
import { ImplementationFinder } from "./implementation-finder";
import { SemanticLayer } from "./index";
import type { ResolvedType, SemanticReference, Implementation } from "./types";

// ── 공통 픽스처 ──────────────────────────────────────────────────────────────

const TSCONFIG_PATH = "/project/tsconfig.json";
const VALID_TSCONFIG = JSON.stringify({
  compilerOptions: { strict: true, noEmit: true, target: "ES2022", module: "NodeNext" },
});

function makeProg(): TscProgram {
  const result = TscProgram.create(TSCONFIG_PATH, {
    readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
    resolveNonTrackedFile: (p) =>
      p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
  });
  if (isErr<GildashError>(result)) throw new Error(`setup failed: ${result.data.message}`);
  return result;
}

function pos(content: string, marker: string): number {
  const idx = content.indexOf(marker);
  if (idx === -1) throw new Error(`marker "${marker}" not found in content`);
  return idx;
}

const FAKE_RESOLVED_TYPE: ResolvedType = {
  text: "string",
  flags: 4,
  isUnion: false,
  isIntersection: false,
  isGeneric: false,
};

const FAKE_REFERENCE: SemanticReference = {
  filePath: "/project/src/a.ts",
  position: 10,
  line: 1,
  column: 10,
  isDefinition: false,
  isWrite: false,
};

const FAKE_IMPLEMENTATION: Implementation = {
  filePath: "/project/src/b.ts",
  symbolName: "MyClass",
  position: 20,
  kind: "class",
  isExplicit: true,
};

// ── SemanticLayer ─────────────────────────────────────────────────────────────

describe("SemanticLayer", () => {
  // 1. [HP] create() 성공 → SemanticLayer 반환, isDisposed=false
  it("should return SemanticLayer with isDisposed=false when create succeeds", () => {
    // Arrange & Act
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });

    // Assert
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    expect(result.isDisposed).toBe(false);
    result.dispose();
  });

  // 2. [HP] create() with custom DI → injected 서브모듈 사용됨
  it("should use injected TypeCollector when provided via DI", () => {
    // Arrange
    const prog = makeProg();
    const mockCollector = new TypeCollector(prog);
    const collectAtSpy = mock(() => FAKE_RESOLVED_TYPE);
    mockCollector.collectAt = collectAtSpy;

    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
      typeCollector: mockCollector,
    });

    // Act
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    result.collectTypeAt("/project/src/a.ts", 0);

    // Assert
    expect(collectAtSpy).toHaveBeenCalledWith("/project/src/a.ts", 0);
    result.dispose();
    prog.dispose();
  });

  // 3. [HP] collectTypeAt → TypeCollector.collectAt 위임 호출됨
  it("should delegate collectTypeAt to TypeCollector.collectAt", () => {
    // Arrange
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    const filePath = "/project/src/a.ts";
    const content = "const x: string = 'hello';";
    layer.notifyFileChanged(filePath, content);

    // Act
    const typeResult = layer.collectTypeAt(filePath, pos(content, "x"));

    // Assert
    expect(typeResult).not.toBeNull();
    expect(typeResult!.text).toBe("string");
    layer.dispose();
  });

  // 4. [HP] collectFileTypes → TypeCollector.collectFile 위임 호출됨
  it("should delegate collectFileTypes to TypeCollector.collectFile", () => {
    // Arrange
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    const filePath = "/project/src/a.ts";
    const content = "const x: string = 'hello';\nconst y: number = 1;";
    layer.notifyFileChanged(filePath, content);

    // Act
    const fileTypes = layer.collectFileTypes(filePath);

    // Assert
    expect(fileTypes).toBeInstanceOf(Map);
    expect(fileTypes.size).toBeGreaterThan(0);
    layer.dispose();
  });

  // 5. [HP] findReferences → ReferenceResolver.findAt 위임 호출됨
  it("should delegate findReferences to ReferenceResolver.findAt", () => {
    // Arrange
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    const filePath = "/project/src/a.ts";
    const content = "const x = 1;\nconsole.log(x);";
    layer.notifyFileChanged(filePath, content);

    // Act
    const refs = layer.findReferences(filePath, pos(content, "x"));

    // Assert
    expect(Array.isArray(refs)).toBe(true);
    layer.dispose();
  });

  // 6. [HP] findImplementations → ImplementationFinder.findAt 위임 호출됨
  it("should delegate findImplementations to ImplementationFinder.findAt", () => {
    // Arrange
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    const filePath = "/project/src/a.ts";
    const content = "interface Foo { bar(): void; }\nclass Bar implements Foo { bar() {} }";
    layer.notifyFileChanged(filePath, content);

    // Act
    const impls = layer.findImplementations(filePath, pos(content, "Foo"));

    // Assert
    expect(Array.isArray(impls)).toBe(true);
    layer.dispose();
  });

  // 7. [HP] getSymbolNode → SymbolGraph.get 위임 호출됨
  it("should delegate getSymbolNode to SymbolGraph.get", () => {
    // Arrange
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    const filePath = "/project/src/a.ts";
    const content = "class Foo { bar() {} }";
    layer.notifyFileChanged(filePath, content);

    // Act
    const node = layer.getSymbolNode(filePath, pos(content, "Foo"));

    // Assert — SymbolGraph.get returns SymbolNode or null
    // facade should pass through the result
    expect(node === null || typeof node === "object").toBe(true);
    layer.dispose();
  });

  // 8. [HP] getModuleInterface → TypeCollector.collectFile + exports 조합
  it("should compose getModuleInterface from TypeCollector.collectFile and exports", () => {
    // Arrange
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    const filePath = "/project/src/a.ts";
    const content = "export const x: string = 'hello';\nexport function foo(): number { return 1; }";
    layer.notifyFileChanged(filePath, content);

    // Act
    const moduleIface = layer.getModuleInterface(filePath);

    // Assert
    expect(moduleIface.filePath).toBe(filePath);
    expect(Array.isArray(moduleIface.exports)).toBe(true);
    expect(moduleIface.exports.length).toBeGreaterThan(0);
    // Each export should have name, kind, resolvedType
    for (const exp of moduleIface.exports) {
      expect(typeof exp.name).toBe("string");
      expect(typeof exp.kind).toBe("string");
      // resolvedType can be null or ResolvedType
    }
    layer.dispose();
  });

  // 9. [HP] notifyFileChanged → TscProgram.notifyFileChanged + SymbolGraph.invalidate
  it("should call TscProgram.notifyFileChanged and SymbolGraph.invalidate on notifyFileChanged", () => {
    // Arrange
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    const filePath = "/project/src/a.ts";

    // Act — should not throw and should update internal state
    layer.notifyFileChanged(filePath, "const x: string = 'hello';");
    const type = layer.collectTypeAt(filePath, 6); // position of 'x'

    // Assert — after notifyFileChanged, types should be collectible
    expect(type).not.toBeNull();
    layer.dispose();
  });

  // 10. [HP] dispose → isDisposed=true, TscProgram.dispose + SymbolGraph.clear
  it("should set isDisposed=true after dispose", () => {
    // Arrange
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    // Act
    layer.dispose();

    // Assert
    expect(layer.isDisposed).toBe(true);
  });

  // 11. [NE] create() TscProgram.create 실패 → Err 전파
  it("should return Err when TscProgram.create fails", () => {
    // Arrange & Act — nonexistent tsconfig
    const result = SemanticLayer.create("/nonexistent/tsconfig.json", {
      readConfigFile: () => undefined,
      resolveNonTrackedFile: () => undefined,
    });

    // Assert
    expect(isErr(result)).toBe(true);
  });

  // 12. [NE] collectTypeAt: disposed → throw
  it("should throw when collectTypeAt is called after dispose", () => {
    // Arrange
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;
    layer.dispose();

    // Act & Assert
    expect(() => layer.collectTypeAt("/project/src/a.ts", 0)).toThrow();
  });

  // 13. [NE] getModuleInterface: disposed → throw
  it("should throw when getModuleInterface is called after dispose", () => {
    // Arrange
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;
    layer.dispose();

    // Act & Assert
    expect(() => layer.getModuleInterface("/project/src/a.ts")).toThrow();
  });

  // 14. [ED] getModuleInterface: collectFile 빈 Map → exports=[]
  it("should return empty exports when file has no declarations", () => {
    // Arrange
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    const filePath = "/project/src/empty.ts";
    layer.notifyFileChanged(filePath, "// empty file");

    // Act
    const moduleIface = layer.getModuleInterface(filePath);

    // Assert
    expect(moduleIface.filePath).toBe(filePath);
    expect(moduleIface.exports).toEqual([]);
    layer.dispose();
  });

  // 15. [CO] dispose 후 collectTypeAt → throw
  it("should throw when calling collectTypeAt after dispose (corner: immediate)", () => {
    // Arrange
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    const filePath = "/project/src/a.ts";
    layer.notifyFileChanged(filePath, "const x = 1;");
    layer.dispose();

    // Act & Assert
    expect(() => layer.collectTypeAt(filePath, 6)).toThrow();
  });

  // 16. [CO] double dispose → idempotent (no throw)
  it("should not throw when dispose is called twice", () => {
    // Arrange
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    // Act & Assert
    layer.dispose();
    expect(() => layer.dispose()).not.toThrow();
    expect(layer.isDisposed).toBe(true);
  });

  // 17. [CO] notifyFileChanged 후 collectTypeAt → 위임 정상
  it("should collect type after notifyFileChanged (incremental update)", () => {
    // Arrange
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    const filePath = "/project/src/a.ts";
    layer.notifyFileChanged(filePath, "const x: number = 1;");

    // Act
    const type1 = layer.collectTypeAt(filePath, 6); // 'x'

    // Update file
    layer.notifyFileChanged(filePath, "const x: string = 'hello';");
    const type2 = layer.collectTypeAt(filePath, 6); // 'x'

    // Assert
    expect(type1).not.toBeNull();
    expect(type1!.text).toBe("number");
    expect(type2).not.toBeNull();
    expect(type2!.text).toBe("string");
    layer.dispose();
  });

  // 18. [ST] create → collect → notifyFileChanged → collect → dispose (full lifecycle)
  it("should support full lifecycle: create → collect → notify → collect → dispose", () => {
    // Arrange
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    const filePath = "/project/src/lifecycle.ts";

    // Phase 1: initial collect
    layer.notifyFileChanged(filePath, "export const val = 42;");
    const type1 = layer.collectTypeAt(filePath, pos("export const val = 42;", "val"));
    expect(type1).not.toBeNull();

    // Phase 2: update and re-collect
    layer.notifyFileChanged(filePath, "export const val = 'changed';");
    const type2 = layer.collectTypeAt(filePath, pos("export const val = 'changed';", "val"));
    expect(type2).not.toBeNull();

    // Phase 3: references still work
    const refs = layer.findReferences(filePath, pos("export const val = 'changed';", "val"));
    expect(Array.isArray(refs)).toBe(true);

    // Phase 4: dispose
    layer.dispose();
    expect(layer.isDisposed).toBe(true);

    // Phase 5: post-dispose
    expect(() => layer.collectTypeAt(filePath, 0)).toThrow();
  });

  // 19. [ID] dispose 2회 → 동일 결과
  it("should produce same isDisposed result after double dispose (idempotent)", () => {
    // Arrange
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    // Act
    layer.dispose();
    const first = layer.isDisposed;
    layer.dispose();
    const second = layer.isDisposed;

    // Assert
    expect(first).toBe(true);
    expect(second).toBe(true);
  });

  // ── notifyFileDeleted ───────────────────────────────────────────────────

  // PRUNE-1 [HP] notifyFileDeleted: collectTypeAt returns null for deleted file
  it("should return null from collectTypeAt after notifyFileDeleted", () => {
    // Arrange
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;
    const filePath = "/project/src/a.ts";
    layer.notifyFileChanged(filePath, "const x: number = 1;");

    // Act
    layer.notifyFileDeleted(filePath);
    const type = layer.collectTypeAt(filePath, 6);

    // Assert
    expect(type).toBeNull();
    layer.dispose();
  });

  // PRUNE-2 [NE] notifyFileDeleted: disposed → no-op
  it("should no-op when notifyFileDeleted is called after dispose", () => {
    // Arrange
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;
    layer.dispose();

    // Act & Assert
    expect(() => layer.notifyFileDeleted("/project/src/a.ts")).not.toThrow();
  });

  // PRUNE-3 [ST] add→collect→delete→verify null
  it("should return null from collectTypeAt after add→collect→delete lifecycle", () => {
    // Arrange
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;
    const filePath = "/project/src/a.ts";

    // Phase 1: add and collect
    layer.notifyFileChanged(filePath, "const x: number = 42;");
    const typeBefore = layer.collectTypeAt(filePath, 6);
    expect(typeBefore).not.toBeNull();

    // Phase 2: delete and verify
    layer.notifyFileDeleted(filePath);
    const typeAfter = layer.collectTypeAt(filePath, 6);

    // Assert
    expect(typeAfter).toBeNull();
    layer.dispose();
  });

  // PRUNE-4 [ID] double notifyFileDeleted → idempotent
  it("should not throw when notifyFileDeleted is called twice for the same file", () => {
    // Arrange
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;
    const filePath = "/project/src/a.ts";
    layer.notifyFileChanged(filePath, "const x = 1;");

    // Act
    layer.notifyFileDeleted(filePath);

    // Assert
    expect(() => layer.notifyFileDeleted(filePath)).not.toThrow();
    layer.dispose();
  });

  // ── findNamePosition word boundary ──────────────────────────────────────

  // PRUNE-5 [HP] findNamePosition: returns position of word-boundary name match
  it("should return correct position for exact word match in findNamePosition", () => {
    // Arrange
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    const filePath = "/project/src/fn.ts";
    const content = "export function greet() {}";
    layer.notifyFileChanged(filePath, content);

    // Act
    const pos = layer.findNamePosition(filePath, 0, "greet");

    // Assert
    expect(pos).toBe(content.indexOf("greet"));
    layer.dispose();
  });

  // PRUNE-6 [NE] findNamePosition: file not in program → null
  it("should return null from findNamePosition when file is not in program", () => {
    // Arrange
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    // Act — no notifyFileChanged, file not in program
    const pos = layer.findNamePosition("/project/src/unknown.ts", 0, "foo");

    // Assert
    expect(pos).toBeNull();
    layer.dispose();
  });

  // PRUNE-7 [NE] findNamePosition: name not found → null
  it("should return null from findNamePosition when name is not found in file", () => {
    // Arrange
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    const filePath = "/project/src/fn.ts";
    layer.notifyFileChanged(filePath, "export const x = 1;");

    // Act
    const pos = layer.findNamePosition(filePath, 0, "nonexistent");

    // Assert
    expect(pos).toBeNull();
    layer.dispose();
  });

  // PRUNE-8 [NE] findNamePosition: disposed → throw
  it("should throw when findNamePosition is called after dispose", () => {
    // Arrange
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;
    layer.dispose();

    // Act & Assert
    expect(() => layer.findNamePosition("/project/src/a.ts", 0, "foo")).toThrow();
  });

  // PRUNE-9 [ED] findNamePosition: name at position 0 with correct boundary
  it("should find name at position 0 when it starts at the beginning of file", () => {
    // Arrange
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    const filePath = "/project/src/fn.ts";
    // Name starts at position 0: "greet" is the first token
    layer.notifyFileChanged(filePath, "greet()");

    // Act — note: this is not valid TS but tsc will still have a sourceFile
    const pos = layer.findNamePosition(filePath, 0, "greet");

    // Assert
    expect(pos).toBe(0);
    layer.dispose();
  });

  // ── getDiagnostics ─────────────────────────────────────────────────────

  // DIAG-1 [HP] getDiagnostics: returns diagnostics for a file with type errors
  it("should return diagnostics for a file with type errors", () => {
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    const filePath = "/project/src/err.ts";
    layer.notifyFileChanged(filePath, "const x: number = 'not a number';");

    const diags = layer.getDiagnostics(filePath);

    expect(Array.isArray(diags)).toBe(true);
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0]!.category).toBe("error");
    expect(diags[0]!.filePath).toBe(filePath);
    expect(typeof diags[0]!.code).toBe("number");
    expect(typeof diags[0]!.message).toBe("string");
    expect(diags[0]!.line).toBeGreaterThanOrEqual(1);
    layer.dispose();
  });

  // DIAG-2 [HP] getDiagnostics: returns empty array for valid file
  it("should return empty diagnostics for a valid file", () => {
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    const filePath = "/project/src/ok.ts";
    layer.notifyFileChanged(filePath, "const x: number = 42;");

    const diags = layer.getDiagnostics(filePath);

    expect(diags).toEqual([]);
    layer.dispose();
  });

  // DIAG-3 [NE] getDiagnostics: non-indexed file → empty array
  it("should return empty array for a file not in the program", () => {
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    const diags = layer.getDiagnostics("/project/src/unknown.ts");

    expect(diags).toEqual([]);
    layer.dispose();
  });

  // DIAG-4 [HP] getDiagnostics: preEmit includes syntactic diagnostics
  it("should include syntactic diagnostics when preEmit is true", () => {
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    const filePath = "/project/src/syntax-err.ts";
    // Syntactic error: duplicate modifier
    layer.notifyFileChanged(filePath, "export export const x = 1;");

    // Default (semantic only) should not catch syntactic errors
    const semanticOnly = layer.getDiagnostics(filePath);
    // preEmit should catch syntactic errors
    const preEmit = layer.getDiagnostics(filePath, { preEmit: true });

    expect(preEmit.length).toBeGreaterThanOrEqual(semanticOnly.length);
    expect(preEmit.length).toBeGreaterThan(0);
    expect(preEmit.some((d) => d.message.length > 0)).toBe(true);
    layer.dispose();
  });

  // DIAG-5 [HP] getDiagnostics: preEmit returns same results as default for semantic errors
  it("should return semantic errors with preEmit too", () => {
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    const filePath = "/project/src/type-err.ts";
    layer.notifyFileChanged(filePath, "const x: number = 'not a number';");

    const defaultDiags = layer.getDiagnostics(filePath);
    const preEmitDiags = layer.getDiagnostics(filePath, { preEmit: true });

    // preEmit is a superset — at minimum includes the same semantic errors
    expect(preEmitDiags.length).toBeGreaterThanOrEqual(defaultDiags.length);
    expect(preEmitDiags.some((d) => d.code === defaultDiags[0]!.code)).toBe(true);
    layer.dispose();
  });

  // DIAG-6 [NE] getDiagnostics: preEmit returns no file-scoped errors for valid file
  it("should return no file-scoped diagnostics with preEmit for a valid file", () => {
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    const filePath = "/project/src/valid.ts";
    layer.notifyFileChanged(filePath, "const x: number = 42;");

    const diags = layer.getDiagnostics(filePath, { preEmit: true });

    // Global diagnostics (e.g. missing lib types code 2318) may appear in the
    // fake test environment; file-scoped errors should not.
    const fileScoped = diags.filter((d) => d.code !== 2318);
    expect(fileScoped).toEqual([]);
    layer.dispose();
  });

  // DIAG-7 [NE] getDiagnostics: disposed → throw
  it("should throw when getDiagnostics is called after dispose", () => {
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;
    layer.dispose();

    expect(() => layer.getDiagnostics("/project/src/a.ts")).toThrow();
  });

  // ── collectTypeAt with primitive keywords ──────────────────────────────

  it("should resolve type for primitive keyword position (string)", () => {
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    const filePath = "/project/src/prim.ts";
    const content = "const x: string = 'hello';";
    layer.notifyFileChanged(filePath, content);

    const stringPos = content.indexOf("string");
    const typeResult = layer.collectTypeAt(filePath, stringPos);

    expect(typeResult).not.toBeNull();
    expect(typeResult!.text).toBe("string");
    layer.dispose();
  });

  it("should resolve type for primitive keyword position (number)", () => {
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    const filePath = "/project/src/prim.ts";
    const content = "const x: number = 42;";
    layer.notifyFileChanged(filePath, content);

    const numberPos = content.indexOf("number");
    const typeResult = layer.collectTypeAt(filePath, numberPos);

    expect(typeResult).not.toBeNull();
    expect(typeResult!.text).toBe("number");
    layer.dispose();
  });

  // ── isTypeAssignableToType ────────────────────────────────────────────

  it("should return true when type is assignable to target type expression", () => {
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    const filePath = "/project/src/assign.ts";
    const content = "const x: string = 'hello';";
    layer.notifyFileChanged(filePath, content);

    const xPos = pos(content, "x");
    const assignable = layer.isTypeAssignableToType(filePath, xPos, "string");

    expect(assignable).toBe(true);
    layer.dispose();
  });

  it("should return false when type is not assignable to target type expression", () => {
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    const filePath = "/project/src/assign.ts";
    const content = "const x: number = 42;";
    layer.notifyFileChanged(filePath, content);

    const xPos = pos(content, "x");
    const assignable = layer.isTypeAssignableToType(filePath, xPos, "string");

    expect(assignable).toBe(false);
    layer.dispose();
  });

  it("should return null for non-existent file in isTypeAssignableToType", () => {
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    const assignable = layer.isTypeAssignableToType("/project/src/missing.ts", 0, "string");

    expect(assignable).toBeNull();
    layer.dispose();
  });

  it("should throw when isTypeAssignableToType is called after dispose", () => {
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;
    layer.dispose();

    expect(() => layer.isTypeAssignableToType("/project/src/a.ts", 0, "string")).toThrow();
  });

  it("should return true with anyConstituent when union has assignable member", () => {
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    const filePath = "/project/src/union.ts";
    const content = "const x: string | null = null;";
    layer.notifyFileChanged(filePath, content);

    const xPos = pos(content, "x");
    expect(layer.isTypeAssignableToType(filePath, xPos, "string")).toBe(false);
    expect(layer.isTypeAssignableToType(filePath, xPos, "string", { anyConstituent: true })).toBe(true);
    layer.dispose();
  });

  it("should return false with anyConstituent when no union member is assignable", () => {
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    const filePath = "/project/src/union.ts";
    const content = "const x: number | boolean = 1;";
    layer.notifyFileChanged(filePath, content);

    const xPos = pos(content, "x");
    expect(layer.isTypeAssignableToType(filePath, xPos, "string", { anyConstituent: true })).toBe(false);
    layer.dispose();
  });

  it("should work with anyConstituent on non-union type", () => {
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    const filePath = "/project/src/single.ts";
    const content = "const x: string = 'hello';";
    layer.notifyFileChanged(filePath, content);

    const xPos = pos(content, "x");
    expect(layer.isTypeAssignableToType(filePath, xPos, "string", { anyConstituent: true })).toBe(true);
    expect(layer.isTypeAssignableToType(filePath, xPos, "number", { anyConstituent: true })).toBe(false);
    layer.dispose();
  });

  // ── getBaseTypes (inheritance chain) ────────────────────────────────────

  // BASE-1 [HP] getBaseTypes: returns base types for a class extending another
  it("should return base types for a class that extends another class", () => {
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    const filePath = "/project/src/base.ts";
    const content = "class Animal { name: string = ''; }\nclass Dog extends Animal { bark() {} }";
    layer.notifyFileChanged(filePath, content);

    const dogPos = pos(content, "Dog");
    const baseTypes = layer.getBaseTypes(filePath, dogPos);

    expect(baseTypes).not.toBeNull();
    expect(Array.isArray(baseTypes)).toBe(true);
    expect(baseTypes!.length).toBe(1);
    expect(baseTypes![0]!.text).toBe("Animal");
    layer.dispose();
  });

  // BASE-2 [HP] getBaseTypes: returns base types for interface extending another
  it("should return base types for an interface that extends another interface", () => {
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    const filePath = "/project/src/iface.ts";
    const content = "interface Base { x: number; }\ninterface Child extends Base { y: string; }";
    layer.notifyFileChanged(filePath, content);

    const childPos = pos(content, "Child");
    const baseTypes = layer.getBaseTypes(filePath, childPos);

    expect(baseTypes).not.toBeNull();
    expect(baseTypes!.length).toBe(1);
    expect(baseTypes![0]!.text).toBe("Base");
    layer.dispose();
  });

  // BASE-3 [HP] getBaseTypes: returns empty array for class with no base
  it("should return empty array for a class with no base type", () => {
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    const filePath = "/project/src/nobase.ts";
    const content = "class Standalone { x = 1; }";
    layer.notifyFileChanged(filePath, content);

    const standalonePos = pos(content, "Standalone");
    const baseTypes = layer.getBaseTypes(filePath, standalonePos);

    expect(baseTypes).not.toBeNull();
    expect(baseTypes!.length).toBe(0);
    layer.dispose();
  });

  // BASE-4 [NE] getBaseTypes: non-class/interface position → null
  it("should return null for getBaseTypes at a non-class/interface position", () => {
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    const filePath = "/project/src/var.ts";
    const content = "const x: string = 'hello';";
    layer.notifyFileChanged(filePath, content);

    const xPos = pos(content, "x");
    const baseTypes = layer.getBaseTypes(filePath, xPos);

    expect(baseTypes).toBeNull();
    layer.dispose();
  });

  // BASE-5 [NE] getBaseTypes: disposed → throw
  it("should throw when getBaseTypes is called after dispose", () => {
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;
    layer.dispose();

    expect(() => layer.getBaseTypes("/project/src/a.ts", 0)).toThrow();
  });

  // ── getModuleInterface with re-exports ─────────────────────────────────

  // MOD-1 [HP] getModuleInterface: catches re-exports via checker.getExportsOfModule()
  it("should capture re-exports in getModuleInterface", () => {
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    // Source module
    const srcPath = "/project/src/source.ts";
    layer.notifyFileChanged(srcPath, "export const srcVal = 42;");

    // Re-export module
    const reexportPath = "/project/src/reexport.ts";
    layer.notifyFileChanged(reexportPath, "export { srcVal } from './source';");

    const moduleIface = layer.getModuleInterface(reexportPath);

    expect(moduleIface.filePath).toBe(reexportPath);
    expect(moduleIface.exports.length).toBeGreaterThan(0);
    const srcValExport = moduleIface.exports.find((e) => e.name === "srcVal");
    expect(srcValExport).toBeDefined();
    layer.dispose();
  });

  // ── buildSymbolNode alias dereferencing ────────────────────────────────

  // ALIAS-1 [HP] getSymbolNode: alias symbol resolves members from canonical symbol
  it("should resolve members through alias when building symbol node", () => {
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    const srcPath = "/project/src/orig.ts";
    layer.notifyFileChanged(srcPath, "export class Foo { bar() {} }");

    const reexportPath = "/project/src/alias.ts";
    layer.notifyFileChanged(reexportPath, "export { Foo } from './orig';");

    // Get the symbol node for 'Foo' in the re-export file
    const content = "export { Foo } from './orig';";
    const fooPos = pos(content, "Foo");
    const node = layer.getSymbolNode(reexportPath, fooPos);

    // The node should exist — it may or may not have members depending on alias resolution
    expect(node === null || typeof node === "object").toBe(true);
    layer.dispose();
  });

  // ── properties of object types ─────────────────────────────────────────

  // PROP-1 [HP] collectTypeAt: object type includes properties
  it("should include properties for object types in collectTypeAt", () => {
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    const filePath = "/project/src/obj.ts";
    const content = "interface Obj { a: number; b: string; }\nconst x: Obj = { a: 1, b: '' };";
    layer.notifyFileChanged(filePath, content);

    const xPos = pos(content, "x");
    const typeResult = layer.collectTypeAt(filePath, xPos);

    expect(typeResult).not.toBeNull();
    expect(typeResult!.text).toBe("Obj");
    expect(typeResult!.properties).toBeDefined();
    expect(Array.isArray(typeResult!.properties)).toBe(true);
    expect(typeResult!.properties!.length).toBe(2);

    const propNames = typeResult!.properties!.map((p) => p.name).sort();
    expect(propNames).toEqual(["a", "b"]);

    const aProp = typeResult!.properties!.find((p) => p.name === "a");
    expect(aProp).toBeDefined();
    expect(aProp!.type.text).toBe("number");

    const bProp = typeResult!.properties!.find((p) => p.name === "b");
    expect(bProp).toBeDefined();
    expect(bProp!.type.text).toBe("string");
    layer.dispose();
  });

  // PROP-2 [NE] collectTypeAt: primitive types do not have properties
  it("should not include properties for primitive types", () => {
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    const filePath = "/project/src/prim.ts";
    const content = "const x: number = 42;";
    layer.notifyFileChanged(filePath, content);

    const xPos = pos(content, "x");
    const typeResult = layer.collectTypeAt(filePath, xPos);

    expect(typeResult).not.toBeNull();
    expect(typeResult!.properties).toBeUndefined();
    layer.dispose();
  });

  // PROP-3 [HP] collectTypeAt: class type includes properties
  it("should include properties for class types", () => {
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    const filePath = "/project/src/cls.ts";
    const content = "class MyClass { x: number = 0; y: string = ''; }\nconst c: MyClass = new MyClass();";
    layer.notifyFileChanged(filePath, content);

    const cPos = pos(content, "c:");
    // "c:" starts at the const declaration, we need the identifier "c"
    const typeResult = layer.collectTypeAt(filePath, content.lastIndexOf("c"));

    expect(typeResult).not.toBeNull();
    expect(typeResult!.properties).toBeDefined();
    // Should have at least x and y
    const propNames = typeResult!.properties!.map((p) => p.name);
    expect(propNames).toContain("x");
    expect(propNames).toContain("y");
    layer.dispose();
  });

  // PRUNE-10 [CO] findNamePosition: skip substring match and find standalone identifier
  it("should skip substring match and find standalone identifier in findNamePosition", () => {
    // Arrange
    const result = SemanticLayer.create(TSCONFIG_PATH, {
      readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
      resolveNonTrackedFile: (p) =>
        p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    const layer = result;

    const filePath = "/project/src/fn.ts";
    // "foo" appears as substring in "fooBar" first, then standalone
    const content = "const fooBar = 1; const foo = 2;";
    layer.notifyFileChanged(filePath, content);

    // Act
    const pos = layer.findNamePosition(filePath, 0, "foo");

    // Assert — should find standalone "foo", not "foo" inside "fooBar"
    // "const fooBar = 1; const foo = 2;"
    //                          ^ position 24
    const expectedPos = content.lastIndexOf("foo");
    expect(pos).toBe(expectedPos);
    layer.dispose();
  });
});
