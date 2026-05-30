import ts from "typescript";
import { describe, expect, it } from "bun:test";
import { isErr } from "@zipbul/result";
import type { GildashError } from "../errors";
import { TscProgram } from "./tsc-program";
import { TypeCollector } from "./type-collector";

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

/** Position of first occurrence of `marker` in `content`. */
function pos(content: string, marker: string): number {
  const idx = content.indexOf(marker);
  if (idx === -1) throw new Error(`marker "${marker}" not found in content`);
  return idx;
}

// ── TypeCollector ─────────────────────────────────────────────────────────────

describe("TypeCollector", () => {
  // 1. [HP] `const x: string` → text="string", isUnion=false, isGeneric=false
  it("should return string type when symbol has string annotation", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/a.ts";
    const content = "const x: string = 'hello';";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt(filePath, pos(content, "x"));

    // Assert
    expect(result).not.toBeNull();
    expect(result!.text).toBe("string");
    expect(result!.isUnion).toBe(false);
    expect(result!.isIntersection).toBe(false);
    expect(result!.isGeneric).toBe(false);
  });

  // 2. [HP] `const x: any` → text="any"
  it("should return any type when symbol has any annotation", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/b.ts";
    const content = "const x: any = 1;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt(filePath, pos(content, "x"));

    // Assert
    expect(result).not.toBeNull();
    expect(result!.text).toBe("any");
  });

  // 3. [HP] `const x: never` → text="never"
  it("should return never type when symbol has never annotation", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/c.ts";
    const content = "declare const x: never;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt(filePath, pos(content, "x"));

    // Assert
    expect(result).not.toBeNull();
    expect(result!.text).toBe("never");
    expect(result!.isUnion).toBe(false);
    expect(result!.isGeneric).toBe(false);
  });

  // 4. [HP] `const x: string | undefined` → isUnion=true, members.length=2
  it("should return union type with two members when symbol has string or undefined annotation", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/d.ts";
    const content = "const x: string | undefined = undefined;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt(filePath, pos(content, "x"));

    // Assert
    expect(result).not.toBeNull();
    expect(result!.isUnion).toBe(true);
    expect(result!.members).toBeDefined();
    expect(result!.members!.length).toBe(2);
    const texts = result!.members!.map((m) => m.text);
    expect(texts).toContain("string");
    expect(texts).toContain("undefined");
  });

  // 5. [HP] `const x: A & B` → isIntersection=true, members.length=2
  it("should return intersection type with two members when symbol uses intersection annotation", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/e.ts";
    const content = [
      "interface A { a: string }",
      "interface B { b: number }",
      "declare const x: A & B;",
    ].join("\n");
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt(filePath, content.lastIndexOf("x"));

    // Assert
    expect(result).not.toBeNull();
    expect(result!.isIntersection).toBe(true);
    expect(result!.members).toBeDefined();
    expect(result!.members!.length).toBe(2);
  });

  // 6. [HP] 인라인 generic 클래스 → isGeneric=true, typeArguments[0].text="number"
  it("should return generic type with number type argument when symbol has Promise<number> annotation", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/f.ts";
    const content = "declare class Async<T> { v: T }; declare const myConst: Async<number>;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt(filePath, pos(content, "myConst"));

    // Assert
    expect(result).not.toBeNull();
    expect(result!.isGeneric).toBe(true);
    expect(result!.typeArguments).toBeDefined();
    expect(result!.typeArguments!.length).toBeGreaterThanOrEqual(1);
    expect(result!.typeArguments![0]!.text).toBe("number");
  });

  // 7. [HP] `function f(): void {}` → 함수 타입 text 반환
  it("should return function type text when symbol is a function declaration", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/g.ts";
    const content = "function greet(): void {}";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt(filePath, pos(content, "greet"));

    // Assert
    expect(result).not.toBeNull();
    expect(result!.text).toContain("void");
  });

  // 8. [HP] `interface Foo { x: string }` → 인터페이스 타입 수집
  it("should return interface type when symbol is an interface declaration", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/h.ts";
    const content = "interface Foo { x: string }";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt(filePath, pos(content, "Foo"));

    // Assert
    expect(result).not.toBeNull();
    expect(result!.text).toContain("Foo");
  });

  // 9. [HP] `42 as const` 리터럴 타입 → text가 숫자 리터럴 포함
  it("should return numeric literal type when symbol uses as const assertion", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/i.ts";
    const content = "const x = 42 as const;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt(filePath, pos(content, "x"));

    // Assert
    expect(result).not.toBeNull();
    expect(result!.text).toContain("42");
  });

  // 10. [HP] collectFile 정상 파일 → Map size > 0
  it("should return non-empty map when collecting all symbols from a file with declarations", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/j.ts";
    const content = [
      "const a: string = 'a';",
      "const b: number = 1;",
      "const c: boolean = true;",
    ].join("\n");
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectFile(filePath);

    // Assert
    expect(result.size).toBeGreaterThan(0);
  });

  // 11. [HP] 인라인 2-param generic 클래스 → typeArguments.length=2
  it("should return two type arguments when symbol has Map<string, number> annotation", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/k.ts";
    const content = "declare class Pair<K, V> { k: K; v: V }; declare const myConst: Pair<string, number>;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt(filePath, pos(content, "myConst"));

    // Assert
    expect(result).not.toBeNull();
    expect(result!.isGeneric).toBe(true);
    expect(result!.typeArguments).toBeDefined();
    expect(result!.typeArguments!.length).toBe(2);
    expect(result!.typeArguments![0]!.text).toBe("string");
    expect(result!.typeArguments![1]!.text).toBe("number");
  });

  // 12. [NE] 존재하지 않는 filePath → null
  it("should return null when filePath does not exist in tracked files", () => {
    // Arrange
    const prog = makeProg();
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt("/project/src/nonexistent.ts", 0);

    // Assert
    expect(result).toBeNull();
  });

  // 13. [NE] position=-1 음수 → null
  it("should return null when position is negative", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/l.ts";
    prog.notifyFileChanged(filePath, "const x: string = 'a';");
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt(filePath, -1);

    // Assert
    expect(result).toBeNull();
  });

  // 14. [NE] position > 파일 길이 → null
  it("should return null when position exceeds file length", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/m.ts";
    const content = "const x: string = 'a';";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt(filePath, content.length + 100);

    // Assert
    expect(result).toBeNull();
  });

  // 15. [NE] 파일 있지만 공백 위치 → null
  it("should return null when position points to whitespace", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/n.ts";
    const content = "const x: string = 'a';";
    // position 5 is the space between 'const' and 'x'
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt(filePath, 5);

    // Assert
    expect(result).toBeNull();
  });

  // 16. [NE] 파일 있지만 구두점(;) 위치 → null
  it("should return null when position points to semicolon punctuation", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/o.ts";
    const content = "const x: string = 'a';";
    // last char is ';'
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt(filePath, content.length - 1);

    // Assert
    expect(result).toBeNull();
  });

  // 17. [NE] 문법 오류 파일의 유효하지 않은 위치 → null
  it("should return null when file has syntax error and position has no valid symbol", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/p.ts";
    const content = "const = 'broken';";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act — position 6 points to '=' operator, no symbol
    const result = collector.collectAt(filePath, 6);

    // Assert
    expect(result).toBeNull();
  });

  // 18. [NE] disposed TscProgram → throw
  it("should throw when TscProgram has been disposed", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/q.ts";
    prog.notifyFileChanged(filePath, "const x: string = 'a';");
    prog.dispose();
    const collector = new TypeCollector(prog);

    // Act & Assert
    expect(() => collector.collectAt(filePath, 6)).toThrow();
  });

  // 19. [NE] collectFile 존재하지 않는 파일 → 빈 Map
  it("should return empty map when collectFile is given a nonexistent file path", () => {
    // Arrange
    const prog = makeProg();
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectFile("/project/src/ghost.ts");

    // Assert
    expect(result.size).toBe(0);
  });

  // 20. [ED] position이 identifier 첫 문자 → valid type
  it("should return valid type when position points to first character of identifier", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/r.ts";
    const content = "const myVar: number = 10;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);
    const firstChar = content.indexOf("myVar"); // first char of identifier

    // Act
    const result = collector.collectAt(filePath, firstChar);

    // Assert
    expect(result).not.toBeNull();
    expect(result!.text).toBe("number");
  });

  // 21. [ED] position이 identifier 마지막 문자 → valid type
  it("should return valid type when position points to last character of identifier", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/s.ts";
    const content = "const myVar: number = 10;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);
    const lastChar = content.indexOf("myVar") + "myVar".length - 1; // last char of identifier

    // Act
    const result = collector.collectAt(filePath, lastChar);

    // Assert
    expect(result).not.toBeNull();
    expect(result!.text).toBe("number");
  });

  // 22. [ED] `const x = {}` 빈 object literal → `{}` 타입
  it("should return empty object type when symbol is initialized with empty object literal", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/t.ts";
    const content = "const x = {};";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt(filePath, pos(content, "x"));

    // Assert
    expect(result).not.toBeNull();
    expect(result!.text).toContain("{}");
  });

  // 23. [CO] `string | Wrap<number>` → isUnion=true, members 중 하나가 isGeneric=true
  it("should return union type where one member is generic when symbol has string or Promise<number> annotation", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/u.ts";
    const content = "declare class Wrap<T> { v: T }; declare const myConst: string | Wrap<number>;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt(filePath, pos(content, "myConst"));

    // Assert
    expect(result).not.toBeNull();
    expect(result!.isUnion).toBe(true);
    expect(result!.members).toBeDefined();
    const hasGenericMember = result!.members!.some((m) => m.isGeneric && m.typeArguments !== undefined);
    expect(hasGenericMember).toBe(true);
  });

  // 24. [CO] `(A & B) | C` → union members 중 하나가 isIntersection=true
  it("should return union with an intersection member when symbol uses (A and B) or C annotation", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/v.ts";
    const content = [
      "interface A { a: string }",
      "interface B { b: number }",
      "interface C { c: boolean }",
      "declare const x: (A & B) | C;",
    ].join("\n");
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt(filePath, content.lastIndexOf("x"));

    // Assert
    expect(result).not.toBeNull();
    expect(result!.isUnion).toBe(true);
    expect(result!.members).toBeDefined();
    const hasIntersectionMember = result!.members!.some((m) => m.isIntersection);
    expect(hasIntersectionMember).toBe(true);
  });

  // 25. [CO] 3단 중첩 generic → typeArguments 재귀 정상
  it("should return deeply nested generic type arguments when symbol has three-level generic annotation", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/w.ts";
    const content = [
      "declare class Box<T> { v: T }",
      "declare class List<T> { items: T }",
      "declare class Dict<K, V> { k: K; v: V }",
      "declare const myConst: Dict<string, List<Box<number>>>;",
    ].join(" ");
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt(filePath, pos(content, "myConst"));

    // Assert
    expect(result).not.toBeNull();
    expect(result!.isGeneric).toBe(true);
    expect(result!.typeArguments).toBeDefined();
    expect(result!.typeArguments!.length).toBe(2);
    // second type arg is List<Box<number>>
    const listArg = result!.typeArguments![1]!;
    expect(listArg.isGeneric).toBe(true);
    expect(listArg.typeArguments).toBeDefined();
    // inner Box<number>
    const boxArg = listArg.typeArguments![0]!;
    expect(boxArg.isGeneric).toBe(true);
    expect(boxArg.typeArguments![0]!.text).toBe("number");
  });

  // 26. [ST] construct → collectAt 호출 → valid ResolvedType
  it("should return valid ResolvedType when collector is freshly constructed and file is tracked", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/x.ts";
    const content = "const value: boolean = true;";
    prog.notifyFileChanged(filePath, content);

    // Act
    const collector = new TypeCollector(prog);
    const result = collector.collectAt(filePath, pos(content, "value"));

    // Assert
    expect(result).not.toBeNull();
    expect(result!.text).toBe("boolean");
  });

  // 27. [ST] notifyFileChanged 이전 collectAt → null, 이후 collectAt → valid
  it("should return null before file is tracked and valid type after file is tracked", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/y.ts";
    const content = "const item: string = 'test';";
    const collector = new TypeCollector(prog);

    // Act — before notify
    const before = collector.collectAt(filePath, pos(content, "item"));

    // Act — after notify
    prog.notifyFileChanged(filePath, content);
    const after = collector.collectAt(filePath, pos(content, "item"));

    // Assert
    expect(before).toBeNull();
    expect(after).not.toBeNull();
    expect(after!.text).toBe("string");
  });

  // 28. [ST] notifyFileChanged(타입 변경) → collectAt → 새 타입 반영
  it("should return updated type when file content is changed via notifyFileChanged", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/z.ts";
    const content1 = "const data: string = 'hello';";
    const content2 = "const data: number = 42;";
    prog.notifyFileChanged(filePath, content1);
    const collector = new TypeCollector(prog);

    // Act — initial type
    const first = collector.collectAt(filePath, pos(content1, "data"));
    expect(first?.text).toBe("string");

    // Act — after update
    prog.notifyFileChanged(filePath, content2);
    const second = collector.collectAt(filePath, pos(content2, "data"));

    // Assert
    expect(second).not.toBeNull();
    expect(second!.text).toBe("number");
  });

  // 29. [ST] construct → dispose → collectAt → throw
  it("should throw when collectAt is called after TscProgram is disposed", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/aa.ts";
    prog.notifyFileChanged(filePath, "const x: string = 'a';");
    const collector = new TypeCollector(prog);
    prog.dispose();

    // Act & Assert
    expect(() => collector.collectAt(filePath, 6)).toThrow();
  });

  // ── collectAtPositions ──────────────────────────────────────────────────────

  it("should resolve multiple positions in a single file at once", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/batch.ts";
    const content = "const a: string = 'x';\nconst b: number = 1;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAtPositions(filePath, [
      pos(content, "a"),
      pos(content, "b"),
    ]);

    // Assert
    expect(result.size).toBe(2);
    expect(result.get(pos(content, "a"))!.text).toBe("string");
    expect(result.get(pos(content, "b"))!.text).toBe("number");
  });

  it("should skip invalid positions and return only resolved ones", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/batch-skip.ts";
    const content = "const a: string = 'x';";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act — includes negative, out-of-range, and non-identifier positions
    const result = collector.collectAtPositions(filePath, [
      -1,
      pos(content, "a"),
      99999,
    ]);

    // Assert
    expect(result.size).toBe(1);
    expect(result.get(pos(content, "a"))!.text).toBe("string");
  });

  it("should return empty map when file is not tracked", () => {
    // Arrange
    const prog = makeProg();
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAtPositions("/project/src/missing.ts", [0, 10]);

    // Assert
    expect(result.size).toBe(0);
  });

  it("should skip positions that point to non-identifier tokens", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/batch-nonid.ts";
    const content = "const a: string = 'hello';";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act — position 0 points to 'const' keyword (not identifier, not type node)
    // position of 'a' is the only resolvable one
    const constPos = 0; // 'c' of 'const'
    const eqPos = content.indexOf("="); // '=' operator
    const result = collector.collectAtPositions(filePath, [
      constPos,
      eqPos,
      pos(content, "a"),
    ]);

    // Assert — only 'a' should resolve
    expect(result.size).toBe(1);
    expect(result.has(pos(content, "a"))).toBe(true);
    expect(result.has(constPos)).toBe(false);
    expect(result.has(eqPos)).toBe(false);
  });

  it("should return empty map when positions array is empty", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/batch-empty.ts";
    prog.notifyFileChanged(filePath, "const a: string = 'x';");
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAtPositions(filePath, []);

    // Assert
    expect(result.size).toBe(0);
  });

  // ── isAssignableTo ──────────────────────────────────────────────────────────

  it("should return true when source type is assignable to target type", () => {
    // Arrange
    const prog = makeProg();
    const srcFile = "/project/src/assign-src.ts";
    const tgtFile = "/project/src/assign-tgt.ts";
    const srcContent = "export const src: string = 'hello';";
    const tgtContent = "export const tgt: string | number = 0;";
    prog.notifyFileChanged(srcFile, srcContent);
    prog.notifyFileChanged(tgtFile, tgtContent);
    const collector = new TypeCollector(prog);

    // Act — string is assignable to string | number
    const result = collector.isAssignableTo(
      srcFile, pos(srcContent, "src"),
      tgtFile, pos(tgtContent, "tgt"),
    );

    // Assert
    expect(result).toBe(true);
  });

  it("should return false when source type is not assignable to target type", () => {
    // Arrange
    const prog = makeProg();
    const srcFile = "/project/src/noassign-src.ts";
    const tgtFile = "/project/src/noassign-tgt.ts";
    const srcContent = "export const src: string | number = 0;";
    const tgtContent = "export const tgt: string = 'x';";
    prog.notifyFileChanged(srcFile, srcContent);
    prog.notifyFileChanged(tgtFile, tgtContent);
    const collector = new TypeCollector(prog);

    // Act — string | number is NOT assignable to string
    const result = collector.isAssignableTo(
      srcFile, pos(srcContent, "src"),
      tgtFile, pos(tgtContent, "tgt"),
    );

    // Assert
    expect(result).toBe(false);
  });

  it("should return null when source file is not in program", () => {
    // Arrange
    const prog = makeProg();
    const tgtFile = "/project/src/tgt-only.ts";
    const tgtContent = "export const tgt: string = 'x';";
    prog.notifyFileChanged(tgtFile, tgtContent);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.isAssignableTo(
      "/project/src/nonexistent.ts", 0,
      tgtFile, pos(tgtContent, "tgt"),
    );

    // Assert
    expect(result).toBeNull();
  });

  it("should return null when position is not an identifier", () => {
    // Arrange
    const prog = makeProg();
    const srcFile = "/project/src/punct-src.ts";
    const tgtFile = "/project/src/punct-tgt.ts";
    const srcContent = "export const src: string = 'hello';";
    const tgtContent = "export const tgt: number = 0;";
    prog.notifyFileChanged(srcFile, srcContent);
    prog.notifyFileChanged(tgtFile, tgtContent);
    const collector = new TypeCollector(prog);

    // Act — position points to semicolon in source
    const result = collector.isAssignableTo(
      srcFile, srcContent.length - 1,
      tgtFile, pos(tgtContent, "tgt"),
    );

    // Assert
    expect(result).toBeNull();
  });

  it("should return true when Array<string> is assignable to Array<unknown>", () => {
    // Arrange
    const prog = makeProg();
    const srcFile = "/project/src/gen-assign-src.ts";
    const tgtFile = "/project/src/gen-assign-tgt.ts";
    const srcContent = "export const src: Array<string> = [];";
    const tgtContent = "export const tgt: Array<unknown> = [];";
    prog.notifyFileChanged(srcFile, srcContent);
    prog.notifyFileChanged(tgtFile, tgtContent);
    const collector = new TypeCollector(prog);

    // Act — Array<string> is assignable to Array<unknown>
    const result = collector.isAssignableTo(
      srcFile, pos(srcContent, "src"),
      tgtFile, pos(tgtContent, "tgt"),
    );

    // Assert
    expect(result).toBe(true);
  });

  // ── isAssignableToTypeAtPositions ────────────────────────────────────────

  it("should return assignability results for multiple positions against a target type", () => {
    const prog = makeProg();
    const filePath = "/project/src/assign-batch.ts";
    const content = "const numA: number = 1;\nconst strB: string = 'x';\nconst numC: number = 2;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    const result = collector.isAssignableToTypeAtPositions(
      filePath,
      [pos(content, "numA"), pos(content, "strB"), pos(content, "numC")],
      "number",
    );

    expect(result.size).toBe(3);
    expect(result.get(pos(content, "numA"))).toBe(true);
    expect(result.get(pos(content, "strB"))).toBe(false);
    expect(result.get(pos(content, "numC"))).toBe(true);
  });

  it("should return empty map when positions array is empty", () => {
    const prog = makeProg();
    const collector = new TypeCollector(prog);
    const result = collector.isAssignableToTypeAtPositions("/project/src/x.ts", [], "string");
    expect(result.size).toBe(0);
  });

  it("should return empty map when file is not tracked", () => {
    const prog = makeProg();
    const collector = new TypeCollector(prog);
    const result = collector.isAssignableToTypeAtPositions("/project/src/missing.ts", [0], "string");
    expect(result.size).toBe(0);
  });

  it("should skip invalid positions and return only valid ones", () => {
    const prog = makeProg();
    const filePath = "/project/src/assign-skip.ts";
    const content = "const a: string = 'hello';";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    const result = collector.isAssignableToTypeAtPositions(
      filePath,
      [-1, pos(content, "a"), 99999],
      "string",
    );

    expect(result.size).toBe(1);
    expect(result.get(pos(content, "a"))).toBe(true);
  });

  it("should support anyConstituent option for union types", () => {
    const prog = makeProg();
    const filePath = "/project/src/assign-union.ts";
    const content = "const x: number | boolean = 0 as any;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // number | boolean is not assignable to number (union is wider)
    const without = collector.isAssignableToTypeAtPositions(filePath, [pos(content, "x")], "number");
    // but with anyConstituent, number member IS assignable to number
    const withOpt = collector.isAssignableToTypeAtPositions(filePath, [pos(content, "x")], "number", { anyConstituent: true });

    expect(without.get(pos(content, "x"))).toBe(false);
    expect(withOpt.get(pos(content, "x"))).toBe(true);
  });

  // 30. [OR] collectAt(A, posA) then collectAt(B, posB) = 역순 → 서로 영향 없음
  it("should return independent results when collecting from two different files in different orders", () => {
    // Arrange
    const prog = makeProg();
    const fileA = "/project/src/file-a.ts";
    const fileB = "/project/src/file-b.ts";
    const contentA = "const alpha: string = 'a';";
    const contentB = "const beta: number = 0;";
    prog.notifyFileChanged(fileA, contentA);
    prog.notifyFileChanged(fileB, contentB);
    const collector = new TypeCollector(prog);

    // Act — A then B
    const a1 = collector.collectAt(fileA, pos(contentA, "alpha"));
    const b1 = collector.collectAt(fileB, pos(contentB, "beta"));

    // Act — B then A (fresh collector, same program)
    const collector2 = new TypeCollector(prog);
    const b2 = collector2.collectAt(fileB, pos(contentB, "beta"));
    const a2 = collector2.collectAt(fileA, pos(contentA, "alpha"));

    // Assert — order does not affect results
    expect(a1!.text).toBe(a2!.text);
    expect(b1!.text).toBe(b2!.text);
    expect(a1!.text).toBe("string");
    expect(b1!.text).toBe("number");
  });
});

