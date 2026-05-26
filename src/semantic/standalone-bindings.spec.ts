import { test, expect } from 'bun:test';
import { buildStandaloneBindings } from './standalone-bindings';

function names(content: string, filePath = '/s.ts') {
  return buildStandaloneBindings(filePath, content).map((b) => b.declaration.name);
}
function binding(content: string, name: string, filePath = '/s.ts') {
  return buildStandaloneBindings(filePath, content).find((b) => b.declaration.name === name);
}

test('groups a block-scoped var with its outer references (hoisting)', () => {
  const b = binding('function f() { if (true) { var c = 1; } c = 2; return c; }', 'c');
  expect(b).toBeDefined();
  expect(b!.references.length).toBe(3); // var decl + assignment + read
  expect(b!.references.map((r) => r.writeKind)).toEqual(['declaration', 'assignment', undefined]);
});

test('captures destructuring bindings and excludes the source key', () => {
  const ns = names('let { x, y: z } = o;\nx;');
  expect(ns).toContain('x');
  expect(ns).toContain('z');
  expect(ns).not.toContain('y'); // source property key, not a binding
});

test('classifies compound assignment', () => {
  const b = binding('let a = 0;\na += 1;', 'a');
  expect(b!.references.map((r) => r.writeKind)).toContain('compound-assignment');
});

test('excludes class members but keeps the class binding', () => {
  const ns = names('class C { x = 1; m() { return this.x; } }');
  expect(ns).toContain('C');
  expect(ns).not.toContain('x');
  expect(ns).not.toContain('m');
});

test('keeps a local import binding without crashing on an unresolved module', () => {
  const ns = names('import { a } from "./missing";\nuse(a);');
  expect(ns).toContain('a'); // local import binding; module target not followed
});

test('omits global/lib symbols (noLib isolation) but keeps locals', () => {
  // The whole point of isolation: globals are not resolved (no lib).
  const ns = names('function f() { console.log("x"); const p = Promise; let b = 1; return b; }');
  expect(ns).toContain('b'); // local binding present
  expect(ns).toContain('f');
  expect(ns).not.toContain('console'); // global — omitted by design
  expect(ns).not.toContain('Promise');
});

test('parses a .tsx source and does not bind JSX attribute/component names', () => {
  const ns = names('const x = 1;\nconst el = <Foo prop={x} />;', '/s.tsx');
  expect(ns).toContain('x'); // the value reference inside {x}
  expect(ns).not.toContain('prop'); // JSX attribute name is not a binding
});

test('keeps two shadowed bindings separate', () => {
  const code = 'function f() { let a = 1; function g() { let a = 2; return a; } return a + g(); }';
  const as = buildStandaloneBindings('/s.ts', code).filter((b) => b.declaration.name === 'a');
  expect(as.length).toBe(2); // outer a and inner a are distinct symbols
});

test('returns declaration.filePath as the given path', () => {
  const b = binding('const v = 1;', 'v', '/project/src/given.ts');
  expect(b!.declaration.filePath).toBe('/project/src/given.ts');
});
