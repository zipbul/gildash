import { describe, it, expect } from 'bun:test';
import { parseSync } from 'oxc-parser';
import { extractHeritage } from './heritage-extractor';
import type { ImportReference } from './types';

const FILE = '/project/src/index.ts';

function parse(source: string, filePath = FILE) {
  const { program } = parseSync(filePath, source);
  return program as any;
}

function makeImportMap(entries: [string, ImportReference][] = []): Map<string, ImportReference> {
  return new Map(entries);
}

describe('extractHeritage', () => {
  // HP — extends (local)
  it('should produce an extends relation when class extends a locally defined class', () => {
    const ast = parse(`class Animal {} class Dog extends Animal {}`);
    const relations = extractHeritage(ast, FILE, makeImportMap());
    const rel = relations.find((r) => r.type === 'extends' && r.srcSymbolName === 'Dog');
    expect(rel).toBeDefined();
    expect(rel!.dstSymbolName).toBe('Animal');
    expect(rel!.metaJson).toContain('"isLocal":true');
  });

  // HP — implements (local)
  it('should produce an implements relation when class implements a locally defined interface', () => {
    const ast = parse(`interface Service {} class ServiceImpl implements Service {}`);
    const relations = extractHeritage(ast, FILE, makeImportMap());
    const rel = relations.find((r) => r.type === 'implements' && r.srcSymbolName === 'ServiceImpl');
    expect(rel).toBeDefined();
    expect(rel!.dstSymbolName).toBe('Service');
  });

  // HP — extends (imported)
  it('should set dstFilePath to imported module path when base class is an imported symbol', () => {
    const importMap = makeImportMap([
      ['Base', { path: '/project/src/base.ts', importedName: 'Base' }],
    ]);
    const ast = parse(`class Child extends Base {}`);
    const relations = extractHeritage(ast, FILE, importMap);
    const rel = relations.find((r) => r.type === 'extends');
    expect(rel?.dstFilePath).toBe('/project/src/base.ts');
  });

  // HP — implements (imported)
  it('should set dstFilePath to imported module path when implemented interface is an imported symbol', () => {
    const importMap = makeImportMap([
      ['IFoo', { path: '/project/src/ifoo.ts', importedName: 'IFoo' }],
    ]);
    const ast = parse(`class FooImpl implements IFoo {}`);
    const relations = extractHeritage(ast, FILE, importMap);
    const rel = relations.find((r) => r.type === 'implements');
    expect(rel?.dstFilePath).toBe('/project/src/ifoo.ts');
  });

  // NE — no heritage
  it('should return empty array when class has no extends or implements clause', () => {
    const ast = parse(`class Plain {}`);
    expect(extractHeritage(ast, FILE, makeImportMap())).toEqual([]);
  });

  // ED — empty source
  it('should return empty array when source is empty', () => {
    const ast = parse('');
    expect(extractHeritage(ast, FILE, makeImportMap())).toEqual([]);
  });

  // multiple implements
  it('should produce one relation per interface when class implements multiple interfaces', () => {
    const ast = parse(`class Multi implements A, B, C {}`);
    const relations = extractHeritage(ast, FILE, makeImportMap());
    const implRels = relations.filter((r) => r.type === 'implements' && r.srcSymbolName === 'Multi');
    expect(implRels.length).toBe(3);
  });

  // namespace import
  it('should include {"isNamespaceImport":true} in metaJson when base class is accessed via namespace import', () => {
    const importMap = makeImportMap([
      ['ns', { path: '/project/src/ns.ts', importedName: '*' }],
    ]);
    const ast = parse(`class Child extends ns.Base {}`);
    const relations = extractHeritage(ast, FILE, importMap);
    const rel = relations.find((r) => r.type === 'extends');
    expect(rel?.metaJson).toContain('"isNamespaceImport":true');
  });

  // ID
  it('should return identical relations when called repeatedly with the same AST', () => {
    const ast = parse(`class A {} class B extends A {}`);
    const r1 = extractHeritage(ast, FILE, makeImportMap());
    const r2 = extractHeritage(ast, FILE, makeImportMap());
    expect(r1).toEqual(r2);
  });
});