// ── Span-based primitives (firebat error-flow) ───────────────────────────────
//
// Unit level uses a FAKE lib (makeProg doubles lib.*.d.ts), so no real `Promise`
// exists here — thenable/void cases use LOCAL types (`interface Thenable`,
// `() => void`, `number`). Real-`Promise<…>` behaviour is covered by the
// integration suite (test/semantic.test.ts), which builds a real tsc program.

import type { ByteSpan } from "./types";

/** Byte span of the `nth` (1-based) occurrence of `needle` in `content`. */
function spanAt(content: string, needle: string, nth = 1): ByteSpan {
  let idx = -1;
  for (let i = 0; i < nth; i++) {
    idx = content.indexOf(needle, idx + 1);
    if (idx === -1) throw new Error(`needle "${needle}" #${nth} not found`);
  }
  return { start: idx, end: idx + needle.length };
}

describe("TypeCollector.collectAtSpan", () => {
  // [HP] call-result type (the v1 motivating gap — collectAt rejects CallExpression)
  it("should resolve the call result type when span covers a CallExpression", () => {
    const prog = makeProg();
    const filePath = "/project/src/call.ts";
    const content = "function getStr(): string { return ''; }\nconst r = getStr();";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    const result = collector.collectAtSpan(filePath, spanAt(content, "getStr()", 2));

    expect(result).not.toBeNull();
    expect(result!.text).toBe("string");
  });

  // [HP] method-call result (not the receiver type)
  it("should resolve the method return type when span covers a method CallExpression", () => {
    const prog = makeProg();
    const filePath = "/project/src/method.ts";
    const content = "const o = { m(): number { return 1; } };\nconst r = o.m();";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    const result = collector.collectAtSpan(filePath, spanAt(content, "o.m()"));

    expect(result).not.toBeNull();
    expect(result!.text).toBe("number");
  });

  // [HP] member/property type
  it("should resolve the property type when span covers a MemberExpression", () => {
    const prog = makeProg();
    const filePath = "/project/src/member.ts";
    const content = "const o = { p: 'x' as string };\nconst m = o.p;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    const result = collector.collectAtSpan(filePath, spanAt(content, "o.p"));

    expect(result).not.toBeNull();
    expect(result!.text).toBe("string");
  });

  // [HP] identifier span still works (parity with collectAt)
  it("should resolve an identifier type when span covers exactly the identifier", () => {
    const prog = makeProg();
    const filePath = "/project/src/ident.ts";
    const content = "const myVar: string = 'hi';";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    const result = collector.collectAtSpan(filePath, spanAt(content, "myVar"));

    expect(result).not.toBeNull();
    expect(result!.text).toBe("string");
  });

  // [HP] intersection result type is exposed structurally
  it("should mark isIntersection when span covers an intersection-typed expression", () => {
    const prog = makeProg();
    const filePath = "/project/src/inter.ts";
    const content =
      "interface A { a: number }\ninterface B { b: string }\ndeclare const ab: A & B;\nconst r = ab;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    const result = collector.collectAtSpan(filePath, spanAt(content, "ab", 2));

    expect(result).not.toBeNull();
    expect(result!.isIntersection).toBe(true);
  });

  // [EXC] exact match resolves, but a straddling range → null (exact-span-or-null, no fallback)
  it("should resolve an exact span but return null for a straddling range", () => {
    const prog = makeProg();
    const filePath = "/project/src/nospan.ts";
    const content = "function getStr(): string { return ''; }\nconst r = getStr();";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // The exact call span resolves; "= getStr" straddles the `=` token and the
    // call so no single node matches it.
    expect(collector.collectAtSpan(filePath, spanAt(content, "getStr()", 2))).not.toBeNull();
    expect(collector.collectAtSpan(filePath, spanAt(content, "= getStr"))).toBeNull();
  });

  // [HP] `any` is exposed via raw flags (firebat throw-non-Error / any-detection path)
  it("should expose TypeFlags.Any when the spanned expression is any", () => {
    const prog = makeProg();
    const filePath = "/project/src/anyflags.ts";
    const content = "declare const x: any;\nconst r = x;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    const result = collector.collectAtSpan(filePath, spanAt(content, "x", 2));

    expect(result).not.toBeNull();
    expect((result!.flags & ts.TypeFlags.Any) !== 0).toBe(true);
  });

  // [HP] branded primitive (`string & {…}`) surfaces as an intersection — documents that
  // a flags-only "is this a primitive" check (StringLike) conservatively MISSES it.
  it("should mark a branded primitive intersection as isIntersection", () => {
    const prog = makeProg();
    const filePath = "/project/src/branded.ts";
    const content = "declare const bv: string & { __mark: true };\nconst r = bv;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    const result = collector.collectAtSpan(filePath, spanAt(content, "bv", 2));

    expect(result).not.toBeNull();
    expect(result!.isIntersection).toBe(true);
    expect((result!.flags & ts.TypeFlags.StringLike) !== 0).toBe(false);
  });

  // [REG] BUG-1: a semicolon-less expression statement ties the ExpressionStatement with its
  // expression; innermost must win so the type is the expression's, not the statement's `any`.
  it("should resolve the inner expression type for a semicolon-less statement", () => {
    const prog = makeProg();
    const filePath = "/project/src/nosemi.ts";
    const content = "function getStr(): string { return ''; }\ngetStr()"; // no trailing semicolon
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    const result = collector.collectAtSpan(filePath, spanAt(content, "getStr()", 2));

    expect(result).not.toBeNull();
    expect(result!.text).toBe("string"); // not "any"
  });

  // [EXC] missing file → null
  it("should return null when the file is not in the program", () => {
    const prog = makeProg();
    const collector = new TypeCollector(prog);

    const result = collector.collectAtSpan("/project/src/absent.ts", { start: 0, end: 1 });

    expect(result).toBeNull();
  });
});

