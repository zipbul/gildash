import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { isErr } from '@zipbul/result';
import { parseSource } from '../parser/parse-source';
import type { ParsedFile } from '../parser/types';
import type { JsDocTag } from '../extractor/types';

const mockBuildLineOffsets = mock((sourceText: string) => [0]);
const mockGetLineColumn = mock((offsets: number[], offset: number) => ({ line: 1, column: 0 }));

const mockParseJsDoc = mock((commentText: string) => ({ description: '', tags: [] as JsDocTag[] }));

mock.module('../parser/source-position', () => ({
  buildLineOffsets: mockBuildLineOffsets,
  getLineColumn: mockGetLineColumn,
}));
mock.module('../parser/jsdoc-parser', () => ({
  parseJsDoc: mockParseJsDoc,
}));

import { extractSymbols } from './symbol-extractor';

function makeFixture(source: string, filePath = '/project/src/index.ts'): ParsedFile {
  const result = parseSource(filePath, source);
  if (isErr(result)) throw new Error(result.data.message);
  return result;
}

describe('extractSymbols', () => {
  beforeEach(() => {
    mock.module('../parser/source-position', () => ({
      buildLineOffsets: mockBuildLineOffsets,
      getLineColumn: mockGetLineColumn,
    }));
    mock.module('../parser/jsdoc-parser', () => ({
      parseJsDoc: mockParseJsDoc,
    }));
    mockBuildLineOffsets.mockClear();
    mockGetLineColumn.mockClear();
    mockParseJsDoc.mockClear();
    mockBuildLineOffsets.mockReturnValue([0]);
    mockGetLineColumn.mockReturnValue({ line: 1, column: 0 });
    mockParseJsDoc.mockReturnValue({ description: '', tags: [] });
  });
  it('should extract a function symbol when source has a top-level function declaration', () => {
    const parsed = makeFixture(`function greet(name: string): string { return name; }`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'greet');
    expect(fn).toBeDefined();
    expect(fn!.kind).toBe('function');
    expect(fn!.isExported).toBe(false);
  });

  it('should mark isExported true when function declaration has export keyword', () => {
    const parsed = makeFixture(`export function hello() {}`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'hello');
    expect(fn?.isExported).toBe(true);
  });

  it('should extract parameter names and types when function declaration has typed parameters', () => {
    const parsed = makeFixture(`function add(a: number, b: number): number { return a + b; }`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'add');
    expect(fn?.parameters).toHaveLength(2);
    expect(fn?.parameters![0]!.name).toBe('a');
    expect(fn?.parameters![0]!.type).toContain('number');
  });

  it('should mark parameter isOptional true when parameter has ? optional marker', () => {
    const parsed = makeFixture(`function fn(x?: string) {}`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'fn');
    expect(fn?.parameters![0]!.isOptional).toBe(true);
  });

  it('should populate returnType when function declaration has an explicit return type annotation', () => {
    const parsed = makeFixture(`function fn(): boolean { return true; }`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'fn');
    expect(fn?.returnType).toContain('boolean');
  });

  it('should extract a class symbol when source has a top-level class declaration', () => {
    const parsed = makeFixture(`class Animal {}`);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'Animal');
    expect(cls).toBeDefined();
    expect(cls!.kind).toBe('class');
  });

  it('should populate heritage with extends entry when class declaration has an extends clause', () => {
    const parsed = makeFixture(`class Dog extends Animal {}`);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'Dog');
    expect(cls?.heritage?.some((h) => h.kind === 'extends' && h.name === 'Animal')).toBe(true);
  });

  it('should populate heritage with implements entry when class declaration has an implements clause', () => {
    const parsed = makeFixture(`class ServiceImpl implements Service {}`);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'ServiceImpl');
    expect(cls?.heritage?.some((h) => h.kind === 'implements' && h.name === 'Service')).toBe(true);
  });

  it('should include method members when class body contains method definitions', () => {
    const parsed = makeFixture(`class Calc { add(a: number, b: number): number { return a + b; } }`);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'Calc');
    expect(cls?.members?.some((m) => m.name === 'add' && m.kind === 'method')).toBe(true);
  });

  it('should set methodKind to "getter" when class body contains a getter method', () => {
    const parsed = makeFixture(`class C { get value(): number { return 0; } }`);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'C');
    const getter = cls?.members?.find((m) => m.name === 'value');
    expect(getter?.methodKind).toBe('getter');
  });

  it('should set methodKind to "setter" when class body contains a setter method', () => {
    const parsed = makeFixture(`class C { set value(v: number) {} }`);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'C');
    const setter = cls?.members?.find((m) => m.name === 'value');
    expect(setter?.methodKind).toBe('setter');
  });

  it('should include a member with methodKind "constructor" when class body has a constructor', () => {
    const parsed = makeFixture(`class C { constructor(private x: number) {} }`);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'C');
    const ctor = cls?.members?.find((m) => m.methodKind === 'constructor');
    expect(ctor).toBeDefined();
  });

  it('should extract an interface symbol when source has a top-level interface declaration', () => {
    const parsed = makeFixture(`interface Shape { area(): number; }`);
    const symbols = extractSymbols(parsed);
    const iface = symbols.find((s) => s.name === 'Shape');
    expect(iface?.kind).toBe('interface');
  });

  it('should populate heritage with extends entry when interface declaration has an extends clause', () => {
    const parsed = makeFixture(`interface Animal { name: string; } interface Dog extends Animal { breed: string; }`);
    const symbols = extractSymbols(parsed);
    const dog = symbols.find((s) => s.name === 'Dog');
    expect(dog?.heritage?.some((h) => h.kind === 'extends' && h.name === 'Animal')).toBe(true);
  });

  it('should extract an enum symbol when source has a top-level enum declaration', () => {
    const parsed = makeFixture(`enum Direction { Up, Down, Left, Right }`);
    const symbols = extractSymbols(parsed);
    const en = symbols.find((s) => s.name === 'Direction');
    expect(en?.kind).toBe('enum');
  });

  it('should populate enum members list when enum body contains member entries', () => {
    const parsed = makeFixture(`enum Color { Red, Green, Blue }`);
    const symbols = extractSymbols(parsed);
    const en = symbols.find((s) => s.name === 'Color');
    expect(en?.members?.some((m) => m.name === 'Red')).toBe(true);
    expect(en?.members?.some((m) => m.name === 'Green')).toBe(true);
  });

  it('should extract a variable symbol with kind "variable" when declaration is a const initializer', () => {
    const parsed = makeFixture(`const PI = 3.14;`);
    const symbols = extractSymbols(parsed);
    const v = symbols.find((s) => s.name === 'PI');
    expect(v?.kind).toBe('variable');
  });

  it('should set kind to "function" when const is assigned an ArrowFunctionExpression', () => {
    const parsed = makeFixture(`const add = (a: number, b: number) => a + b;`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'add');
    expect(fn?.kind).toBe('function');
  });

  it('should extract a type symbol when source has a top-level type alias declaration', () => {
    const parsed = makeFixture(`type StringOrNumber = string | number;`);
    const symbols = extractSymbols(parsed);
    const t = symbols.find((s) => s.name === 'StringOrNumber');
    expect(t?.kind).toBe('type');
  });

  it('should set span.start.line to 1 when symbol is on the first line of the source', () => {
    const parsed = makeFixture(`function fn() {}`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'fn');
    expect(fn?.span.start.line).toBe(1);
  });

  it('should return empty array when source is empty', () => {
    const parsed = makeFixture('');
    expect(extractSymbols(parsed)).toEqual([]);
  });

  it('should name the symbol "default" when export default declaration has an anonymous function', () => {
    const parsed = makeFixture(`export default function() {}`);
    const symbols = extractSymbols(parsed);
    const def = symbols.find((s) => s.name === 'default');
    expect(def).toBeDefined();
  });

  it('should not include inner function declarations when they are nested inside a function body', () => {
    const parsed = makeFixture(`function outer() { function inner() {} }`);
    const symbols = extractSymbols(parsed);
    expect(symbols.find((s) => s.name === 'inner')).toBeUndefined();
  });

  it('should populate decorators list when class has a call-expression decorator', () => {
    const parsed = makeFixture(`
      @Injectable()
      class MyService {}
    `);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'MyService');
    expect(cls?.decorators?.some((d) => d.name === 'Injectable')).toBe(true);
  });

  it('should include "async" in modifiers when function declaration has async keyword', () => {
    const parsed = makeFixture(`async function fetchData() {}`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'fetchData');
    expect(fn?.modifiers).toContain('async');
  });

  it('should name the symbol "default" and set isExported true when export default class has no class name', () => {
    const parsed = makeFixture(`export default class {}`);
    const symbols = extractSymbols(parsed);
    const def = symbols.find((s) => s.name === 'default');
    expect(def).toBeDefined();
    expect(def?.isExported).toBe(true);
  });

  it('should mark referenced variable as exported when export default references an identifier', () => {
    const parsed = makeFixture(`const x = 42;\nexport default x;`);
    const symbols = extractSymbols(parsed);
    const x = symbols.find((s) => s.name === 'x');
    expect(x).toBeDefined();
    expect(x?.isExported).toBe(true);
  });

  it('should return same symbol count when called repeatedly with the same ParsedFile', () => {
    const parsed = makeFixture(`function a() {} function b() {}`);
    const r1 = extractSymbols(parsed);
    const r2 = extractSymbols(parsed);
    expect(r1.length).toBe(r2.length);
  });

  it('should populate jsDoc.description when a JSDoc block comment precedes the function', () => {
    mockParseJsDoc.mockReturnValue({ description: 'Greets the user.', tags: [] });
    const parsed = makeFixture(`/** Greets the user. */\nfunction greet() {}`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'greet');
    expect(fn?.jsDoc).toBeDefined();
    expect(fn!.jsDoc!.description).toContain('Greets');
  });

  it('should populate jsDoc.tags with param tag when a JSDoc @param tag precedes the function', () => {
    mockParseJsDoc.mockReturnValue({
      description: '',
      tags: [{ tag: 'param', name: 'x', type: '', description: 'the value', optional: false }],
    });
    const parsed = makeFixture(`/** @param x - the value */\nfunction fn(x: number) {}`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'fn');
    expect(fn?.jsDoc?.tags?.some((t) => t.tag === 'param')).toBe(true);
  });

  it('should leave jsDoc undefined when only a line comment precedes the function', () => {
    const parsed = makeFixture(`// just a comment\nfunction fn() {}`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'fn');
    expect(fn?.jsDoc).toBeUndefined();
  });

  it('should leave jsDoc undefined when only a regular block comment (not JSDoc) precedes the function', () => {
    const parsed = makeFixture(`/* not jsdoc */\nfunction fn() {}`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'fn');
    expect(fn?.jsDoc).toBeUndefined();
  });

  it('should leave jsDoc undefined when JSDoc comment follows the function instead of preceding it', () => {
    const parsed = makeFixture(`function fn() {}\n/** after */`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'fn');
    expect(fn?.jsDoc).toBeUndefined();
  });

  it('should include a member with kind "property" when class body contains a PropertyDefinition field', () => {
    const parsed = makeFixture(`class C { name: string = ''; }`);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'C');
    const prop = cls?.members?.find((m) => m.name === 'name');
    expect(prop).toBeDefined();
    expect(prop!.kind).toBe('property');
  });

  it('should extract decorator without arguments when decorator is a bare Identifier without parentheses', () => {
    const parsed = makeFixture(`
      @Inject
      class MyService {}
    `);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'MyService');
    expect(cls?.decorators?.some((d) => d.name === 'Inject')).toBe(true);
    const dec = cls!.decorators!.find((d) => d.name === 'Inject');
    expect(dec?.arguments).toBeUndefined();
  });

  it('should include a member with kind "property" and populated returnType when interface has a TSPropertySignature', () => {
    const parsed = makeFixture(`interface Shape { name: string; }`);
    const symbols = extractSymbols(parsed);
    const iface = symbols.find((s) => s.name === 'Shape');
    const member = iface?.members?.find((m) => m.name === 'name');
    expect(member).toBeDefined();
    expect(member!.kind).toBe('property');
    expect(member!.returnType).toContain('string');
  });

  it('should include "readonly" in modifiers when interface TSPropertySignature has readonly keyword', () => {
    const parsed = makeFixture(`interface Shape { readonly id: number; }`);
    const symbols = extractSymbols(parsed);
    const iface = symbols.find((s) => s.name === 'Shape');
    const member = iface?.members?.find((m) => m.name === 'id');
    expect(member?.modifiers).toContain('readonly');
  });

  it('should extract one symbol per identifier when VariableDeclarator id is an ObjectPattern', () => {
    const parsed = makeFixture(`const { a, b } = obj;`);
    const symbols = extractSymbols(parsed);
    expect(symbols.some((s) => s.name === 'a')).toBe(true);
    expect(symbols.some((s) => s.name === 'b')).toBe(true);
  });

  it('should set isExported true for each ObjectPattern symbol when declaration has export keyword', () => {
    const parsed = makeFixture(`export const { x, y } = obj;`);
    const symbols = extractSymbols(parsed);
    const x = symbols.find((s) => s.name === 'x');
    const y = symbols.find((s) => s.name === 'y');
    expect(x?.isExported).toBe(true);
    expect(y?.isExported).toBe(true);
  });

  it('should return no symbols when ObjectPattern has no properties (empty destructuring)', () => {
    const parsed = makeFixture(`const {} = obj;`);
    const symbols = extractSymbols(parsed);
    expect(symbols).toHaveLength(0);
  });

  it('should extract ObjectPattern identifiers and Identifier variables when both appear in the same scope', () => {
    const parsed = makeFixture(`const { a } = obj;\nconst d = 1;`);
    const symbols = extractSymbols(parsed);
    expect(symbols.some((s) => s.name === 'a')).toBe(true);
    expect(symbols.some((s) => s.name === 'd')).toBe(true);
  });

  it('should populate typeParameters with one entry when function has a single type parameter', () => {
    const parsed = makeFixture(`function fn<T>() {}`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'fn');
    expect(fn?.typeParameters).toEqual(['T']);
  });

  it('should populate typeParameters with all entries when function has multiple type parameters', () => {
    const parsed = makeFixture(`function fn<T, U>() {}`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'fn');
    expect(fn?.typeParameters).toEqual(['T', 'U']);
  });

  it('should populate typeParameters when class declaration has a type parameter', () => {
    const parsed = makeFixture(`class Container<T> {}`);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'Container');
    expect(cls?.typeParameters).toEqual(['T']);
  });

  it('should populate typeParameters when interface declaration has a type parameter', () => {
    const parsed = makeFixture(`interface Repository<T> {}`);
    const symbols = extractSymbols(parsed);
    const iface = symbols.find((s) => s.name === 'Repository');
    expect(iface?.typeParameters).toEqual(['T']);
  });

  it('should prefix parameter name with "..." when parameter is a RestElement', () => {
    const parsed = makeFixture(`function fn(...args: string[]) {}`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'fn');
    expect(fn?.parameters?.some((p) => p.name === '...args')).toBe(true);
  });

  it('should correctly extract names for both normal and rest parameters when function mixes parameter kinds', () => {
    const parsed = makeFixture(`function fn(a: number, ...rest: string[]) {}`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'fn');
    expect(fn?.parameters?.[0]!.name).toBe('a');
    expect(fn?.parameters?.[1]!.name).toBe('...rest');
  });

  it('should extract rest parameter name with "..." prefix when parameter has no type annotation', () => {
    const parsed = makeFixture(`function fn(...a) {}`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'fn');
    expect(fn?.parameters?.[0]!.name).toBe('...a');
  });

  it('should set isOptional true and populate defaultValue when parameter has an assignment default', () => {
    const parsed = makeFixture(`function fn(x = 'hello') {}`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'fn');
    const param = fn?.parameters?.[0];
    expect(param?.name).toBe('x');
    expect(param?.isOptional).toBe(true);
    expect(param?.defaultValue).toBe("'hello'");
  });

  it('should set defaultValue to "0" when parameter default is a numeric zero literal', () => {
    const parsed = makeFixture(`function fn(x = 0) {}`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'fn');
    const param = fn?.parameters?.[0];
    expect(param?.defaultValue).toBe('0');
  });

  it('should set isOptional true only for the parameter with a default when function mixes typed and defaulted parameters', () => {
    const parsed = makeFixture(`function fn(a: number, b = 'default') {}`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'fn');
    const b = fn?.parameters?.find((p) => p.name === 'b');
    expect(b?.isOptional).toBe(true);
  });

  it('should set isOptional true and populate defaultValue when typed parameter has an assignment default', () => {
    const parsed = makeFixture(`function fn(x: string = '') {}`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'fn');
    const param = fn?.parameters?.[0];
    expect(param?.isOptional).toBe(true);
    expect(param?.defaultValue).toBeDefined();
  });

  it('should extract one symbol per declarator when VariableDeclaration has multiple declarators', () => {
    const parsed = makeFixture(`const a = 1, b = 2;`);
    const symbols = extractSymbols(parsed);
    expect(symbols.some((s) => s.name === 'a')).toBe(true);
    expect(symbols.some((s) => s.name === 'b')).toBe(true);
  });

  it('should mark all declarator symbols as isExported when exported VariableDeclaration has multiple declarators', () => {
    const parsed = makeFixture(`export const x = 1, y = 2;`);
    const symbols = extractSymbols(parsed);
    expect(symbols.find((s) => s.name === 'x')?.isExported).toBe(true);
    expect(symbols.find((s) => s.name === 'y')?.isExported).toBe(true);
  });

  it('should still extract symbol when VariableDeclaration has only a single declarator', () => {
    const parsed = makeFixture(`const a = 1;`);
    const symbols = extractSymbols(parsed);
    expect(symbols.find((s) => s.name === 'a')).toBeDefined();
  });

  it('should extract one variable symbol per Identifier element when VariableDeclarator id is an ArrayPattern', () => {
    const parsed = makeFixture(`const [a, b] = arr;`);
    const symbols = extractSymbols(parsed);
    expect(symbols.some((s) => s.name === 'a' && s.kind === 'variable')).toBe(true);
    expect(symbols.some((s) => s.name === 'b' && s.kind === 'variable')).toBe(true);
  });

  it('should set isExported true for each ArrayPattern symbol when declaration has export keyword', () => {
    const parsed = makeFixture(`export const [x, y] = arr;`);
    const symbols = extractSymbols(parsed);
    const x = symbols.find((s) => s.name === 'x');
    const y = symbols.find((s) => s.name === 'y');
    expect(x?.isExported).toBe(true);
    expect(y?.isExported).toBe(true);
  });

  it('should return no symbols when ArrayPattern has no elements (empty destructuring)', () => {
    const parsed = makeFixture(`const [] = arr;`);
    const symbols = extractSymbols(parsed);
    expect(symbols).toHaveLength(0);
  });

  it('should skip null holes and extract only Identifier elements when ArrayPattern has sparse elements', () => {
    const parsed = makeFixture(`const [, b] = arr;`);
    const symbols = extractSymbols(parsed);
    expect(symbols).toHaveLength(1);
    expect(symbols[0]!.name).toBe('b');
  });

  it('should extract rest binding name when ArrayPattern contains only RestElement', () => {
    const parsed = makeFixture(`const [...rest] = arr;`);
    const symbols = extractSymbols(parsed);
    expect(symbols).toHaveLength(1);
    expect(symbols[0]!.name).toBe('rest');
  });

  it('should extract both Identifier and RestElement bindings from ArrayPattern', () => {
    const parsed = makeFixture(`const [a, ...rest] = arr;`);
    const symbols = extractSymbols(parsed);
    expect(symbols).toHaveLength(2);
    expect(symbols.map((s) => s.name)).toEqual(['a', 'rest']);
  });

  it('should extract deeply nested binding names from ObjectPattern with nested ObjectPattern and ArrayPattern', () => {
    const parsed = makeFixture(`export const { a: { b: c }, d: [e, f] } = something;`);
    const symbols = extractSymbols(parsed);
    expect(symbols.map((s) => s.name)).toEqual(['c', 'e', 'f']);
    for (const s of symbols) expect(s.isExported).toBe(true);
  });

  it('should extract binding name from AssignmentPattern with default value in destructuring', () => {
    const parsed = makeFixture(`const { x = 10 } = obj;`);
    const symbols = extractSymbols(parsed);
    expect(symbols).toHaveLength(1);
    expect(symbols[0]!.name).toBe('x');
  });

  it('should extract namespace declaration as kind "namespace"', () => {
    const parsed = makeFixture(`export namespace MyNS { export function hello() {} }`);
    const symbols = extractSymbols(parsed);
    const ns = symbols.find((s) => s.name === 'MyNS');
    expect(ns).toBeDefined();
    expect(ns?.kind).toBe('namespace');
    expect(ns?.isExported).toBe(true);
  });

  it('should extract non-exported namespace declaration', () => {
    const parsed = makeFixture(`namespace Internal {}`);
    const symbols = extractSymbols(parsed);
    const ns = symbols.find((s) => s.name === 'Internal');
    expect(ns).toBeDefined();
    expect(ns?.kind).toBe('namespace');
    expect(ns?.isExported).toBe(false);
  });

  it('should leave jsDoc undefined when another AST statement intervenes between the JSDoc comment and the symbol', () => {
    const parsed = makeFixture(`/** doc */\nconst x = 1;\nfunction fn() {}`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'fn');
    expect(fn?.jsDoc).toBeUndefined();
  });

  it('should include "const" in modifiers when enum declaration has const keyword', () => {
    const parsed = makeFixture(`const enum Direction { Up, Down }`);
    const symbols = extractSymbols(parsed);
    const en = symbols.find((s) => s.name === 'Direction');
    expect(en?.modifiers).toContain('const');
  });

  it('should not include "const" in modifiers when enum declaration lacks const keyword', () => {
    const parsed = makeFixture(`enum Direction { Up, Down }`);
    const symbols = extractSymbols(parsed);
    const en = symbols.find((s) => s.name === 'Direction');
    expect(en?.modifiers).not.toContain('const');
  });

  it('should extract symbols from both ArrayPattern and ObjectPattern when both appear in the same scope', () => {
    const parsed = makeFixture(`const [a] = arr;\nconst { b } = obj;`);
    const symbols = extractSymbols(parsed);
    expect(symbols.some((s) => s.name === 'a')).toBe(true);
    expect(symbols.some((s) => s.name === 'b')).toBe(true);
  });

  it('should extract decorator name via Identifier expression when parameter has a bare decorator', () => {
    const parsed = makeFixture(`
      class Svc {
        constructor(@Log name: string) {}
      }
    `);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'Svc');
    const ctor = cls?.members?.find((m) => m.name === 'constructor');
    const param = ctor?.parameters?.find((p) => p.name === 'name');
    expect(param?.decorators?.some((d) => d.name === 'Log')).toBe(true);
  });

  it('should use sourceText slice as decorator name when expression is a MemberExpression', () => {
    const parsed = makeFixture(`
      @ns.Inject
      class X {}
    `);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'X');
    expect(cls?.decorators?.some((d) => d.name === 'ns.Inject')).toBe(true);
  });

  it('should populate decorator arguments when CallExpression decorator has arguments', () => {
    const parsed = makeFixture(`
      @Inject('token')
      class Svc {}
    `);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'Svc');
    const dec = cls?.decorators?.find((d) => d.name === 'Inject');
    expect(dec).toBeDefined();
    expect(dec!.arguments).toBeDefined();
    expect(dec!.arguments!.length).toBeGreaterThan(0);
  });

  it('should set decorator arguments to undefined when CallExpression decorator has no arguments', () => {
    const parsed = makeFixture(`
      @Injectable()
      class Svc {}
    `);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'Svc');
    const dec = cls?.decorators?.find((d) => d.name === 'Injectable');
    expect(dec).toBeDefined();
    expect(dec!.arguments).toBeUndefined();
  });

  it('should skip unknown AST node types and not include them in the result', () => {
    const parsed = makeFixture(`console.log('hello');`);
    const symbols = extractSymbols(parsed);
    expect(symbols).toHaveLength(0);
  });

  // ─── Function overload indexing ──────────────────────────────────────

  it('should extract all function overload signatures as separate symbols', () => {
    const parsed = makeFixture(`
      function foo(x: string): string;
      function foo(x: number): number;
      function foo(x: string | number): string | number { return x; }
    `);
    const symbols = extractSymbols(parsed);
    const foos = symbols.filter(s => s.name === 'foo');
    expect(foos).toHaveLength(3);
    expect(foos[0]!.kind).toBe('function');
    expect(foos[0]!.parameters![0]!.type).toBe('string');
    expect(foos[1]!.parameters![0]!.type).toBe('number');
    expect(foos[2]!.parameters![0]!.type).toBe('string | number');
  });

  it('should extract exported function overload signatures', () => {
    const parsed = makeFixture(`
      export function bar(x: string): string;
      export function bar(x: number): number;
      export function bar(x: string | number): string | number { return x; }
    `);
    const symbols = extractSymbols(parsed);
    const bars = symbols.filter(s => s.name === 'bar');
    expect(bars).toHaveLength(3);
    expect(bars.every(s => s.isExported)).toBe(true);
  });

  it('should not create extra symbols for functions without overloads', () => {
    const parsed = makeFixture(`
      function single(x: string): string { return x; }
    `);
    const symbols = extractSymbols(parsed);
    expect(symbols.filter(s => s.name === 'single')).toHaveLength(1);
  });

  // ─── Export specifiers (export { name }) ─────────────────────────────

  it('should mark isExported true when function is exported via specifier list', () => {
    const parsed = makeFixture(`function greet() {}\nexport { greet };`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find(s => s.name === 'greet');
    expect(fn?.isExported).toBe(true);
  });

  it('should mark isExported true for multiple symbols exported via specifier list', () => {
    const parsed = makeFixture(`function a() {}\nfunction b() {}\nexport { a, b };`);
    const symbols = extractSymbols(parsed);
    expect(symbols.find(s => s.name === 'a')?.isExported).toBe(true);
    expect(symbols.find(s => s.name === 'b')?.isExported).toBe(true);
  });

  it('should mark isExported true using local name when symbol is exported with alias', () => {
    const parsed = makeFixture(`function greet() {}\nexport { greet as hello };`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find(s => s.name === 'greet');
    expect(fn?.isExported).toBe(true);
  });

  it('should not mark unrelated symbols as exported when only some are in the specifier list', () => {
    const parsed = makeFixture(`function a() {}\nfunction b() {}\nexport { a };`);
    const symbols = extractSymbols(parsed);
    expect(symbols.find(s => s.name === 'a')?.isExported).toBe(true);
    expect(symbols.find(s => s.name === 'b')?.isExported).toBe(false);
  });

  it('should not apply specifier export marking when ExportNamedDeclaration has a source', () => {
    const parsed = makeFixture(`function init() {}\nexport { other } from './other';`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find(s => s.name === 'init');
    expect(fn?.isExported).toBe(false);
  });

  it('should mark variable as exported when exported via specifier list', () => {
    const parsed = makeFixture(`const PI = 3.14;\nexport { PI };`);
    const symbols = extractSymbols(parsed);
    expect(symbols.find(s => s.name === 'PI')?.isExported).toBe(true);
  });

  it('should mark class as exported when exported via specifier list', () => {
    const parsed = makeFixture(`class Foo {}\nexport { Foo };`);
    const symbols = extractSymbols(parsed);
    expect(symbols.find(s => s.name === 'Foo')?.isExported).toBe(true);
  });

  // ─── Modifier coverage ──────────────────────────────────────────────

  it('should include "abstract" in modifiers when class declaration has abstract keyword', () => {
    const parsed = makeFixture(`abstract class A {}`);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'A');
    expect(cls?.modifiers).toContain('abstract');
  });

  it('should include "abstract" in modifiers when method has abstract keyword', () => {
    const parsed = makeFixture(`abstract class A { abstract run(): void; }`);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'A');
    // oxc-parser emits TSAbstractMethodDefinition for abstract methods
    const method = cls?.members?.find((m) => m.name === 'run');
    expect(method).toBeDefined();
    expect(method?.modifiers).toContain('abstract');
    // The class-level abstract modifier is still extracted
    expect(cls?.modifiers).toContain('abstract');
  });

  it('should include "static" in modifiers when method has static keyword', () => {
    const parsed = makeFixture(`class C { static run() {} }`);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'C');
    const method = cls?.members?.find((m) => m.name === 'run');
    expect(method?.modifiers).toContain('static');
  });

  it('should include "declare" in modifiers when function has declare keyword', () => {
    const parsed = makeFixture(`declare function external(): void;`);
    const symbols = extractSymbols(parsed);
    const fn = symbols.find((s) => s.name === 'external');
    expect(fn?.modifiers).toContain('declare');
  });

  it('should include "protected" in modifiers when method has protected keyword', () => {
    const parsed = makeFixture(`class C { protected run() {} }`);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'C');
    const method = cls?.members?.find((m) => m.name === 'run');
    expect(method?.modifiers).toContain('protected');
  });

  it('should include "public" in modifiers when method has public keyword', () => {
    const parsed = makeFixture(`class C { public run() {} }`);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'C');
    const method = cls?.members?.find((m) => m.name === 'run');
    expect(method?.modifiers).toContain('public');
  });

  it('should include "readonly" in modifiers when class property has readonly keyword', () => {
    const parsed = makeFixture(`class C { readonly x: number = 0; }`);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'C');
    const prop = cls?.members?.find((m) => m.name === 'x');
    expect(prop?.modifiers).toContain('readonly');
  });

  it('should include "private" in modifiers when method has private keyword', () => {
    const parsed = makeFixture(`class C { private run() {} }`);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'C');
    const method = cls?.members?.find((m) => m.name === 'run');
    expect(method?.modifiers).toContain('private');
  });

  it('should include "override" in modifiers when method has override keyword', () => {
    const parsed = makeFixture(`class C extends B { override run() {} }`);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'C');
    const method = cls?.members?.find((m) => m.name === 'run');
    expect(method?.modifiers).toContain('override');
  });

  // ─── AST node type coverage ─────────────────────────────────────────

  it('should mark isExported true when type alias is exported via specifier list', () => {
    const parsed = makeFixture(`type MyType = string;\nexport type { MyType };`);
    const symbols = extractSymbols(parsed);
    const t = symbols.find((s) => s.name === 'MyType');
    expect(t?.isExported).toBe(true);
  });

  it('should extract multiple heritage entries when class implements multiple interfaces', () => {
    const parsed = makeFixture(`class C implements I1, I2, I3 {}`);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'C');
    const implNames = cls?.heritage?.filter((h) => h.kind === 'implements').map((h) => h.name);
    expect(implNames).toEqual(['I1', 'I2', 'I3']);
  });

  it('should extract interface method members with parameters and return type', () => {
    const parsed = makeFixture(`interface I { run(x: number): void; }`);
    const symbols = extractSymbols(parsed);
    const iface = symbols.find((s) => s.name === 'I');
    const method = iface?.members?.find((m) => m.name === 'run');
    expect(method).toBeDefined();
    expect(method!.kind).toBe('method');
    expect(method!.parameters).toHaveLength(1);
    expect(method!.parameters![0]!.name).toBe('x');
    expect(method!.parameters![0]!.type).toContain('number');
    expect(method!.returnType).toContain('void');
  });

  // ─── AST edge cases ────────────────────────────────────────────────

  it('should set member name to "unknown" when class has computed property name', () => {
    const parsed = makeFixture(`class C { [Symbol.iterator]() {} }`);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'C');
    // oxc-parser emits key as MemberExpression for computed properties,
    // so key.name is undefined and extractClassMembers falls back to 'unknown'
    const member = cls?.members?.find((m) => m.name === 'unknown');
    expect(member).toBeDefined();
    expect(member!.kind).toBe('method');
  });

  it('should extract class method overload signatures as separate members', () => {
    const parsed = makeFixture(`
      class C {
        foo(x: string): string;
        foo(x: number): number;
        foo(x: string | number): string | number { return x; }
      }
    `);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'C');
    // oxc-parser emits 3 MethodDefinition nodes for overloaded methods,
    // and extractClassMembers processes each one individually
    const fooMembers = cls?.members?.filter((m) => m.name === 'foo');
    expect(fooMembers).toHaveLength(3);
    expect(fooMembers!.every((m) => m.kind === 'method')).toBe(true);
  });

  it('should extract private field with PrivateIdentifier name (without hash prefix) when class has private field', () => {
    const parsed = makeFixture(`class C { #secret: string = ''; }`);
    const symbols = extractSymbols(parsed);
    const cls = symbols.find((s) => s.name === 'C');
    // oxc-parser emits PrivateIdentifier with name "secret" (no # prefix),
    // and extractClassMembers reads key.name directly
    const member = cls?.members?.find((m) => m.name === 'secret');
    expect(member).toBeDefined();
    expect(member!.kind).toBe('property');
  });

  // ─── Destructuring edge cases ───────────────────────────────────────

  it('should extract both named and rest bindings when ObjectPattern has RestElement', () => {
    const parsed = makeFixture(`export const { a, ...rest } = obj;`);
    const symbols = extractSymbols(parsed);
    const names = symbols.map((s) => s.name);
    expect(names).toEqual(['a', 'rest']);
  });

  it('should extract binding names when ArrayPattern elements have AssignmentPattern defaults', () => {
    const parsed = makeFixture(`const [x = 1, y = 2] = arr;`);
    const symbols = extractSymbols(parsed);
    const names = symbols.map((s) => s.name);
    expect(names).toEqual(['x', 'y']);
  });

  it('should extract deepest binding name when ObjectPattern has 3+ levels of nesting', () => {
    const parsed = makeFixture(`const { a: { b: { c } } } = obj;`);
    const symbols = extractSymbols(parsed);
    const names = symbols.map((s) => s.name);
    expect(names).toEqual(['c']);
  });

  it('should extract binding names when ObjectPattern is nested inside ArrayPattern', () => {
    const parsed = makeFixture(`const [{ a, b }] = arr;`);
    const symbols = extractSymbols(parsed);
    const names = symbols.map((s) => s.name);
    expect(names).toEqual(['a', 'b']);
  });

  it('should extract binding names when ArrayPattern is nested inside ArrayPattern', () => {
    const parsed = makeFixture(`const [[a, b]] = arr;`);
    const symbols = extractSymbols(parsed);
    const names = symbols.map((s) => s.name);
    expect(names).toEqual(['a', 'b']);
  });

  // ─── Export default referencing declarations ────────────────────────

  it('should mark function as exported when export default references a function declaration', () => {
    const parsed = makeFixture(`function foo() {}\nexport default foo;`);
    const symbols = extractSymbols(parsed);
    const foo = symbols.find((s) => s.name === 'foo');
    expect(foo).toBeDefined();
    expect(foo!.isExported).toBe(true);
  });

  it('should mark class as exported when export default references a class declaration', () => {
    const parsed = makeFixture(`class Bar {}\nexport default Bar;`);
    const symbols = extractSymbols(parsed);
    const bar = symbols.find((s) => s.name === 'Bar');
    expect(bar).toBeDefined();
    expect(bar!.isExported).toBe(true);
  });

  it('should not crash when export default references a non-existent identifier', () => {
    const parsed = makeFixture(`export default unknownIdent;`);
    const symbols = extractSymbols(parsed);
    // unknownIdent is not declared in this file, so no symbol is created for it.
    // The deferredExportNames set will contain 'unknownIdent' but no symbol matches.
    expect(symbols).toHaveLength(0);
  });

  // ─── Namespace declarations ─────────────────────────────────────────

  it('should extract declare namespace as kind "namespace" with declare modifier', () => {
    const parsed = makeFixture(`declare namespace Foo { export function bar(): void; }`);
    const symbols = extractSymbols(parsed);
    const ns = symbols.find((s) => s.name === 'Foo');
    expect(ns).toBeDefined();
    expect(ns!.kind).toBe('namespace');
    expect(ns!.modifiers).toContain('declare');
  });

  it('should extract module with string literal name as kind "namespace"', () => {
    const parsed = makeFixture(`declare module "myModule" { export function bar(): void; }`);
    const symbols = extractSymbols(parsed);
    const ns = symbols.find((s) => s.name === 'myModule');
    expect(ns).toBeDefined();
    expect(ns!.kind).toBe('namespace');
  });

  // ─── ExpressionValue: Decorator arguments ────────────────────────────

  describe('decorator structured arguments', () => {
    it('should convert string literal argument to ExpressionValue', () => {
      const parsed = makeFixture(`@Inject('token') class Svc {}`);
      const cls = extractSymbols(parsed).find(s => s.name === 'Svc')!;
      const arg = cls.decorators![0]!.arguments![0]!;
      expect(arg).toEqual({ kind: 'string', value: 'token' });
    });

    it('should convert numeric literal argument to ExpressionValue', () => {
      const parsed = makeFixture(`@Retry(3) class Svc {}`);
      const cls = extractSymbols(parsed).find(s => s.name === 'Svc')!;
      const arg = cls.decorators![0]!.arguments![0]!;
      expect(arg).toEqual({ kind: 'number', value: 3 });
    });

    it('should convert boolean literal argument to ExpressionValue', () => {
      const parsed = makeFixture(`@Feature(true) class Svc {}`);
      const cls = extractSymbols(parsed).find(s => s.name === 'Svc')!;
      const arg = cls.decorators![0]!.arguments![0]!;
      expect(arg).toEqual({ kind: 'boolean', value: true });
    });

    it('should convert identifier argument to ExpressionValue', () => {
      const parsed = makeFixture(`@Inject(MyService) class Svc {}`);
      const cls = extractSymbols(parsed).find(s => s.name === 'Svc')!;
      const arg = cls.decorators![0]!.arguments![0]!;
      expect(arg).toEqual({ kind: 'identifier', name: 'MyService' });
    });

    it('should convert object literal argument to ExpressionValue', () => {
      const parsed = makeFixture(`@Module({ imports: [AuthModule], controllers: [] }) class App {}`);
      const cls = extractSymbols(parsed).find(s => s.name === 'App')!;
      const arg = cls.decorators![0]!.arguments![0]!;
      expect(arg.kind).toBe('object');
      if (arg.kind === 'object') {
        expect(arg.properties.length).toBe(2);
        expect(arg.properties[0]!.key).toBe('imports');
        expect(arg.properties[0]!.value.kind).toBe('array');
        expect(arg.properties[1]!.key).toBe('controllers');
      }
    });

    it('should convert array literal argument to ExpressionValue', () => {
      const parsed = makeFixture(`@Roles(['admin', 'user']) class Ctrl {}`);
      const cls = extractSymbols(parsed).find(s => s.name === 'Ctrl')!;
      const arg = cls.decorators![0]!.arguments![0]!;
      expect(arg.kind).toBe('array');
      if (arg.kind === 'array') {
        expect(arg.elements).toEqual([
          { kind: 'string', value: 'admin' },
          { kind: 'string', value: 'user' },
        ]);
      }
    });

    it('should convert member expression argument to ExpressionValue', () => {
      const parsed = makeFixture(`@Method(HttpMethod.Get) class Ctrl {}`);
      const cls = extractSymbols(parsed).find(s => s.name === 'Ctrl')!;
      const arg = cls.decorators![0]!.arguments![0]!;
      expect(arg.kind).toBe('member');
      if (arg.kind === 'member') {
        expect(arg.object).toBe('HttpMethod');
        expect(arg.property).toBe('Get');
      }
    });

    it('should convert new expression argument to ExpressionValue', () => {
      const parsed = makeFixture(`@Use(new Guard('admin')) class Ctrl {}`);
      const cls = extractSymbols(parsed).find(s => s.name === 'Ctrl')!;
      const arg = cls.decorators![0]!.arguments![0]!;
      expect(arg.kind).toBe('new');
      if (arg.kind === 'new') {
        expect(arg.callee).toBe('Guard');
        expect(arg.arguments).toEqual([{ kind: 'string', value: 'admin' }]);
      }
    });

    it('should convert arrow function argument to ExpressionValue', () => {
      const parsed = makeFixture(`@Transform(() => true) class Dto {}`);
      const cls = extractSymbols(parsed).find(s => s.name === 'Dto')!;
      const arg = cls.decorators![0]!.arguments![0]!;
      expect(arg.kind).toBe('function');
      if (arg.kind === 'function') {
        expect(arg.sourceText).toContain('=>');
      }
    });

    it('should convert template literal argument to ExpressionValue', () => {
      const parsed = makeFixture("@Path(`/api/v1`) class Ctrl {}");
      const cls = extractSymbols(parsed).find(s => s.name === 'Ctrl')!;
      const arg = cls.decorators![0]!.arguments![0]!;
      expect(arg.kind).toBe('template');
    });

    it('should convert null argument to ExpressionValue', () => {
      const parsed = makeFixture(`@Optional(null) class Svc {}`);
      const cls = extractSymbols(parsed).find(s => s.name === 'Svc')!;
      const arg = cls.decorators![0]!.arguments![0]!;
      expect(arg).toEqual({ kind: 'null', value: null });
    });

    it('should convert undefined argument to ExpressionValue', () => {
      const parsed = makeFixture(`@Optional(undefined) class Svc {}`);
      const cls = extractSymbols(parsed).find(s => s.name === 'Svc')!;
      const arg = cls.decorators![0]!.arguments![0]!;
      expect(arg).toEqual({ kind: 'undefined', value: null });
    });

    it('should convert spread argument in object to ExpressionValue', () => {
      const parsed = makeFixture(`@Config({ ...defaults, key: 'val' }) class Svc {}`);
      const cls = extractSymbols(parsed).find(s => s.name === 'Svc')!;
      const arg = cls.decorators![0]!.arguments![0]!;
      expect(arg.kind).toBe('object');
      if (arg.kind === 'object') {
        const spreadProp = arg.properties.find(p => p.key === '...');
        expect(spreadProp).toBeDefined();
        expect(spreadProp!.value.kind).toBe('spread');
      }
    });

    it('should convert multiple arguments preserving order', () => {
      const parsed = makeFixture(`@Route('GET', '/users', true) class Ctrl {}`);
      const cls = extractSymbols(parsed).find(s => s.name === 'Ctrl')!;
      const args = cls.decorators![0]!.arguments!;
      expect(args.length).toBe(3);
      expect(args[0]).toEqual({ kind: 'string', value: 'GET' });
      expect(args[1]).toEqual({ kind: 'string', value: '/users' });
      expect(args[2]).toEqual({ kind: 'boolean', value: true });
    });

    it('should convert call expression argument to ExpressionValue', () => {
      const parsed = makeFixture(`@Use(createGuard('admin')) class Ctrl {}`);
      const cls = extractSymbols(parsed).find(s => s.name === 'Ctrl')!;
      const arg = cls.decorators![0]!.arguments![0]!;
      expect(arg.kind).toBe('call');
      if (arg.kind === 'call') {
        expect(arg.callee).toBe('createGuard');
        expect(arg.arguments).toEqual([{ kind: 'string', value: 'admin' }]);
      }
    });

    it('should convert negative number to ExpressionValue', () => {
      const parsed = makeFixture(`@Timeout(-1) class Svc {}`);
      const cls = extractSymbols(parsed).find(s => s.name === 'Svc')!;
      const arg = cls.decorators![0]!.arguments![0]!;
      expect(arg).toEqual({ kind: 'number', value: -1 });
    });

    it('should unwrap type assertion and return inner expression', () => {
      const parsed = makeFixture(`@Config({ key: 'val' } as const) class Svc {}`);
      const cls = extractSymbols(parsed).find(s => s.name === 'Svc')!;
      const arg = cls.decorators![0]!.arguments![0]!;
      expect(arg.kind).toBe('object');
    });

    it('should fall back to unresolvable for complex expressions', () => {
      const parsed = makeFixture(`@Deco(a ? b : c) class Svc {}`);
      const cls = extractSymbols(parsed).find(s => s.name === 'Svc')!;
      const arg = cls.decorators![0]!.arguments![0]!;
      expect(arg.kind).toBe('unresolvable');
      if (arg.kind === 'unresolvable') {
        expect(arg.sourceText).toContain('?');
      }
    });
  });

  // ─── ExpressionValue: importSource ───────────────────────────────────

  describe('expression importSource', () => {
    it('should set importSource on identifier from named import', () => {
      const parsed = makeFixture(`import { MyService } from './my.service'; @Inject(MyService) class Svc {}`);
      const cls = extractSymbols(parsed).find(s => s.name === 'Svc')!;
      const arg = cls.decorators![0]!.arguments![0]!;
      expect(arg.kind).toBe('identifier');
      if (arg.kind === 'identifier') {
        expect(arg.name).toBe('MyService');
        expect(arg.importSource).toBe('./my.service');
        expect(arg.originalName).toBeUndefined();
      }
    });

    it('should set importSource and originalName on aliased import', () => {
      const parsed = makeFixture(`import { MyService as Svc } from './my.service'; const x = Svc;`);
      const v = extractSymbols(parsed).find(s => s.name === 'x')!;
      expect(v.initializer!.kind).toBe('identifier');
      if (v.initializer!.kind === 'identifier') {
        expect(v.initializer!.name).toBe('Svc');
        expect(v.initializer!.importSource).toBe('./my.service');
        expect(v.initializer!.originalName).toBe('MyService');
      }
    });

    it('should set importSource on member expression object', () => {
      const parsed = makeFixture(`import { HttpMethod } from '@zipbul/http-adapter'; const x = HttpMethod.Get;`);
      const v = extractSymbols(parsed).find(s => s.name === 'x')!;
      expect(v.initializer!.kind).toBe('member');
      if (v.initializer!.kind === 'member') {
        expect(v.initializer!.object).toBe('HttpMethod');
        expect(v.initializer!.property).toBe('Get');
        expect(v.initializer!.importSource).toBe('@zipbul/http-adapter');
      }
    });

    it('should set importSource on call expression callee', () => {
      const parsed = makeFixture(`import { createGuard } from './guards'; const x = createGuard('admin');`);
      const v = extractSymbols(parsed).find(s => s.name === 'x')!;
      expect(v.initializer!.kind).toBe('call');
      if (v.initializer!.kind === 'call') {
        expect(v.initializer!.callee).toBe('createGuard');
        expect(v.initializer!.importSource).toBe('./guards');
      }
    });

    it('should set importSource on new expression callee', () => {
      const parsed = makeFixture(`import { Guard } from './guards'; const x = new Guard();`);
      const v = extractSymbols(parsed).find(s => s.name === 'x')!;
      expect(v.initializer!.kind).toBe('new');
      if (v.initializer!.kind === 'new') {
        expect(v.initializer!.callee).toBe('Guard');
        expect(v.initializer!.importSource).toBe('./guards');
      }
    });

    it('should set importSource on member call expression (chained)', () => {
      const parsed = makeFixture(`import { factory } from './factory'; const x = factory.create();`);
      const v = extractSymbols(parsed).find(s => s.name === 'x')!;
      expect(v.initializer!.kind).toBe('call');
      if (v.initializer!.kind === 'call') {
        expect(v.initializer!.callee).toBe('factory.create');
        expect(v.initializer!.importSource).toBe('./factory');
      }
    });

    it('should not set importSource on local identifier', () => {
      const parsed = makeFixture(`const MyService = class {}; @Inject(MyService) class Svc {}`);
      const cls = extractSymbols(parsed).find(s => s.name === 'Svc')!;
      const arg = cls.decorators![0]!.arguments![0]!;
      expect(arg.kind).toBe('identifier');
      if (arg.kind === 'identifier') {
        expect(arg.importSource).toBeUndefined();
      }
    });

    it('should set importSource on default import', () => {
      const parsed = makeFixture(`import Config from './config'; const x = Config;`);
      const v = extractSymbols(parsed).find(s => s.name === 'x')!;
      expect(v.initializer!.kind).toBe('identifier');
      if (v.initializer!.kind === 'identifier') {
        expect(v.initializer!.name).toBe('Config');
        expect(v.initializer!.importSource).toBe('./config');
      }
    });

    it('should set importSource on namespace import', () => {
      const parsed = makeFixture(`import * as path from 'node:path'; const x = path.join;`);
      const v = extractSymbols(parsed).find(s => s.name === 'x')!;
      expect(v.initializer!.kind).toBe('member');
      if (v.initializer!.kind === 'member') {
        expect(v.initializer!.importSource).toBe('node:path');
      }
    });

    it('should not set importSource on deeply nested member without import', () => {
      const parsed = makeFixture(`const x = a.b.c;`);
      const v = extractSymbols(parsed).find(s => s.name === 'x')!;
      // a.b is a MemberExpression, so object is 'a.b' and root is not a simple identifier at the top level
      // The outermost member has object 'a.b' which is itself a MemberExpression, not Identifier
      expect(v.initializer!.kind).toBe('member');
      if (v.initializer!.kind === 'member') {
        expect(v.initializer!.importSource).toBeUndefined();
      }
    });
  });

  // ─── Optional chaining and computed members ───────────────────────────

  describe('optional chaining and computed members', () => {
    it('should resolve optional chaining to ExpressionMember', () => {
      const parsed = makeFixture(`import { mod } from './mod'; const x = mod?.val;`);
      const v = extractSymbols(parsed).find(s => s.name === 'x')!;
      expect(v.initializer!.kind).toBe('member');
      if (v.initializer!.kind === 'member') {
        expect(v.initializer!.object).toBe('mod');
        expect(v.initializer!.property).toBe('val');
        expect(v.initializer!.importSource).toBe('./mod');
      }
    });

    it('should resolve chained optional access to ExpressionMember', () => {
      const parsed = makeFixture(`const x = a?.b?.c;`);
      const v = extractSymbols(parsed).find(s => s.name === 'x')!;
      expect(v.initializer!.kind).toBe('member');
      if (v.initializer!.kind === 'member') {
        expect(v.initializer!.property).toBe('c');
      }
    });

    it('should resolve computed string literal member to ExpressionMember', () => {
      const parsed = makeFixture(`import { obj } from './obj'; const x = obj['key'];`);
      const v = extractSymbols(parsed).find(s => s.name === 'x')!;
      expect(v.initializer!.kind).toBe('member');
      if (v.initializer!.kind === 'member') {
        expect(v.initializer!.object).toBe('obj');
        expect(v.initializer!.property).toBe('key');
        expect(v.initializer!.importSource).toBe('./obj');
      }
    });

    it('should fall back to unresolvable for computed non-string member', () => {
      const parsed = makeFixture(`const x = obj[someVar];`);
      const v = extractSymbols(parsed).find(s => s.name === 'x')!;
      expect(v.initializer!.kind).toBe('unresolvable');
    });

    it('should resolve optional call expression', () => {
      const parsed = makeFixture(`import { fn } from './fn'; const x = fn?.();`);
      const v = extractSymbols(parsed).find(s => s.name === 'x')!;
      expect(v.initializer!.kind).toBe('call');
      if (v.initializer!.kind === 'call') {
        expect(v.initializer!.callee).toBe('fn');
        expect(v.initializer!.importSource).toBe('./fn');
      }
    });
  });

  // ─── ExpressionFunction parameters ───────────────────────────────────

  describe('ExpressionFunction parameters', () => {
    it('should extract parameters from arrow function expression', () => {
      const parsed = makeFixture(`
        import { MyService } from './svc';
        const factory = (svc: MyService, name: string) => svc.create();
      `);
      const v = extractSymbols(parsed).find(s => s.name === 'factory')!;
      // factory is extracted as kind: 'function' because init is ArrowFunctionExpression
      // but the initializer is set on the variable... actually for arrow functions,
      // the variable kind becomes 'function' and initializer is not set.
      // So check the parameters directly on the symbol
      expect(v.kind).toBe('function');
      expect(v.parameters).toBeDefined();
      expect(v.parameters![0]!.name).toBe('svc');
      expect(v.parameters![0]!.type).toBe('MyService');
      expect(v.parameters![0]!.typeImportSource).toBe('./svc');
      expect(v.parameters![1]!.name).toBe('name');
      expect(v.parameters![1]!.type).toBe('string');
    });

    it('should extract parameters from function expression in decorator argument', () => {
      const parsed = makeFixture(`
        import { Config } from './config';
        @Transform((cfg: Config) => cfg.value)
        class Dto {}
      `);
      const cls = extractSymbols(parsed).find(s => s.name === 'Dto')!;
      const arg = cls.decorators![0]!.arguments![0]!;
      expect(arg.kind).toBe('function');
      if (arg.kind === 'function') {
        expect(arg.parameters).toBeDefined();
        expect(arg.parameters![0]!.name).toBe('cfg');
        expect(arg.parameters![0]!.type).toBe('Config');
        expect(arg.parameters![0]!.typeImportSource).toBe('./config');
      }
    });

    it('should extract parameters from function expression in variable initializer', () => {
      const parsed = makeFixture(`const handler = function(x: number, y: string) { return x; };`);
      // This is a function expression, so variable becomes kind: 'function'
      const v = extractSymbols(parsed).find(s => s.name === 'handler')!;
      expect(v.kind).toBe('function');
      expect(v.parameters![0]!.name).toBe('x');
      expect(v.parameters![0]!.type).toBe('number');
    });

    it('should extract parameters from arrow in object literal', () => {
      const parsed = makeFixture(`
        import { Req } from './req';
        const cfg = { handler: (req: Req) => req.body };
      `);
      const v = extractSymbols(parsed).find(s => s.name === 'cfg')!;
      expect(v.initializer!.kind).toBe('object');
      if (v.initializer!.kind === 'object') {
        const handler = v.initializer!.properties.find(p => p.key === 'handler')!;
        expect(handler.value.kind).toBe('function');
        if (handler.value.kind === 'function') {
          expect(handler.value.parameters).toBeDefined();
          expect(handler.value.parameters![0]!.name).toBe('req');
          expect(handler.value.parameters![0]!.type).toBe('Req');
          expect(handler.value.parameters![0]!.typeImportSource).toBe('./req');
        }
      }
    });

    it('should set empty parameters on arrow with no params', () => {
      const parsed = makeFixture(`const fn = () => 42;`);
      const v = extractSymbols(parsed).find(s => s.name === 'fn')!;
      expect(v.kind).toBe('function');
      expect(v.parameters).toEqual([]);
    });
  });

  // ─── Method/property decorators and parameter decorators ─────────────

  describe('method and parameter decorators', () => {
    it('should extract decorators from class methods', () => {
      const parsed = makeFixture(`
        class Ctrl {
          @Get('/users')
          @Middleware('auth')
          getUsers() {}
        }
      `);
      const cls = extractSymbols(parsed).find(s => s.name === 'Ctrl')!;
      const method = cls.members!.find(m => m.name === 'getUsers')!;
      expect(method.decorators).toBeDefined();
      expect(method.decorators!.length).toBe(2);
      expect(method.decorators![0]!.name).toBe('Get');
      expect(method.decorators![0]!.arguments![0]).toEqual({ kind: 'string', value: '/users' });
      expect(method.decorators![1]!.name).toBe('Middleware');
    });

    it('should extract parameter decorators from constructor with TSParameterProperty', () => {
      const parsed = makeFixture(`
        class Svc {
          constructor(@Inject('token') private readonly dep: string) {}
        }
      `);
      const cls = extractSymbols(parsed).find(s => s.name === 'Svc')!;
      const ctor = cls.members!.find(m => m.methodKind === 'constructor')!;
      const param = ctor.parameters![0]!;
      expect(param.decorators).toBeDefined();
      expect(param.decorators![0]!.name).toBe('Inject');
      expect(param.decorators![0]!.arguments![0]).toEqual({ kind: 'string', value: 'token' });
    });

    it('should extract parameter decorators from regular method parameters', () => {
      const parsed = makeFixture(`
        class Ctrl {
          handle(@Body() body: string, @Query('page') page: number) {}
        }
      `);
      const cls = extractSymbols(parsed).find(s => s.name === 'Ctrl')!;
      const method = cls.members!.find(m => m.name === 'handle')!;
      expect(method.parameters![0]!.decorators![0]!.name).toBe('Body');
      expect(method.parameters![1]!.decorators![0]!.name).toBe('Query');
      expect(method.parameters![1]!.decorators![0]!.arguments![0]).toEqual({ kind: 'string', value: 'page' });
    });

    it('should not set decorators on method without decorators', () => {
      const parsed = makeFixture(`class Svc { doWork() {} }`);
      const cls = extractSymbols(parsed).find(s => s.name === 'Svc')!;
      const method = cls.members!.find(m => m.name === 'doWork')!;
      expect(method.decorators).toBeUndefined();
    });

    it('should extract decorators from abstract methods', () => {
      const parsed = makeFixture(`
        abstract class Base {
          @Log()
          abstract handle(): void;
        }
      `);
      const cls = extractSymbols(parsed).find(s => s.name === 'Base')!;
      const method = cls.members!.find(m => m.name === 'handle')!;
      expect(method.decorators).toBeDefined();
      expect(method.decorators![0]!.name).toBe('Log');
    });
  });

  // ─── Parameter typeImportSource ──────────────────────────────────────

  describe('parameter typeImportSource', () => {
    it('should set typeImportSource for imported type annotation', () => {
      const parsed = makeFixture(`
        import { MyService } from './my.service';
        function f(svc: MyService) {}
      `);
      const fn = extractSymbols(parsed).find(s => s.name === 'f')!;
      expect(fn.parameters![0]!.type).toBe('MyService');
      expect(fn.parameters![0]!.typeImportSource).toBe('./my.service');
    });

    it('should not set typeImportSource for built-in type', () => {
      const parsed = makeFixture(`function f(x: string) {}`);
      const fn = extractSymbols(parsed).find(s => s.name === 'f')!;
      expect(fn.parameters![0]!.typeImportSource).toBeUndefined();
    });

    it('should not set typeImportSource for local type', () => {
      const parsed = makeFixture(`
        interface Local {}
        function f(x: Local) {}
      `);
      const fn = extractSymbols(parsed).find(s => s.name === 'f')!;
      expect(fn.parameters![0]!.typeImportSource).toBeUndefined();
    });

    it('should set typeImportSource on constructor parameter with TSParameterProperty', () => {
      const parsed = makeFixture(`
        import { Dep } from './dep';
        class Svc { constructor(private dep: Dep) {} }
      `);
      const cls = extractSymbols(parsed).find(s => s.name === 'Svc')!;
      const ctor = cls.members!.find(m => m.methodKind === 'constructor')!;
      expect(ctor.parameters![0]!.typeImportSource).toBe('./dep');
    });

    it('should set typeImportSource on parameter with default value', () => {
      const parsed = makeFixture(`
        import { Config } from './config';
        function f(cfg: Config = defaultCfg) {}
      `);
      const fn = extractSymbols(parsed).find(s => s.name === 'f')!;
      expect(fn.parameters![0]!.typeImportSource).toBe('./config');
    });
  });

  // ─── ExpressionValue: Enum initializers ──────────────────────────────

  describe('enum member initializers', () => {
    it('should extract string initializer from enum member', () => {
      const parsed = makeFixture(`enum HttpMethod { Get = 'GET', Post = 'POST' }`);
      const en = extractSymbols(parsed).find(s => s.name === 'HttpMethod')!;
      const get = en.members!.find(m => m.name === 'Get')!;
      const post = en.members!.find(m => m.name === 'Post')!;
      expect(get.initializer).toEqual({ kind: 'string', value: 'GET' });
      expect(post.initializer).toEqual({ kind: 'string', value: 'POST' });
    });

    it('should extract numeric initializer from enum member', () => {
      const parsed = makeFixture(`enum Status { Active = 1, Inactive = 0 }`);
      const en = extractSymbols(parsed).find(s => s.name === 'Status')!;
      expect(en.members![0]!.initializer).toEqual({ kind: 'number', value: 1 });
      expect(en.members![1]!.initializer).toEqual({ kind: 'number', value: 0 });
    });

    it('should not set initializer when enum member has no explicit value', () => {
      const parsed = makeFixture(`enum Dir { Up, Down, Left, Right }`);
      const en = extractSymbols(parsed).find(s => s.name === 'Dir')!;
      for (const m of en.members!) {
        expect(m.initializer).toBeUndefined();
      }
    });

    it('should extract mixed initializers from enum with partial values', () => {
      const parsed = makeFixture(`enum Mixed { A = 10, B, C = 'str' }`);
      const en = extractSymbols(parsed).find(s => s.name === 'Mixed')!;
      expect(en.members![0]!.initializer).toEqual({ kind: 'number', value: 10 });
      expect(en.members![1]!.initializer).toBeUndefined();
      expect(en.members![2]!.initializer).toEqual({ kind: 'string', value: 'str' });
    });

    it('should extract computed enum initializer as unresolvable', () => {
      const parsed = makeFixture(`enum Computed { A = 1 << 0, B = 1 << 1 }`);
      const en = extractSymbols(parsed).find(s => s.name === 'Computed')!;
      expect(en.members![0]!.initializer!.kind).toBe('unresolvable');
      expect(en.members![1]!.initializer!.kind).toBe('unresolvable');
    });

    it('should extract negative numeric enum initializer', () => {
      const parsed = makeFixture(`enum Neg { MinusOne = -1 }`);
      const en = extractSymbols(parsed).find(s => s.name === 'Neg')!;
      expect(en.members![0]!.initializer).toEqual({ kind: 'number', value: -1 });
    });
  });

  // ─── ExpressionValue: Class property type + initializer ──────────────

  describe('class property type and initializer', () => {
    it('should extract type annotation from class property', () => {
      const parsed = makeFixture(`class User { name: string; age: number; }`);
      const cls = extractSymbols(parsed).find(s => s.name === 'User')!;
      const name = cls.members!.find(m => m.name === 'name')!;
      const age = cls.members!.find(m => m.name === 'age')!;
      expect(name.returnType).toBe('string');
      expect(age.returnType).toBe('number');
    });

    it('should extract initializer from class property', () => {
      const parsed = makeFixture(`class Config { retries: number = 3; label = 'default'; }`);
      const cls = extractSymbols(parsed).find(s => s.name === 'Config')!;
      const retries = cls.members!.find(m => m.name === 'retries')!;
      const label = cls.members!.find(m => m.name === 'label')!;
      expect(retries.returnType).toBe('number');
      expect(retries.initializer).toEqual({ kind: 'number', value: 3 });
      expect(label.initializer).toEqual({ kind: 'string', value: 'default' });
    });

    it('should extract complex initializer from class property', () => {
      const parsed = makeFixture(`class Svc { items: string[] = ['a', 'b']; }`);
      const cls = extractSymbols(parsed).find(s => s.name === 'Svc')!;
      const items = cls.members!.find(m => m.name === 'items')!;
      expect(items.returnType).toBe('string[]');
      expect(items.initializer!.kind).toBe('array');
    });

    it('should not set initializer when property has no default value', () => {
      const parsed = makeFixture(`class Svc { id: number; }`);
      const cls = extractSymbols(parsed).find(s => s.name === 'Svc')!;
      const id = cls.members!.find(m => m.name === 'id')!;
      expect(id.returnType).toBe('number');
      expect(id.initializer).toBeUndefined();
    });

    it('should extract decorators from class property', () => {
      const parsed = makeFixture(`class Dto { @Column('varchar') name: string; }`);
      const cls = extractSymbols(parsed).find(s => s.name === 'Dto')!;
      const name = cls.members!.find(m => m.name === 'name')!;
      expect(name.decorators).toBeDefined();
      expect(name.decorators![0]!.name).toBe('Column');
      expect(name.decorators![0]!.arguments![0]).toEqual({ kind: 'string', value: 'varchar' });
    });

    it('should extract generic type annotation from class property', () => {
      const parsed = makeFixture(`class Repo { items: Map<string, number>; }`);
      const cls = extractSymbols(parsed).find(s => s.name === 'Repo')!;
      const items = cls.members!.find(m => m.name === 'items')!;
      expect(items.returnType).toBe('Map<string, number>');
    });

    it('should extract object initializer from class property', () => {
      const parsed = makeFixture(`class Cfg { opts = { timeout: 30, debug: false }; }`);
      const cls = extractSymbols(parsed).find(s => s.name === 'Cfg')!;
      const opts = cls.members!.find(m => m.name === 'opts')!;
      expect(opts.initializer!.kind).toBe('object');
      if (opts.initializer!.kind === 'object') {
        expect(opts.initializer!.properties.length).toBe(2);
        expect(opts.initializer!.properties[0]!.key).toBe('timeout');
        expect(opts.initializer!.properties[0]!.value).toEqual({ kind: 'number', value: 30 });
      }
    });
  });

  // ─── ExpressionValue: Variable initializers ──────────────────────────

  describe('variable initializers', () => {
    it('should extract call expression initializer from variable', () => {
      const parsed = makeFixture(`const config = defineModule({ imports: [] });`);
      const v = extractSymbols(parsed).find(s => s.name === 'config')!;
      expect(v.kind).toBe('variable');
      expect(v.initializer!.kind).toBe('call');
      if (v.initializer!.kind === 'call') {
        expect(v.initializer!.callee).toBe('defineModule');
        expect(v.initializer!.arguments.length).toBe(1);
        expect(v.initializer!.arguments[0]!.kind).toBe('object');
      }
    });

    it('should extract simple literal initializer from variable', () => {
      const parsed = makeFixture(`const PI = 3.14;`);
      const v = extractSymbols(parsed).find(s => s.name === 'PI')!;
      expect(v.kind).toBe('variable');
      expect(v.initializer).toEqual({ kind: 'number', value: 3.14 });
    });

    it('should extract string initializer from variable', () => {
      const parsed = makeFixture(`const NAME = 'gildash';`);
      const v = extractSymbols(parsed).find(s => s.name === 'NAME')!;
      expect(v.initializer).toEqual({ kind: 'string', value: 'gildash' });
    });

    it('should not set initializer when variable is a function expression', () => {
      const parsed = makeFixture(`const fn = () => {};`);
      const v = extractSymbols(parsed).find(s => s.name === 'fn')!;
      expect(v.kind).toBe('function');
      expect(v.initializer).toBeUndefined();
    });

    it('should not set initializer when variable has no initializer', () => {
      const parsed = makeFixture(`let x: number;`);
      const v = extractSymbols(parsed).find(s => s.name === 'x')!;
      expect(v.initializer).toBeUndefined();
    });

    it('should extract new expression initializer from variable', () => {
      const parsed = makeFixture(`const map = new Map<string, number>();`);
      const v = extractSymbols(parsed).find(s => s.name === 'map')!;
      expect(v.initializer!.kind).toBe('new');
      if (v.initializer!.kind === 'new') {
        expect(v.initializer!.callee).toContain('Map');
      }
    });

    it('should extract nested object initializer from variable', () => {
      const parsed = makeFixture(`const cfg = { db: { host: 'localhost', port: 5432 }, debug: true };`);
      const v = extractSymbols(parsed).find(s => s.name === 'cfg')!;
      expect(v.initializer!.kind).toBe('object');
      if (v.initializer!.kind === 'object') {
        const dbProp = v.initializer!.properties.find(p => p.key === 'db')!;
        expect(dbProp.value.kind).toBe('object');
        if (dbProp.value.kind === 'object') {
          expect(dbProp.value.properties[0]!.key).toBe('host');
          expect(dbProp.value.properties[0]!.value).toEqual({ kind: 'string', value: 'localhost' });
          expect(dbProp.value.properties[1]!.key).toBe('port');
          expect(dbProp.value.properties[1]!.value).toEqual({ kind: 'number', value: 5432 });
        }
      }
    });

    it('should extract array initializer from variable', () => {
      const parsed = makeFixture(`const items = [1, 'two', true];`);
      const v = extractSymbols(parsed).find(s => s.name === 'items')!;
      expect(v.initializer!.kind).toBe('array');
      if (v.initializer!.kind === 'array') {
        expect(v.initializer!.elements).toEqual([
          { kind: 'number', value: 1 },
          { kind: 'string', value: 'two' },
          { kind: 'boolean', value: true },
        ]);
      }
    });

    it('should not set initializer for destructured variable declarations', () => {
      const parsed = makeFixture(`const { a, b } = obj;`);
      const syms = extractSymbols(parsed);
      for (const s of syms) {
        expect(s.initializer).toBeUndefined();
      }
    });
  });

  // ─── ExpressionValue: Depth limit ────────────────────────────────────

  describe('expression depth limit', () => {
    it('should fall back to unresolvable when nesting exceeds depth limit', () => {
      // 9 levels of nesting: [[[[[[[[['x']]]]]]]]]
      const deep = '[[[[[[[[["x"]]]]]]]]]';
      const parsed = makeFixture(`const x = ${deep};`);
      const v = extractSymbols(parsed).find(s => s.name === 'x')!;
      // Walk down to find the unresolvable at depth limit
      let current = v.initializer!;
      let depth = 0;
      while (current.kind === 'array' && depth < 20) {
        current = (current as { elements: any[] }).elements[0]!;
        depth++;
      }
      // Should hit unresolvable before reaching the innermost string
      expect(current.kind).toBe('unresolvable');
    });
  });
});
