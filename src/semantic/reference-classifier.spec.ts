import { test, expect } from 'bun:test';
import ts from 'typescript';
import {
  classifyWriteKind,
  isAmbientDeclaration,
  getEnclosingScope,
  type ScopeKind,
} from './reference-classifier';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Parse `code` syntactically (no Program / type info needed). */
function parse(code: string, fileName = 'v.ts'): ts.SourceFile {
  return ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, /*setParentNodes*/ true);
}

/**
 * Return the `index`-th (0-based) identifier named `name` in source order.
 * Parent pointers are set so the classifier can inspect syntactic context.
 */
function identAt(code: string, name: string, index = 0): ts.Identifier {
  return collectIdents(parse(code), name)[index] ?? notFound(name, index, code);
}

function collectIdents(sf: ts.SourceFile, name: string): ts.Identifier[] {
  const found: ts.Identifier[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && n.text === name) found.push(n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

function notFound(name: string, index: number, where: string): never {
  throw new Error(`identifier "${name}"[${index}] not found in: ${where}`);
}

/** Return the first named declaration named `name` (identifier-named declarations only). */
function declOf(code: string, name: string, fileName = 'v.ts'): ts.Declaration {
  const sf = parse(code, fileName);
  let result: ts.Declaration | undefined;
  const visit = (n: ts.Node): void => {
    if (result) return;
    const named = n as ts.NamedDeclaration;
    if (
      (ts.isVariableDeclaration(n) ||
        ts.isFunctionDeclaration(n) ||
        ts.isModuleDeclaration(n) ||
        ts.isClassDeclaration(n) ||
        ts.isEnumDeclaration(n) ||
        ts.isInterfaceDeclaration(n)) &&
      named.name &&
      ts.isIdentifier(named.name) &&
      named.name.text === name
    ) {
      result = n as ts.Declaration;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (!result) throw new Error(`declaration "${name}" not found in: ${code}`);
  return result;
}

// ── declaration ─────────────────────────────────────────────────────────────--

test('classifies var declaration name as declaration', () => {
  expect(classifyWriteKind(identAt('var a = 1;', 'a'))).toBe('declaration');
});

test('classifies let declaration name as declaration', () => {
  expect(classifyWriteKind(identAt('let a = 1;', 'a'))).toBe('declaration');
});

test('classifies a function parameter as declaration', () => {
  expect(classifyWriteKind(identAt('function f(p) { return p; }', 'p', 0))).toBe('declaration');
});

test('classifies an object-destructuring binding as declaration', () => {
  expect(classifyWriteKind(identAt('var { x } = o;', 'x'))).toBe('declaration');
});

test('classifies a renamed destructuring binding as declaration', () => {
  // `var { y: z } = o` — `z` is the binding, `y` is the property key (not an identifier reference here).
  expect(classifyWriteKind(identAt('var { y: z } = o;', 'z'))).toBe('declaration');
});

test('classifies an array-destructuring binding as declaration', () => {
  expect(classifyWriteKind(identAt('var [a] = o;', 'a'))).toBe('declaration');
});

// ── assignment ────────────────────────────────────────────────────────────────

test('classifies plain assignment target as assignment', () => {
  expect(classifyWriteKind(identAt('a = 2;', 'a'))).toBe('assignment');
});

test('classifies destructuring assignment pattern target as assignment', () => {
  // `({ x } = o)` — assignment pattern, not a binding.
  expect(classifyWriteKind(identAt('({ x } = o);', 'x'))).toBe('assignment');
});

// ── compound-assignment ─────────────────────────────────────────────────────--

test('classifies += target as compound-assignment', () => {
  expect(classifyWriteKind(identAt('a += 1;', 'a'))).toBe('compound-assignment');
});

test('classifies &= target as compound-assignment', () => {
  expect(classifyWriteKind(identAt('a &= 1;', 'a'))).toBe('compound-assignment');
});

// ── logical-assignment ──────────────────────────────────────────────────────--

test('classifies ||= target as logical-assignment', () => {
  expect(classifyWriteKind(identAt('a ||= 1;', 'a'))).toBe('logical-assignment');
});

test('classifies &&= target as logical-assignment', () => {
  expect(classifyWriteKind(identAt('a &&= 1;', 'a'))).toBe('logical-assignment');
});

test('classifies ??= target as logical-assignment', () => {
  expect(classifyWriteKind(identAt('a ??= 1;', 'a'))).toBe('logical-assignment');
});

// ── update ──────────────────────────────────────────────────────────────────--

test('classifies postfix increment target as update', () => {
  expect(classifyWriteKind(identAt('a++;', 'a'))).toBe('update');
});

test('classifies prefix decrement target as update', () => {
  expect(classifyWriteKind(identAt('--a;', 'a'))).toBe('update');
});

// ── reads → undefined ─────────────────────────────────────────────────────────

test('classifies a plain read as undefined', () => {
  expect(classifyWriteKind(identAt('use(a);', 'a'))).toBeUndefined();
});

test('classifies a property-shorthand value as undefined (read)', () => {
  // `const s = { x }` — shorthand property reads the variable `x`.
  expect(classifyWriteKind(identAt('const s = { x };', 'x'))).toBeUndefined();
});

test('classifies the right-hand side of an assignment as undefined', () => {
  // `b = a` — `a` (index 0 of "a") is a read, only `b` is the write.
  expect(classifyWriteKind(identAt('b = a;', 'a'))).toBeUndefined();
});

test('classifies the read occurrence after a write as undefined', () => {
  // `a = 2; use(a);` — second `a` occurrence is the read.
  expect(classifyWriteKind(identAt('a = 2; use(a);', 'a', 1))).toBeUndefined();
});

// ── classifyWriteKind: destructuring assignment variants ────────────────────--

test('classifies a nested destructuring assignment target as assignment', () => {
  expect(classifyWriteKind(identAt('({ a: { b } } = o);', 'b'))).toBe('assignment');
});

test('classifies an array destructuring assignment target as assignment', () => {
  expect(classifyWriteKind(identAt('[a] = o;', 'a'))).toBe('assignment');
});

test('classifies an object pattern target with default as assignment', () => {
  expect(classifyWriteKind(identAt('({ a = 1 } = o);', 'a'))).toBe('assignment');
});

test('classifies an array pattern target with default as assignment', () => {
  expect(classifyWriteKind(identAt('[a = 1] = o;', 'a'))).toBe('assignment');
});

test('classifies an object rest assignment target as assignment', () => {
  expect(classifyWriteKind(identAt('({ ...r } = o);', 'r'))).toBe('assignment');
});

test('classifies an array rest assignment target as assignment', () => {
  expect(classifyWriteKind(identAt('[...r] = o;', 'r'))).toBe('assignment');
});

test('classifies a computed-property assignment value as assignment', () => {
  expect(classifyWriteKind(identAt('({ [k]: v } = o);', 'v'))).toBe('assignment');
});

test('classifies a computed-property key as undefined (read)', () => {
  expect(classifyWriteKind(identAt('({ [k]: v } = o);', 'k'))).toBeUndefined();
});

// ── classifyWriteKind: more declaration / read edges ────────────────────────--

test('classifies a destructured parameter binding with default as declaration', () => {
  expect(classifyWriteKind(identAt('function f({ a = 1 } = {}) {}', 'a'))).toBe('declaration');
});

test('classifies a binding propertyName as undefined (not a write)', () => {
  // `var { y: z } = o` — `y` is the property key, not a binding target.
  expect(classifyWriteKind(identAt('var { y: z } = o;', 'y'))).toBeUndefined();
});

test('classifies a catch parameter as declaration', () => {
  expect(classifyWriteKind(identAt('try {} catch (e) {}', 'e'))).toBe('declaration');
});

test('classifies a property-write target as undefined (property, not a binding)', () => {
  // `o.a = 1` — `a` is a property name, not a variable write.
  expect(classifyWriteKind(identAt('o.a = 1;', 'a'))).toBeUndefined();
});

// ── classifyWriteKind: for-statement targets ────────────────────────────────--

test('classifies a for-of declaration target as declaration', () => {
  expect(classifyWriteKind(identAt('for (const a of x) {}', 'a'))).toBe('declaration');
});

test('classifies a for-of assignment target (no declaration) as assignment', () => {
  // `for (a of x)` — `a` is assigned each iteration, not declared.
  expect(classifyWriteKind(identAt('for (a of x) {}', 'a'))).toBe('assignment');
});

test('classifies a for-in assignment target (no declaration) as assignment', () => {
  expect(classifyWriteKind(identAt('for (a in x) {}', 'a'))).toBe('assignment');
});

// ── classifyWriteKind: more binding / assignment shapes ─────────────────────--

test('classifies a `using` declaration as declaration', () => {
  expect(classifyWriteKind(identAt('using a = d();', 'a'))).toBe('declaration');
});

test('classifies an `await using` declaration as declaration', () => {
  expect(
    classifyWriteKind(identAt('async function f() { await using a = d(); }', 'a')),
  ).toBe('declaration');
});

test('classifies a constructor parameter property as declaration', () => {
  expect(
    classifyWriteKind(identAt('class C { constructor(private x: number) {} }', 'x')),
  ).toBe('declaration');
});

test('classifies an exported var declaration as declaration', () => {
  expect(classifyWriteKind(identAt('export var a = 1;', 'a'))).toBe('declaration');
});

test('classifies the first comma-sequence assignment target as assignment', () => {
  expect(classifyWriteKind(identAt('(a = 1, b = 2);', 'a'))).toBe('assignment');
});

test('classifies the second comma-sequence assignment target as assignment', () => {
  expect(classifyWriteKind(identAt('(a = 1, b = 2);', 'b'))).toBe('assignment');
});

test('classifies a parenthesized assignment target as assignment', () => {
  // `(a) = 1` — parenthesized LHS is a legal assignment target.
  expect(classifyWriteKind(identAt('(a) = 1;', 'a'))).toBe('assignment');
});

// ── isAmbientDeclaration ────────────────────────────────────────────────────--

test('marks a `declare const` declaration as ambient', () => {
  expect(isAmbientDeclaration(declOf('declare const x: number;', 'x'))).toBe(true);
});

test('marks a `declare function` declaration as ambient', () => {
  expect(isAmbientDeclaration(declOf('declare function f(): void;', 'f'))).toBe(true);
});

test('marks a member of a `declare namespace` as ambient', () => {
  expect(
    isAmbientDeclaration(declOf('declare namespace N { const a: number; }', 'a')),
  ).toBe(true);
});

test('marks a variable inside `declare global` as ambient', () => {
  expect(
    isAmbientDeclaration(declOf('declare global { var gv: number; }', 'gv')),
  ).toBe(true);
});

test('marks a `declare class` declaration as ambient', () => {
  expect(isAmbientDeclaration(declOf('declare class C {}', 'C'))).toBe(true);
});

test('marks a `declare enum` declaration as ambient', () => {
  expect(isAmbientDeclaration(declOf('declare enum E {}', 'E'))).toBe(true);
});

test('marks an `export declare const` declaration as ambient', () => {
  expect(isAmbientDeclaration(declOf('export declare const x: number;', 'x'))).toBe(true);
});

test('marks any declaration inside a .d.ts file as ambient', () => {
  const decl = declOf('export const z: number;', 'z', 'lib.d.ts');
  expect(isAmbientDeclaration(decl)).toBe(true);
});

test('does not mark a normal const declaration as ambient', () => {
  expect(isAmbientDeclaration(declOf('const y = 1;', 'y'))).toBe(false);
});

test('does not mark a normal function declaration as ambient', () => {
  expect(isAmbientDeclaration(declOf('function g() {}', 'g'))).toBe(false);
});

// ── getEnclosingScope: kind ─────────────────────────────────────────────────--

test.each<[string, string, ScopeKind]>([
  ['module top level', 'a;', 'module'],
  ['function body', 'function f() { a; }', 'function'],
  ['arrow function body', 'const g = () => { a; };', 'function'],
  ['arrow concise body', 'const g = () => a;', 'function'],
  ['class method body', 'class C { m() { a; } }', 'function'],
  ['nested function body', 'function f() { function h() { a; } }', 'function'],
  ['nested block', 'function f() { { a; } }', 'block'],
  ['for-loop body', 'for (;;) { a; }', 'block'],
  ['catch body', 'try {} catch (e) { a; }', 'block'],
  ['namespace body', 'namespace N { a; }', 'module'],
])('reports %s as %s scope', (_label, code, expected) => {
  expect(getEnclosingScope(identAt(code, 'a')).kind).toBe(expected);
});

// ── getEnclosingScope: span identity ────────────────────────────────────────--

test('returns a span that encloses the reference', () => {
  const ref = identAt('function f() { a; }', 'a');
  const scope = getEnclosingScope(ref);
  expect(scope.pos).toBeLessThanOrEqual(ref.getStart());
  expect(scope.end).toBeGreaterThanOrEqual(ref.getEnd());
});

test('distinguishes two sibling blocks by span', () => {
  // `function f() { { a; } { a; } }` — two separate blocks, two distinct spans.
  const code = 'function f() { { a; } { a; } }';
  const first = getEnclosingScope(identAt(code, 'a', 0));
  const second = getEnclosingScope(identAt(code, 'a', 1));
  expect(first.kind).toBe('block');
  expect(second.kind).toBe('block');
  expect(first.pos).not.toBe(second.pos);
});

// ── getEnclosingScope: edge scopes ──────────────────────────────────────────--
// Contract: `function` = nearest var-hoisting boundary (function/method/arrow/
// constructor/static-block/field-initializer); `block` = lexical-only block
// (nested block, for/catch/switch-case bodies, with-body); `module` = source
// file / namespace.

test('reports a parameter-default initializer reference as function scope', () => {
  // `function f(p = b)` — `b` resolves in the function (parameter) scope.
  expect(getEnclosingScope(identAt('function f(p = b) {}', 'b')).kind).toBe('function');
});

test('reports a static-block reference as function scope (var boundary)', () => {
  expect(getEnclosingScope(identAt('class C { static { a; } }', 'a')).kind).toBe('function');
});

test('reports a class-field-initializer reference as function scope', () => {
  expect(getEnclosingScope(identAt('class C { x = a; }', 'a')).kind).toBe('function');
});

test('reports a switch-case reference as block scope', () => {
  expect(getEnclosingScope(identAt('switch (x) { case 1: a; }', 'a')).kind).toBe('block');
});

test('reports a with-body reference as block scope', () => {
  expect(getEnclosingScope(identAt('with (o) { a; }', 'a')).kind).toBe('block');
});

test('reports a for-header reference as block scope', () => {
  // `for (let i = 0; i < 2; i++)` — `i` in the condition is in the loop's own scope.
  expect(getEnclosingScope(identAt('for (let i = 0; i < 2; i++) {}', 'i', 1)).kind).toBe('block');
});

test('reports a generator function body as function scope', () => {
  expect(getEnclosingScope(identAt('function* g() { a; }', 'a')).kind).toBe('function');
});

test('reports an async function body as function scope', () => {
  expect(getEnclosingScope(identAt('async function g() { a; }', 'a')).kind).toBe('function');
});

test('reports a constructor body as function scope', () => {
  expect(getEnclosingScope(identAt('class C { constructor() { a; } }', 'a')).kind).toBe('function');
});

test('reports a nameless default-export function body as function scope', () => {
  expect(getEnclosingScope(identAt('export default function () { a; }', 'a')).kind).toBe('function');
});

test('reports a nested arrow inside a field initializer as function scope (nearest boundary)', () => {
  // Two stacked function boundaries (arrow inside field initializer) — nearest (arrow) wins.
  expect(getEnclosingScope(identAt('class C { x = () => { a; }; }', 'a')).kind).toBe('function');
});

test('returns a function-scope span that encloses a parameter-default reference', () => {
  // `function f(p = b)` — `b` sits in the parameter list, outside the body block,
  // so the span must be the function node (which covers params), not the body block.
  const ref = identAt('function f(p = b) {}', 'b');
  const scope = getEnclosingScope(ref);
  expect(scope.kind).toBe('function');
  expect(scope.pos).toBeLessThanOrEqual(ref.getStart());
  expect(scope.end).toBeGreaterThanOrEqual(ref.getEnd());
});