describe("TypeCollector.isThenableAtSpan", () => {
  // [HP] local thenable: callable `then` with ≥1 parameter
  it("should return true when the type has a callable then with a parameter", () => {
    const prog = makeProg();
    const filePath = "/project/src/then1.ts";
    const content =
      "interface Thenable { then(cb: (v: number) => void): void }\ndeclare const val: Thenable;\nconst r = val;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    const result = collector.isThenableAtSpan(filePath, spanAt(content, "val", 2));

    expect(result).toBe(true);
  });

  // [EXC] then present but NOT callable → false
  it("should return false when then is a non-callable property", () => {
    const prog = makeProg();
    const filePath = "/project/src/thennum.ts";
    const content = "declare const x: { then: number };\nconst r = x;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    const result = collector.isThenableAtSpan(filePath, spanAt(content, "x", 2));

    expect(result).toBe(false);
  });

  // [BVA] then callable but ZERO parameters → false (eslint/tsutils definition)
  it("should return false when then is callable but takes no parameter", () => {
    const prog = makeProg();
    const filePath = "/project/src/then0.ts";
    const content = "declare const x: { then(): void };\nconst r = x;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    const result = collector.isThenableAtSpan(filePath, spanAt(content, "x", 2));

    expect(result).toBe(false);
  });

  // [HP] getter-then returning a 1-param function → true
  it("should return true for a getter then whose returned function takes a parameter", () => {
    const prog = makeProg();
    const filePath = "/project/src/gthen1.ts";
    const content = "declare const x: { get then(): (cb: (v: number) => void) => void };\nconst r = x;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    const result = collector.isThenableAtSpan(filePath, spanAt(content, "x", 2));

    expect(result).toBe(true);
  });

  // [BVA] getter-then returning a 0-param function → false
  it("should return false for a getter then whose returned function takes no parameter", () => {
    const prog = makeProg();
    const filePath = "/project/src/gthen0.ts";
    const content = "declare const x: { get then(): () => void };\nconst r = x;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    const result = collector.isThenableAtSpan(filePath, spanAt(content, "x", 2));

    expect(result).toBe(false);
  });

  // [HP] intersection with a thenable member → true (server-side, the C1 case)
  it("should return true when an intersection member is thenable", () => {
    const prog = makeProg();
    const filePath = "/project/src/interthen.ts";
    const content =
      "interface Thenable { then(cb: (v: number) => void): void }\ninterface L { log(): void }\ndeclare const x: L & Thenable;\nconst r = x;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    const result = collector.isThenableAtSpan(filePath, spanAt(content, "x", 2));

    expect(result).toBe(true);
  });

  // [EXC] any is excluded
  it("should return false when the type is any", () => {
    const prog = makeProg();
    const filePath = "/project/src/anyt.ts";
    const content = "declare const x: any;\nconst r = x;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    const result = collector.isThenableAtSpan(filePath, spanAt(content, "x", 2));

    expect(result).toBe(false);
  });

  // [EXC] plain object without then → false
  it("should return false for a non-thenable object", () => {
    const prog = makeProg();
    const filePath = "/project/src/plain.ts";
    const content = "declare const x: { foo: number };\nconst r = x;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    const result = collector.isThenableAtSpan(filePath, spanAt(content, "x", 2));

    expect(result).toBe(false);
  });

  // [HP] union with a thenable member → true (default anyConstituent, e.g. `Thenable | undefined`)
  it("should return true when some union member is thenable (default anyConstituent)", () => {
    const prog = makeProg();
    const filePath = "/project/src/uthen.ts";
    const content =
      "interface Thenable { then(cb: (v: number) => void): void }\ndeclare const x: Thenable | undefined;\nconst r = x;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    const result = collector.isThenableAtSpan(filePath, spanAt(content, "x", 2));

    expect(result).toBe(true);
  });

  // [HP] anyConstituent:false requires EVERY non-nullish member to be thenable → false here
  it("should return false when anyConstituent is false and a member is not thenable", () => {
    const prog = makeProg();
    const filePath = "/project/src/ueverythen.ts";
    const content =
      "interface Thenable { then(cb: (v: number) => void): void }\ndeclare const x: Thenable | { foo: number };\nconst r = x;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    const some = collector.isThenableAtSpan(filePath, spanAt(content, "x", 2));
    const every = collector.isThenableAtSpan(filePath, spanAt(content, "x", 2), { anyConstituent: false });

    expect(some).toBe(true);
    expect(every).toBe(false);
  });

  // [REG] BUG-1: semicolon-less call statement is still detected as thenable (innermost wins,
  // not the ExpressionStatement which would resolve to `any` → false)
  it("should detect a thenable for a semicolon-less call statement", () => {
    const prog = makeProg();
    const filePath = "/project/src/nosemithen.ts";
    const content =
      "interface Thenable { then(cb: (v: number) => void): void }\nfunction mk(): Thenable { return null as unknown as Thenable; }\nmk()"; // no trailing semicolon
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    const result = collector.isThenableAtSpan(filePath, spanAt(content, "mk()", 2));

    expect(result).toBe(true);
  });

  // [EXC] a self-referential (recursive) thenable resolves true and terminates (no hang)
  it("should return true and terminate for a recursive thenable", () => {
    const prog = makeProg();
    const filePath = "/project/src/rect.ts";
    const content = "interface RecT { then(cb: (v: RecT) => void): void }\ndeclare const x: RecT;\nconst r = x;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    const result = collector.isThenableAtSpan(filePath, spanAt(content, "x", 2));

    expect(result).toBe(true);
  });

  // [EXC] exact match resolves, but a non-matching range → null (exact-span-or-null)
  it("should resolve an exact span but return null for a non-matching range", () => {
    const prog = makeProg();
    const filePath = "/project/src/tnull.ts";
    const content =
      "interface Thenable { then(cb: (v: number) => void): void }\ndeclare const x: Thenable;\nconst r = x;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    expect(collector.isThenableAtSpan(filePath, spanAt(content, "x", 2))).toBe(true);
    expect(collector.isThenableAtSpan(filePath, { start: 0, end: content.length })).toBeNull();
  });
});

