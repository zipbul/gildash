import { describe, it, expect, mock, beforeEach } from 'bun:test';
import type { ImportReference } from './types';

const mockGetQualifiedName = mock(() => null as any);

let capturedVisitorCallbacks: Record<string, Function> = {};

class MockVisitor {
  constructor(callbacks: Record<string, Function>) {
    capturedVisitorCallbacks = callbacks;
  }
  visit(_program: any): void {
    // No-op by default; tests invoke captured callbacks directly
  }
}

mock.module('oxc-parser', () => ({
  Visitor: MockVisitor,
}));

mock.module('../parser/ast-utils', () => ({
  getQualifiedName: mockGetQualifiedName,
}));

import { extractHeritage } from './heritage-extractor';

const FILE = '/project/src/index.ts';

function makeImportMap(entries: [string, ImportReference][] = []): Map<string, ImportReference> {
  return new Map(entries);
}

function fakeClassNode(
  name: string,
  opts: { superClass?: any; implements?: any[] } = {},
): any {
  return {
    type: 'ClassDeclaration',
    id: { name },
    superClass: opts.superClass ?? null,
    implements: opts.implements ?? [],
    body: { body: [] },
  };
}

describe('extractHeritage', () => {
  beforeEach(() => {
    mock.module('oxc-parser', () => ({
      Visitor: MockVisitor,
    }));
    mock.module('../parser/ast-utils', () => ({
      getQualifiedName: mockGetQualifiedName,
    }));
    capturedVisitorCallbacks = {};
    mockGetQualifiedName.mockClear();
    mockGetQualifiedName.mockReturnValue(null);
  });

  it('should produce an extends relation when class extends a locally defined class', () => {
    const superClassNode = { type: 'Identifier', name: 'Animal' };
    MockVisitor.prototype.visit = function () {
      capturedVisitorCallbacks.ClassDeclaration?.(fakeClassNode('Dog', { superClass: superClassNode }));
    };
    mockGetQualifiedName.mockReturnValue({ root: 'Animal', parts: [], full: 'Animal' });

    const relations = extractHeritage({} as any, FILE, makeImportMap());
    const rel = relations.find((r) => r.type === 'extends' && r.srcSymbolName === 'Dog');

    expect(rel).toBeDefined();
    expect(rel!.dstSymbolName).toBe('Animal');
    expect(rel!.metaJson).toContain('"isLocal":true');
  });

  it('should produce an implements relation when class implements a locally defined interface', () => {
    const exprNode = { type: 'Identifier', name: 'Service' };
    MockVisitor.prototype.visit = function () {
      capturedVisitorCallbacks.ClassDeclaration?.(fakeClassNode('ServiceImpl', { implements: [{ expression: exprNode }] }));
    };
    mockGetQualifiedName.mockReturnValue({ root: 'Service', parts: [], full: 'Service' });

    const relations = extractHeritage({} as any, FILE, makeImportMap());
    const rel = relations.find((r) => r.type === 'implements' && r.srcSymbolName === 'ServiceImpl');

    expect(rel).toBeDefined();
    expect(rel!.dstSymbolName).toBe('Service');
  });

  it('should set dstFilePath to imported module path when base class is an imported symbol', () => {
    const superClassNode = { type: 'Identifier', name: 'Base' };
    MockVisitor.prototype.visit = function () {
      capturedVisitorCallbacks.ClassDeclaration?.(fakeClassNode('Child', { superClass: superClassNode }));
    };
    mockGetQualifiedName.mockReturnValue({ root: 'Base', parts: [], full: 'Base' });

    const importMap = makeImportMap([
      ['Base', { path: '/project/src/base.ts', importedName: 'Base' }],
    ]);
    const relations = extractHeritage({} as any, FILE, importMap);
    const rel = relations.find((r) => r.type === 'extends');

    expect(rel?.dstFilePath).toBe('/project/src/base.ts');
  });

  it('should set dstFilePath to imported module path when implemented interface is an imported symbol', () => {
    const exprNode = { type: 'Identifier', name: 'IFoo' };
    MockVisitor.prototype.visit = function () {
      capturedVisitorCallbacks.ClassDeclaration?.(fakeClassNode('FooImpl', { implements: [{ expression: exprNode }] }));
    };
    mockGetQualifiedName.mockReturnValue({ root: 'IFoo', parts: [], full: 'IFoo' });

    const importMap = makeImportMap([
      ['IFoo', { path: '/project/src/ifoo.ts', importedName: 'IFoo' }],
    ]);
    const relations = extractHeritage({} as any, FILE, importMap);
    const rel = relations.find((r) => r.type === 'implements');

    expect(rel?.dstFilePath).toBe('/project/src/ifoo.ts');
  });

  it('should return empty array when class has no extends or implements clause', () => {
    MockVisitor.prototype.visit = function () {
      capturedVisitorCallbacks.ClassDeclaration?.(fakeClassNode('Plain'));
    };

    const relations = extractHeritage({} as any, FILE, makeImportMap());

    expect(relations).toEqual([]);
  });

  it('should return empty array when source is empty', () => {
    MockVisitor.prototype.visit = function () {
      // no callbacks invoked
    };

    const relations = extractHeritage({} as any, FILE, makeImportMap());

    expect(relations).toEqual([]);
  });

  it('should produce one relation per interface when class implements multiple interfaces', () => {
    const exprA = { type: 'Identifier', name: 'A' };
    const exprB = { type: 'Identifier', name: 'B' };
    const exprC = { type: 'Identifier', name: 'C' };
    MockVisitor.prototype.visit = function () {
      capturedVisitorCallbacks.ClassDeclaration?.(fakeClassNode('Multi', {
        implements: [{ expression: exprA }, { expression: exprB }, { expression: exprC }],
      }));
    };
    mockGetQualifiedName
      .mockReturnValueOnce({ root: 'A', parts: [], full: 'A' })
      .mockReturnValueOnce({ root: 'B', parts: [], full: 'B' })
      .mockReturnValueOnce({ root: 'C', parts: [], full: 'C' });

    const relations = extractHeritage({} as any, FILE, makeImportMap());
    const implRels = relations.filter((r) => r.type === 'implements' && r.srcSymbolName === 'Multi');

    expect(implRels.length).toBe(3);
  });

  it('should include {"isNamespaceImport":true} in metaJson when base class is accessed via namespace import', () => {
    const superClassNode = { type: 'MemberExpression', object: { type: 'Identifier', name: 'ns' }, property: { name: 'Base' } };
    MockVisitor.prototype.visit = function () {
      capturedVisitorCallbacks.ClassDeclaration?.(fakeClassNode('Child', { superClass: superClassNode }));
    };
    mockGetQualifiedName.mockReturnValue({ root: 'ns', parts: ['Base'], full: 'ns.Base' });

    const importMap = makeImportMap([
      ['ns', { path: '/project/src/ns.ts', importedName: '*' }],
    ]);
    const relations = extractHeritage({} as any, FILE, importMap);
    const rel = relations.find((r) => r.type === 'extends');

    expect(rel?.metaJson).toContain('"isNamespaceImport":true');
  });

  it('should return identical relations when called repeatedly with the same AST', () => {
    const superClassNode = { type: 'Identifier', name: 'A' };
    MockVisitor.prototype.visit = function () {
      capturedVisitorCallbacks.ClassDeclaration?.(fakeClassNode('B', { superClass: superClassNode }));
    };
    mockGetQualifiedName.mockReturnValue({ root: 'A', parts: [], full: 'A' });

    const r1 = extractHeritage({} as any, FILE, makeImportMap());
    const r2 = extractHeritage({} as any, FILE, makeImportMap());

    expect(r1).toEqual(r2);
  });

  it('should produce extends relations when interface extends other interfaces', () => {
    MockVisitor.prototype.visit = function () {
      capturedVisitorCallbacks.TSInterfaceDeclaration?.({
        type: 'TSInterfaceDeclaration',
        id: { name: 'Child' },
        extends: [{ expression: { type: 'Identifier', name: 'Base' } }],
      });
    };
    mockGetQualifiedName.mockReturnValue({ root: 'Base', parts: [], full: 'Base' });

    const relations = extractHeritage({} as any, FILE, makeImportMap());
    const rel = relations.find((r) => r.type === 'extends' && r.srcSymbolName === 'Child');

    expect(rel).toBeDefined();
    expect(rel?.dstSymbolName).toBe('Base');
  });
});