describe("TypeCollector.contextualCallReturnsAtSpan", () => {
  // [HP] simple void callback slot
  it("should return [void] for a () => void callback argument", () => {
    const prog = makeProg();
    const filePath = "/project/src/cbvoid.ts";
    const content = "declare function run(cb: () => void): void;\nrun(() => {});";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    const result = collector.contextualCallReturnsAtSpan(filePath, spanAt(content, "() => {}"));

    expect(result).not.toBeNull();
    expect(result!.map((t) => t.text)).toEqual(["void"]);
  });

  // [HP] optional callback param → contextual is `(()=>void)|undefined`; nonNull-stripped first
  it("should strip undefined and return [void] for an optional callback param", () => {
    const prog = makeProg();
    const filePath = "/project/src/cbopt.ts";
    const content = "declare function run(cb?: () => void): void;\nrun(() => {});";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    const result = collector.contextualCallReturnsAtSpan(filePath, spanAt(content, "() => {}"));

    expect(result).not.toBeNull();
    expect(result!.map((t) => t.text)).toEqual(["void"]);
  });

  // [HP] non-void return is surfaced (caller decides it's not a void-callback)
  it("should return the non-void return type when the callback returns a value", () => {
    const prog = makeProg();
    const filePath = "/project/src/cbnum.ts";
    const content = "declare function run(cb: () => number): void;\nrun(() => 1);";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    const result = collector.contextualCallReturnsAtSpan(filePath, spanAt(content, "() => 1"));

    expect(result).not.toBeNull();
    expect(result!.map((t) => t.text)).toEqual(["number"]);
  });

  // [HP] overload selection follows the sibling discriminant argument
  it("should resolve the selected overload's callback return type", () => {
    const prog = makeProg();
    const filePath = "/project/src/cbover.ts";
    const content =
      "declare function on(e: 'a', cb: () => void): void;\ndeclare function on(e: 'b', cb: () => number): void;\non('b', () => 1);";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    const result = collector.contextualCallReturnsAtSpan(filePath, spanAt(content, "() => 1"));

    expect(result).not.toBeNull();
    expect(result!.map((t) => t.text)).toEqual(["number"]);
  });

  // [EXC] non-callback slot → [] (has contextual type, no call signatures)
  it("should return [] for a non-callback argument slot", () => {
    const prog = makeProg();
    const filePath = "/project/src/cbnoncb.ts";
    const content = "declare function takesNum(n: number): void;\ntakesNum(42);";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    const result = collector.contextualCallReturnsAtSpan(filePath, spanAt(content, "42"));

    expect(result).toEqual([]);
  });

  // [EXC] a callback arg resolves, but a standalone expression (no contextual type) → null
  it("should resolve a callback arg but return null for an expression with no contextual type", () => {
    const prog = makeProg();
    const filePath = "/project/src/cbnull.ts";
    const content =
      "declare function run(cb: () => void): void;\nrun(() => {});\ndeclare const y: number;\ny;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    expect(collector.contextualCallReturnsAtSpan(filePath, spanAt(content, "() => {}"))).not.toBeNull();
    expect(collector.contextualCallReturnsAtSpan(filePath, spanAt(content, "y", 2))).toBeNull();
  });
});
