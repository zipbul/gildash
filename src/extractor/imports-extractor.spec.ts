import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockResolveImport = mock(() => [] as string[]);

let capturedVisitorCallbacks: Record<string, Function> = {};
let mockVisitImpl: (() => void) | null = null;

class MockVisitor {
  constructor(callbacks: Record<string, Function>) {
    capturedVisitorCallbacks = callbacks;
  }
  visit(_program: any): void {
    mockVisitImpl?.();
  }
}

mock.module('oxc-parser', () => ({
  Visitor: MockVisitor,
}));

import { extractImports } from './imports-extractor';

const FILE = '/project/src/index.ts';
const RESOLVED = '/resolved/path.ts';

function fakeAst(body: any[]): any {
  return { body };
}

describe('extractImports', () => {
  beforeEach(() => {
    mock.module('oxc-parser', () => ({
      Visitor: MockVisitor,
    }));
    mockResolveImport.mockClear();
    capturedVisitorCallbacks = {};
    mockVisitImpl = null;
    mockResolveImport.mockReturnValue([RESOLVED]);
  });

  // 1. [HP] side-effect import
  it('should produce 1 relation with null dstSymbolName and null srcSymbolName when import has no specifiers', () => {
    const ast = fakeAst([
      { type: 'ImportDeclaration', source: { value: './side' }, importKind: 'value', specifiers: [] },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.dstSymbolName).toBeNull();
    expect(relations[0]!.srcSymbolName).toBeNull();
    expect(relations[0]!.type).toBe('imports');
  });

  // 2. [HP] single named import
  it('should produce 1 relation with dstSymbolName Foo and srcSymbolName Foo when named import has one specifier', () => {
    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: './bar' },
        importKind: 'value',
        specifiers: [
          { type: 'ImportSpecifier', imported: { name: 'Foo' }, local: { name: 'Foo' }, importKind: 'value' },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.dstSymbolName).toBe('Foo');
    expect(relations[0]!.srcSymbolName).toBe('Foo');
    expect(relations[0]!.type).toBe('imports');
  });

  // 3. [HP] alias named import
  it('should set dstSymbolName to original name and srcSymbolName to alias when named import uses alias', () => {
    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: './bar' },
        importKind: 'value',
        specifiers: [
          { type: 'ImportSpecifier', imported: { name: 'Foo' }, local: { name: 'Bar' }, importKind: 'value' },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.dstSymbolName).toBe('Foo');
    expect(relations[0]!.srcSymbolName).toBe('Bar');
  });

  // 4. [HP] default import
  it('should produce 1 relation with dstSymbolName default and srcSymbolName equal to local name when default import is used', () => {
    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: './bar' },
        importKind: 'value',
        specifiers: [
          { type: 'ImportDefaultSpecifier', local: { name: 'MyDefault' } },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.dstSymbolName).toBe('default');
    expect(relations[0]!.srcSymbolName).toBe('MyDefault');
  });

  // 5. [HP] namespace import
  it('should produce 1 relation with dstSymbolName asterisk and importKind namespace in meta when namespace import is used', () => {
    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: './bar' },
        importKind: 'value',
        specifiers: [
          { type: 'ImportNamespaceSpecifier', local: { name: 'NS' } },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.dstSymbolName).toBe('*');
    expect(relations[0]!.srcSymbolName).toBe('NS');
    expect(relations[0]!.metaJson).toContain('"importKind":"namespace"');
  });

  // 6. [HP] multiple named imports
  it('should produce N relations matching specifier count when import has multiple named specifiers', () => {
    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: './bar' },
        importKind: 'value',
        specifiers: [
          { type: 'ImportSpecifier', imported: { name: 'A' }, local: { name: 'A' }, importKind: 'value' },
          { type: 'ImportSpecifier', imported: { name: 'B' }, local: { name: 'B' }, importKind: 'value' },
          { type: 'ImportSpecifier', imported: { name: 'C' }, local: { name: 'C' }, importKind: 'value' },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(3);
    expect(relations.map((r) => r.dstSymbolName)).toEqual(['A', 'B', 'C']);
  });

  // 7. [HP] type-only import statement
  it('should include isType true in metaJson when import declaration has type-only statement-level import', () => {
    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: './types' },
        importKind: 'type',
        specifiers: [
          { type: 'ImportSpecifier', imported: { name: 'MyType' }, local: { name: 'MyType' }, importKind: 'value' },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.type).toBe('type-references');
    expect(relations[0]!.metaJson).toContain('"isType":true');
  });

  // 8. [HP] ExportAllDeclaration regression
  it('should produce a re-exports relation with isReExport true when declaration is export star from', () => {
    const ast = fakeAst([
      { type: 'ExportAllDeclaration', source: { value: './barrel' }, exportKind: 'value' },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);
    const rel = relations.find((r) => r.metaJson?.includes('"isReExport":true'));

    expect(rel).toBeDefined();
    expect(rel!.type).toBe('re-exports');
  });

  // 9. [HP] ExportNamedDeclaration regression
  it('should produce a re-exports relation with isReExport true when declaration is named re-export', () => {
    const ast = fakeAst([
      { type: 'ExportNamedDeclaration', source: { value: './local' }, exportKind: 'value', specifiers: [
        { type: 'ExportSpecifier', local: { name: 'X' }, exported: { name: 'X' } },
      ] },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);
    const rel = relations.find((r) => r.metaJson?.includes('"isReExport":true'));

    expect(rel).toBeDefined();
    expect(rel!.type).toBe('re-exports');
  });

  // 10. [HP] dynamic import regression
  it('should produce an imports relation with isDynamic true when declaration is a dynamic import expression', () => {
    mockVisitImpl = () => {
      capturedVisitorCallbacks.ImportExpression?.({ type: 'ImportExpression', source: { type: 'Literal', value: './dynamic' } });
    };

    const ast = fakeAst([]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);
    const rel = relations.find((r) => r.metaJson?.includes('"isDynamic":true'));

    expect(rel).toBeDefined();
  });

  // 11. [NE] candidates empty, bare specifier → external import with null dstFilePath
  it('should return relation with null dstFilePath and specifier when bare specifier cannot be resolved', () => {
    mockResolveImport.mockReturnValue([]);

    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: 'react' },
        importKind: 'value',
        specifiers: [
          { type: 'ImportSpecifier', imported: { name: 'useState' }, local: { name: 'useState' }, importKind: 'value' },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.dstFilePath).toBeNull();
    expect(relations[0]!.specifier).toBe('react');
    expect(relations[0]!.dstSymbolName).toBe('useState');
    const meta = JSON.parse(relations[0]!.metaJson!);
    expect(meta.isExternal).toBe(true);
  });

  // 12. [NE] dynamic import sourceValue null
  it('should return no relation when dynamic import source value cannot be extracted as string literal', () => {
    mockVisitImpl = () => {
      capturedVisitorCallbacks.ImportExpression?.({ type: 'ImportExpression', source: { type: 'Identifier', name: 'dynamicPath' } });
    };

    const ast = fakeAst([]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(0);
  });

  // 13. [ED] empty body
  it('should return empty array when body has no statements', () => {
    const ast = fakeAst([]);
    expect(extractImports(ast, FILE, undefined, mockResolveImport)).toEqual([]);
  });

  // 14. [ED] specifiers=[] → exactly 1 relation (side-effect)
  it('should return exactly 1 relation when ImportDeclaration has empty specifiers array', () => {
    const ast = fakeAst([
      { type: 'ImportDeclaration', source: { value: './side' }, importKind: 'value', specifiers: [] },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
  });

  // 15. [CO] default + named in same declaration
  it('should produce 2 relations with correct dstSymbolNames when import has both default and named specifiers', () => {
    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: './mixed' },
        importKind: 'value',
        specifiers: [
          { type: 'ImportDefaultSpecifier', local: { name: 'Def' } },
          { type: 'ImportSpecifier', imported: { name: 'Named' }, local: { name: 'Named' }, importKind: 'value' },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(2);
    expect(relations[0]!.dstSymbolName).toBe('default');
    expect(relations[1]!.dstSymbolName).toBe('Named');
  });

  // 16. [CO] type-only + alias
  it('should set isType true and correct dstSymbolName when type-only import uses alias specifier', () => {
    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: './types' },
        importKind: 'type',
        specifiers: [
          { type: 'ImportSpecifier', imported: { name: 'OriginalType' }, local: { name: 'Alias' }, importKind: 'value' },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.metaJson).toContain('"isType":true');
    expect(relations[0]!.dstSymbolName).toBe('OriginalType');
    expect(relations[0]!.srcSymbolName).toBe('Alias');
  });

  // 17. [OR] specifier order preserved
  it('should preserve specifier order in output relations when import has multiple specifiers', () => {
    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: './ordered' },
        importKind: 'value',
        specifiers: [
          { type: 'ImportSpecifier', imported: { name: 'First' }, local: { name: 'First' }, importKind: 'value' },
          { type: 'ImportSpecifier', imported: { name: 'Second' }, local: { name: 'Second' }, importKind: 'value' },
          { type: 'ImportSpecifier', imported: { name: 'Third' }, local: { name: 'Third' }, importKind: 'value' },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations[0]!.dstSymbolName).toBe('First');
    expect(relations[1]!.dstSymbolName).toBe('Second');
    expect(relations[2]!.dstSymbolName).toBe('Third');
  });

  // 18. [ID] idempotency
  it('should return identical results when called twice with the same AST', () => {
    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: './stable' },
        importKind: 'value',
        specifiers: [
          { type: 'ImportSpecifier', imported: { name: 'X' }, local: { name: 'X' }, importKind: 'value' },
        ],
      },
    ]);
    const r1 = extractImports(ast, FILE, undefined, mockResolveImport);
    const r2 = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(r1).toEqual(r2);
  });

  // --- IMP-B: re-export named specifier ---

  // 19. [HP] export { A } → specifiers [{local:'A', exported:'A'}]
  it('should include specifiers array in metaJson with local and exported names when re-export has a single named specifier', () => {
    const ast = fakeAst([
      {
        type: 'ExportNamedDeclaration',
        source: { value: './foo' },
        exportKind: 'value',
        specifiers: [
          { type: 'ExportSpecifier', local: { name: 'A' }, exported: { name: 'A' } },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
    const meta = JSON.parse(relations[0]!.metaJson!);
    expect(meta.isReExport).toBe(true);
    expect(meta.specifiers).toEqual([{ local: 'A', exported: 'A' }]);
  });

  // 20. [HP] export { A as B } → specifiers [{local:'A', exported:'B'}]
  it('should record original local name and alias exported name in specifiers when re-export uses alias', () => {
    const ast = fakeAst([
      {
        type: 'ExportNamedDeclaration',
        source: { value: './foo' },
        exportKind: 'value',
        specifiers: [
          { type: 'ExportSpecifier', local: { name: 'A' }, exported: { name: 'B' } },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    const meta = JSON.parse(relations[0]!.metaJson!);
    expect(meta.specifiers).toEqual([{ local: 'A', exported: 'B' }]);
  });

  // 21. [HP] export { A, B, C } → specifiers 3개
  it('should produce one relation per specifier when re-export has multiple named specifiers', () => {
    const ast = fakeAst([
      {
        type: 'ExportNamedDeclaration',
        source: { value: './foo' },
        exportKind: 'value',
        specifiers: [
          { type: 'ExportSpecifier', local: { name: 'A' }, exported: { name: 'A' } },
          { type: 'ExportSpecifier', local: { name: 'B' }, exported: { name: 'B' } },
          { type: 'ExportSpecifier', local: { name: 'C' }, exported: { name: 'C' } },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(3);
    for (const rel of relations) {
      const meta = JSON.parse(rel.metaJson!);
      expect(meta.isReExport).toBe(true);
      expect(meta.specifiers).toHaveLength(1);
    }
  });

  // 22. per-specifier type annotation in mixed re-exports
  it('should classify type-only specifier as type-references and value specifier as re-exports when mixed', () => {
    const ast = fakeAst([
      {
        type: 'ExportNamedDeclaration',
        source: { value: './foo' },
        exportKind: 'value',
        specifiers: [
          { type: 'ExportSpecifier', local: { name: 'X' }, exported: { name: 'X' }, exportKind: 'type' },
          { type: 'ExportSpecifier', local: { name: 'Y' }, exported: { name: 'Y' }, exportKind: 'value' },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(2);
    const typeRel = relations.find((r) => r.type === 'type-references');
    const valueRel = relations.find((r) => r.type === 're-exports');
    expect(typeRel).toBeDefined();
    expect(valueRel).toBeDefined();
    expect(JSON.parse(typeRel!.metaJson!).specifiers[0].local).toBe('X');
    expect(JSON.parse(valueRel!.metaJson!).specifiers[0].local).toBe('Y');
  });

  // 23. [HP] ExportAllDeclaration regression — no specifiers in meta
  it('should not include specifiers key in metaJson when declaration is export star from', () => {
    const ast = fakeAst([
      { type: 'ExportAllDeclaration', source: { value: './barrel' }, exportKind: 'value' },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    const meta = JSON.parse(relations[0]!.metaJson!);
    expect(meta.isReExport).toBe(true);
    expect(meta.specifiers).toBeUndefined();
  });

  // 23b. ExportAllDeclaration with namespace alias — export * as ns from './mod'
  it('should capture namespace alias in dstSymbolName when export star has exported name', () => {
    const ast = fakeAst([
      { type: 'ExportAllDeclaration', source: { value: './barrel' }, exportKind: 'value', exported: { name: 'ns' } },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.dstSymbolName).toBe('ns');
    const meta = JSON.parse(relations[0]!.metaJson!);
    expect(meta.namespaceAlias).toBe('ns');
  });

  it('should set dstSymbolName to null when export star has no namespace alias', () => {
    const ast = fakeAst([
      { type: 'ExportAllDeclaration', source: { value: './barrel' }, exportKind: 'value' },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.dstSymbolName).toBeNull();
  });

  // 24. [NE] ExportNamedDeclaration without source → 0 relations
  it('should produce no relation when ExportNamedDeclaration has no source', () => {
    const ast = fakeAst([
      { type: 'ExportNamedDeclaration', source: undefined, exportKind: 'value', specifiers: [] },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(0);
  });

  // 25. [NE] candidates empty, bare specifier → external re-export with null dstFilePath
  it('should produce re-export relation with null dstFilePath and specifier when re-export source is bare specifier', () => {
    mockResolveImport.mockReturnValue([]);

    const ast = fakeAst([
      {
        type: 'ExportNamedDeclaration',
        source: { value: 'external-pkg' },
        exportKind: 'value',
        specifiers: [
          { type: 'ExportSpecifier', local: { name: 'A' }, exported: { name: 'A' } },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.dstFilePath).toBeNull();
    expect(relations[0]!.specifier).toBe('external-pkg');
    expect(relations[0]!.type).toBe('re-exports');
    const meta = JSON.parse(relations[0]!.metaJson!);
    expect(meta.isExternal).toBe(true);
    expect(meta.isReExport).toBe(true);
  });

  // 26. [CO] export type { T as U } → isType + alias specifier
  it('should include isType true and alias specifier when type re-export uses alias', () => {
    const ast = fakeAst([
      {
        type: 'ExportNamedDeclaration',
        source: { value: './types' },
        exportKind: 'type',
        specifiers: [
          { type: 'ExportSpecifier', local: { name: 'T' }, exported: { name: 'U' } },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
    const meta = JSON.parse(relations[0]!.metaJson!);
    expect(meta.isType).toBe(true);
    expect(meta.isReExport).toBe(true);
    expect(meta.specifiers).toEqual([{ local: 'T', exported: 'U' }]);
  });

  // 27. [ED] export type { T } → isType + single specifier
  it('should include isType true and single specifier when type-only re-export has one specifier', () => {
    const ast = fakeAst([
      {
        type: 'ExportNamedDeclaration',
        source: { value: './types' },
        exportKind: 'type',
        specifiers: [
          { type: 'ExportSpecifier', local: { name: 'MyType' }, exported: { name: 'MyType' } },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    const meta = JSON.parse(relations[0]!.metaJson!);
    expect(meta.isType).toBe(true);
    expect(meta.specifiers).toEqual([{ local: 'MyType', exported: 'MyType' }]);
  });

  // 28. [OR] {A,B,C} order preserved across per-specifier relations
  it('should preserve specifier order across per-specifier relations when re-export has multiple specifiers', () => {
    const ast = fakeAst([
      {
        type: 'ExportNamedDeclaration',
        source: { value: './ordered' },
        exportKind: 'value',
        specifiers: [
          { type: 'ExportSpecifier', local: { name: 'First' }, exported: { name: 'First' } },
          { type: 'ExportSpecifier', local: { name: 'Second' }, exported: { name: 'Second' } },
          { type: 'ExportSpecifier', local: { name: 'Third' }, exported: { name: 'Third' } },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(3);
    expect(JSON.parse(relations[0]!.metaJson!).specifiers[0].local).toBe('First');
    expect(JSON.parse(relations[1]!.metaJson!).specifiers[0].local).toBe('Second');
    expect(JSON.parse(relations[2]!.metaJson!).specifiers[0].local).toBe('Third');
  });

  // 29. [ID] same re-export AST called twice → identical
  it('should return identical results when called twice with the same re-export AST', () => {
    const ast = fakeAst([
      {
        type: 'ExportNamedDeclaration',
        source: { value: './stable' },
        exportKind: 'value',
        specifiers: [
          { type: 'ExportSpecifier', local: { name: 'Stable' }, exported: { name: 'Stable' } },
        ],
      },
    ]);
    const r1 = extractImports(ast, FILE, undefined, mockResolveImport);
    const r2 = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(r1).toEqual(r2);
  });

  // --- IMP-E: type-references relation type ---

  // 30. [HP] import type { Foo } → type: 'type-references'
  it('should produce relation with type type-references when import declaration is statement-level type-only', () => {
    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: './types' },
        importKind: 'type',
        specifiers: [
          { type: 'ImportSpecifier', imported: { name: 'Foo' }, local: { name: 'Foo' }, importKind: 'value' },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.type).toBe('type-references');
    expect(relations[0]!.metaJson).toContain('"isType":true');
  });

  // 31. [HP] import { Foo } → type: 'imports' (regression)
  it('should produce relation with type imports when import declaration is non-type named import', () => {
    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: './bar' },
        importKind: 'value',
        specifiers: [
          { type: 'ImportSpecifier', imported: { name: 'Foo' }, local: { name: 'Foo' }, importKind: 'value' },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations[0]!.type).toBe('imports');
  });

  // 32. [CO] import { type Foo, Bar } → Foo: 'type-references', Bar: 'imports'
  it('should produce type-references for type specifier and imports for value specifier when mixed specifier-level types', () => {
    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: './mixed' },
        importKind: 'value',
        specifiers: [
          { type: 'ImportSpecifier', imported: { name: 'Foo' }, local: { name: 'Foo' }, importKind: 'type' },
          { type: 'ImportSpecifier', imported: { name: 'Bar' }, local: { name: 'Bar' }, importKind: 'value' },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(2);
    expect(relations[0]!.type).toBe('type-references');
    expect(relations[0]!.dstSymbolName).toBe('Foo');
    expect(relations[1]!.type).toBe('imports');
    expect(relations[1]!.dstSymbolName).toBe('Bar');
  });

  // 33. [HP] export type { T } from './foo' → type: 'type-references' + isReExport
  it('should produce type-references relation with isReExport true when re-export is type-only', () => {
    const ast = fakeAst([
      {
        type: 'ExportNamedDeclaration',
        source: { value: './types' },
        exportKind: 'type',
        specifiers: [
          { type: 'ExportSpecifier', local: { name: 'T' }, exported: { name: 'T' } },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.type).toBe('type-references');
    const meta = JSON.parse(relations[0]!.metaJson!);
    expect(meta.isReExport).toBe(true);
    expect(meta.isType).toBe(true);
  });

  // --- EXT: external/unresolved import tracking ---

  // 34. [HP] external default import
  it('should produce relation with null dstFilePath and dstSymbolName default when external default import is used', () => {
    mockResolveImport.mockReturnValue([]);

    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: 'lodash' },
        importKind: 'value',
        specifiers: [
          { type: 'ImportDefaultSpecifier', local: { name: '_' } },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.dstFilePath).toBeNull();
    expect(relations[0]!.specifier).toBe('lodash');
    expect(relations[0]!.dstSymbolName).toBe('default');
    expect(relations[0]!.srcSymbolName).toBe('_');
    const meta = JSON.parse(relations[0]!.metaJson!);
    expect(meta.isExternal).toBe(true);
  });

  // 35. [HP] external namespace import
  it('should produce relation with null dstFilePath and dstSymbolName asterisk when external namespace import is used', () => {
    mockResolveImport.mockReturnValue([]);

    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: 'rxjs' },
        importKind: 'value',
        specifiers: [
          { type: 'ImportNamespaceSpecifier', local: { name: 'Rx' } },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.dstFilePath).toBeNull();
    expect(relations[0]!.specifier).toBe('rxjs');
    expect(relations[0]!.dstSymbolName).toBe('*');
    const meta = JSON.parse(relations[0]!.metaJson!);
    expect(meta.isExternal).toBe(true);
    expect(meta.importKind).toBe('namespace');
  });

  // 36. [HP] unresolved relative import (not external)
  it('should produce relation with isUnresolved true when relative import cannot be resolved', () => {
    mockResolveImport.mockReturnValue([]);

    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: './missing' },
        importKind: 'value',
        specifiers: [
          { type: 'ImportSpecifier', imported: { name: 'Foo' }, local: { name: 'Foo' }, importKind: 'value' },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.dstFilePath).toBeNull();
    expect(relations[0]!.specifier).toBe('./missing');
    const meta = JSON.parse(relations[0]!.metaJson!);
    expect(meta.isUnresolved).toBe(true);
    expect(meta.isExternal).toBeUndefined();
  });

  // 37. [HP] external side-effect import
  it('should produce relation with isExternal true when side-effect import is bare specifier', () => {
    mockResolveImport.mockReturnValue([]);

    const ast = fakeAst([
      { type: 'ImportDeclaration', source: { value: 'reflect-metadata' }, importKind: 'value', specifiers: [] },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.dstFilePath).toBeNull();
    expect(relations[0]!.specifier).toBe('reflect-metadata');
    expect(relations[0]!.srcSymbolName).toBeNull();
    expect(relations[0]!.dstSymbolName).toBeNull();
    const meta = JSON.parse(relations[0]!.metaJson!);
    expect(meta.isExternal).toBe(true);
  });

  // 38. [HP] external export-all
  it('should produce re-exports relation with null dstFilePath when export-all source is bare specifier', () => {
    mockResolveImport.mockReturnValue([]);

    const ast = fakeAst([
      { type: 'ExportAllDeclaration', source: { value: '@org/pkg' }, exportKind: 'value' },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.type).toBe('re-exports');
    expect(relations[0]!.dstFilePath).toBeNull();
    expect(relations[0]!.specifier).toBe('@org/pkg');
    const meta = JSON.parse(relations[0]!.metaJson!);
    expect(meta.isExternal).toBe(true);
    expect(meta.isReExport).toBe(true);
  });

  // 39. [HP] dynamic import with unresolved bare specifier
  it('should produce relation with isDynamic and isExternal when dynamic import is bare specifier', () => {
    mockResolveImport.mockReturnValue([]);
    mockVisitImpl = () => {
      capturedVisitorCallbacks.ImportExpression?.({ type: 'ImportExpression', source: { type: 'Literal', value: 'some-pkg' } });
    };

    const ast = fakeAst([]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.dstFilePath).toBeNull();
    expect(relations[0]!.specifier).toBe('some-pkg');
    const meta = JSON.parse(relations[0]!.metaJson!);
    expect(meta.isDynamic).toBe(true);
    expect(meta.isExternal).toBe(true);
  });

  // 40. [HP] resolved import preserves the verbatim specifier
  it('should preserve the verbatim source specifier when import is resolved to a file path', () => {
    mockResolveImport.mockReturnValue([RESOLVED]);

    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: './bar' },
        importKind: 'value',
        specifiers: [
          { type: 'ImportSpecifier', imported: { name: 'Foo' }, local: { name: 'Foo' }, importKind: 'value' },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.dstFilePath).toBe(RESOLVED);
    expect(relations[0]!.specifier).toBe('./bar');
  });

  // --- REQ: require() and require.resolve() ---

  // 41. [HP] require('lodash') → external import
  it('should produce import relation with isRequire and isExternal when require is used with bare specifier', () => {
    mockResolveImport.mockReturnValue([]);
    mockVisitImpl = () => {
      capturedVisitorCallbacks.CallExpression?.({
        type: 'CallExpression',
        callee: { type: 'Identifier', name: 'require' },
        arguments: [{ type: 'Literal', value: 'lodash' }],
      });
    };

    const ast = fakeAst([]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.dstFilePath).toBeNull();
    expect(relations[0]!.specifier).toBe('lodash');
    const meta = JSON.parse(relations[0]!.metaJson!);
    expect(meta.isRequire).toBe(true);
    expect(meta.isExternal).toBe(true);
  });

  // 42. [HP] require('./local') → resolved import
  it('should produce import relation with isRequire and resolved dstFilePath when require is used with relative path', () => {
    mockResolveImport.mockReturnValue([RESOLVED]);
    mockVisitImpl = () => {
      capturedVisitorCallbacks.CallExpression?.({
        type: 'CallExpression',
        callee: { type: 'Identifier', name: 'require' },
        arguments: [{ type: 'Literal', value: './local' }],
      });
    };

    const ast = fakeAst([]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.dstFilePath).toBe(RESOLVED);
    const meta = JSON.parse(relations[0]!.metaJson!);
    expect(meta.isRequire).toBe(true);
    expect(meta.isExternal).toBeUndefined();
  });

  // 43. [HP] require.resolve('path') → external import with isRequireResolve
  it('should produce import relation with isRequireResolve when require.resolve is used', () => {
    mockResolveImport.mockReturnValue([]);
    mockVisitImpl = () => {
      capturedVisitorCallbacks.CallExpression?.({
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          computed: false,
          object: { type: 'Identifier', name: 'require' },
          property: { type: 'Identifier', name: 'resolve' },
        },
        arguments: [{ type: 'Literal', value: 'path' }],
      });
    };

    const ast = fakeAst([]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.dstFilePath).toBeNull();
    expect(relations[0]!.specifier).toBe('path');
    const meta = JSON.parse(relations[0]!.metaJson!);
    expect(meta.isRequire).toBe(true);
    expect(meta.isRequireResolve).toBe(true);
    expect(meta.isExternal).toBe(true);
  });

  // 44. [NE] require with non-string arg → no relation
  it('should produce no relation when require has non-string argument', () => {
    mockResolveImport.mockReturnValue([]);
    mockVisitImpl = () => {
      capturedVisitorCallbacks.CallExpression?.({
        type: 'CallExpression',
        callee: { type: 'Identifier', name: 'require' },
        arguments: [{ type: 'Identifier', name: 'dynamicPath' }],
      });
    };

    const ast = fakeAst([]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(0);
  });

  // 45. [HP] type-only external import
  it('should produce type-references relation with isExternal true when type-only import is bare specifier', () => {
    mockResolveImport.mockReturnValue([]);

    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: '@types/node' },
        importKind: 'type',
        specifiers: [
          { type: 'ImportSpecifier', imported: { name: 'Buffer' }, local: { name: 'Buffer' }, importKind: 'value' },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.type).toBe('type-references');
    expect(relations[0]!.dstFilePath).toBeNull();
    expect(relations[0]!.specifier).toBe('@types/node');
    const meta = JSON.parse(relations[0]!.metaJson!);
    expect(meta.isType).toBe(true);
    expect(meta.isExternal).toBe(true);
  });

  // 46. [HP] multiple external named imports → one relation per specifier
  it('should produce one relation per specifier when external import has multiple named specifiers', () => {
    mockResolveImport.mockReturnValue([]);

    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: 'react' },
        importKind: 'value',
        specifiers: [
          { type: 'ImportSpecifier', imported: { name: 'useState' }, local: { name: 'useState' }, importKind: 'value' },
          { type: 'ImportSpecifier', imported: { name: 'useEffect' }, local: { name: 'useEffect' }, importKind: 'value' },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(2);
    expect(relations[0]!.dstSymbolName).toBe('useState');
    expect(relations[0]!.specifier).toBe('react');
    expect(relations[1]!.dstSymbolName).toBe('useEffect');
    expect(relations[1]!.specifier).toBe('react');
  });

  // --- Re-export pattern B/C tests (module.staticExports cross-reference) ---

  // 47. [HP] pattern B: import { X } from './other'; export { X }
  it('should produce re-exports relation for pattern B: import then export same name', () => {
    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: './other' },
        importKind: 'value',
        specifiers: [
          { type: 'ImportSpecifier', imported: { name: 'X' }, local: { name: 'X' }, importKind: 'value' },
        ],
      },
      // ExportNamedDeclaration without source (pattern B — no re-export in body loop)
      { type: 'ExportNamedDeclaration', source: undefined, exportKind: 'value', specifiers: [] },
    ]);

    const module = {
      hasModuleSyntax: true,
      staticImports: [{
        start: 0, end: 30,
        moduleRequest: { value: './other', start: 20, end: 29 },
        entries: [{ importName: { kind: 'Name', name: 'X', start: 9, end: 10 }, localName: { value: 'X', start: 9, end: 10 }, isType: false }],
      }],
      staticExports: [{
        start: 31, end: 50,
        entries: [{
          start: 40, end: 41,
          moduleRequest: { value: './other', start: 20, end: 29 },
          importName: { kind: 'Name', name: 'X', start: 9, end: 10 },
          exportName: { kind: 'Name', name: 'X', start: 40, end: 41 },
          localName: { kind: 'Name', name: 'X', start: 40, end: 41 },
          isType: false,
        }],
      }],
      dynamicImports: [],
      importMetas: [],
    };

    const relations = extractImports(ast, FILE, undefined, mockResolveImport, module as any);

    const reExports = relations.filter((r) => r.type === 're-exports');
    expect(reExports).toHaveLength(1);
    expect(reExports[0]!.dstFilePath).toBe(RESOLVED);
    const meta = JSON.parse(reExports[0]!.metaJson!);
    expect(meta.isReExport).toBe(true);
    expect(meta.specifiers).toEqual([{ local: 'X', exported: 'X' }]);
  });

  // 48. [HP] pattern C: import X from './other'; export default X
  it('should produce re-exports relation for pattern C: import default then export default', () => {
    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: './other' },
        importKind: 'value',
        specifiers: [
          { type: 'ImportDefaultSpecifier', local: { name: 'X' } },
        ],
      },
      // ExportDefaultDeclaration — not handled in the body loop as re-export
    ]);

    const module = {
      hasModuleSyntax: true,
      staticImports: [{
        start: 0, end: 30,
        moduleRequest: { value: './other', start: 20, end: 29 },
        entries: [{ importName: { kind: 'Default', name: 'default', start: 7, end: 8 }, localName: { value: 'X', start: 7, end: 8 }, isType: false }],
      }],
      staticExports: [{
        start: 31, end: 55,
        entries: [{
          start: 46, end: 47,
          moduleRequest: null,
          importName: { kind: 'Name', name: 'X', start: 46, end: 47 },
          exportName: { kind: 'Default', name: 'default', start: 38, end: 45 },
          localName: { kind: 'Name', name: 'X', start: 46, end: 47 },
          isType: false,
        }],
      }],
      dynamicImports: [],
      importMetas: [],
    };

    const relations = extractImports(ast, FILE, undefined, mockResolveImport, module as any);

    const reExports = relations.filter((r) => r.type === 're-exports');
    expect(reExports).toHaveLength(1);
    expect(reExports[0]!.dstFilePath).toBe(RESOLVED);
    const meta = JSON.parse(reExports[0]!.metaJson!);
    expect(meta.isReExport).toBe(true);
    expect(meta.specifiers).toEqual([{ local: 'X', exported: 'default' }]);
  });

  // 49. [NE] no duplicate re-export when pattern A already detected same source
  it('should not duplicate re-export when pattern A already detected same source', () => {
    // Pattern A: export { X } from './other' — handled in body loop
    const ast = fakeAst([
      {
        type: 'ExportNamedDeclaration',
        source: { value: './other' },
        exportKind: 'value',
        specifiers: [
          { type: 'ExportSpecifier', local: { name: 'X' }, exported: { name: 'X' } },
        ],
      },
    ]);

    // Module also reports this same re-export via staticExports
    const module = {
      hasModuleSyntax: true,
      staticImports: [],
      staticExports: [{
        start: 0, end: 30,
        entries: [{
          start: 9, end: 10,
          moduleRequest: { value: './other', start: 20, end: 29 },
          importName: { kind: 'Name', name: 'X', start: 9, end: 10 },
          exportName: { kind: 'Name', name: 'X', start: 9, end: 10 },
          localName: { kind: 'Name', name: 'X', start: 9, end: 10 },
          isType: false,
        }],
      }],
      dynamicImports: [],
      importMetas: [],
    };

    const relations = extractImports(ast, FILE, undefined, mockResolveImport, module as any);

    const reExports = relations.filter((r) => r.type === 're-exports');
    // Should be exactly 1 (from pattern A body loop), not 2
    expect(reExports).toHaveLength(1);
  });

  // 50. [HP] pattern B with alias: import { X } from './other'; export { X as Y }
  it('should handle pattern B with alias: exported name is Y and local name is X', () => {
    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: './other' },
        importKind: 'value',
        specifiers: [
          { type: 'ImportSpecifier', imported: { name: 'X' }, local: { name: 'X' }, importKind: 'value' },
        ],
      },
      { type: 'ExportNamedDeclaration', source: undefined, exportKind: 'value', specifiers: [] },
    ]);

    const module = {
      hasModuleSyntax: true,
      staticImports: [{
        start: 0, end: 30,
        moduleRequest: { value: './other', start: 20, end: 29 },
        entries: [{ importName: { kind: 'Name', name: 'X', start: 9, end: 10 }, localName: { value: 'X', start: 9, end: 10 }, isType: false }],
      }],
      staticExports: [{
        start: 31, end: 55,
        entries: [{
          start: 40, end: 41,
          moduleRequest: { value: './other', start: 20, end: 29 },
          importName: { kind: 'Name', name: 'X', start: 9, end: 10 },
          exportName: { kind: 'Name', name: 'Y', start: 40, end: 41 },
          localName: { kind: 'Name', name: 'X', start: 40, end: 41 },
          isType: false,
        }],
      }],
      dynamicImports: [],
      importMetas: [],
    };

    const relations = extractImports(ast, FILE, undefined, mockResolveImport, module as any);

    const reExports = relations.filter((r) => r.type === 're-exports');
    expect(reExports).toHaveLength(1);
    const meta = JSON.parse(reExports[0]!.metaJson!);
    expect(meta.specifiers).toEqual([{ local: 'X', exported: 'Y' }]);
  });

  // ── Edge case tests using real parseSource ──────────────────────────────

  // EC-1. scoped package → external import with specifier
  it('should produce external import with specifier for scoped package @scope/pkg', () => {
    mockResolveImport.mockReturnValue([]);

    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: '@scope/pkg' },
        importKind: 'value',
        specifiers: [
          { type: 'ImportSpecifier', imported: { name: 'X' }, local: { name: 'X' }, importKind: 'value' },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.dstFilePath).toBeNull();
    expect(relations[0]!.specifier).toBe('@scope/pkg');
    const meta = JSON.parse(relations[0]!.metaJson!);
    expect(meta.isExternal).toBe(true);
  });

  // EC-2. node: protocol → external import
  it('should produce external import with specifier for node: protocol', () => {
    mockResolveImport.mockReturnValue([]);

    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: 'node:fs' },
        importKind: 'value',
        specifiers: [
          { type: 'ImportDefaultSpecifier', local: { name: 'fs' } },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.dstFilePath).toBeNull();
    expect(relations[0]!.specifier).toBe('node:fs');
    const meta = JSON.parse(relations[0]!.metaJson!);
    expect(meta.isExternal).toBe(true);
  });

  // EC-3. import type + export type pattern → type-references import + type-references re-export
  it('should produce type re-export for import type + export type pattern', () => {
    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: './other' },
        importKind: 'type',
        specifiers: [
          { type: 'ImportSpecifier', imported: { name: 'X' }, local: { name: 'X' }, importKind: 'value' },
        ],
      },
      // ExportNamedDeclaration without source (pattern B)
      { type: 'ExportNamedDeclaration', source: undefined, exportKind: 'type', specifiers: [] },
    ]);

    const module = {
      hasModuleSyntax: true,
      staticImports: [{
        start: 0, end: 35,
        moduleRequest: { value: './other', start: 20, end: 29 },
        entries: [{ importName: { kind: 'Name', name: 'X', start: 14, end: 15 }, localName: { value: 'X', start: 14, end: 15 }, isType: true }],
      }],
      staticExports: [{
        start: 36, end: 60,
        entries: [{
          start: 50, end: 51,
          moduleRequest: { value: './other', start: 20, end: 29 },
          importName: { kind: 'Name', name: 'X', start: 14, end: 15 },
          exportName: { kind: 'Name', name: 'X', start: 50, end: 51 },
          localName: { kind: 'Name', name: 'X', start: 50, end: 51 },
          isType: true,
        }],
      }],
      dynamicImports: [],
      importMetas: [],
    };

    const relations = extractImports(ast, FILE, undefined, mockResolveImport, module as any);

    // Should have at least the import (type-references) and the re-export (type-references)
    const typeRefs = relations.filter((r) => r.type === 'type-references');
    expect(typeRefs.length).toBeGreaterThanOrEqual(1);

    const reExports = relations.filter((r) => r.type === 're-exports' || (r.type === 'type-references' && JSON.parse(r.metaJson!).isReExport));
    expect(reExports.length).toBeGreaterThanOrEqual(1);
    const reExportMeta = JSON.parse(reExports[0]!.metaJson!);
    expect(reExportMeta.isReExport).toBe(true);
  });

  // EC-4. namespace import + export default → imports + re-exports
  it('should produce re-export for namespace import + export default', () => {
    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: './other' },
        importKind: 'value',
        specifiers: [
          { type: 'ImportNamespaceSpecifier', local: { name: 'ns' } },
        ],
      },
    ]);

    const module = {
      hasModuleSyntax: true,
      staticImports: [{
        start: 0, end: 30,
        moduleRequest: { value: './other', start: 20, end: 29 },
        entries: [{ importName: { kind: 'NamespaceObject', name: '*', start: 7, end: 8 }, localName: { value: 'ns', start: 12, end: 14 }, isType: false }],
      }],
      staticExports: [{
        start: 31, end: 55,
        entries: [{
          start: 46, end: 48,
          moduleRequest: null,
          importName: { kind: 'Name', name: 'ns', start: 46, end: 48 },
          exportName: { kind: 'Default', name: 'default', start: 38, end: 45 },
          localName: { kind: 'Name', name: 'ns', start: 46, end: 48 },
          isType: false,
        }],
      }],
      dynamicImports: [],
      importMetas: [],
    };

    const relations = extractImports(ast, FILE, undefined, mockResolveImport, module as any);

    // Should have the namespace import
    const imports = relations.filter((r) => r.type === 'imports');
    expect(imports.length).toBeGreaterThanOrEqual(1);
    expect(imports[0]!.dstSymbolName).toBe('*');

    // Should have a re-export
    const reExports = relations.filter((r) => r.type === 're-exports');
    expect(reExports.length).toBeGreaterThanOrEqual(1);
    const meta = JSON.parse(reExports[0]!.metaJson!);
    expect(meta.isReExport).toBe(true);
  });

  // EC-5. require with template literal → no relation
  it('should not produce relation for require with template literal', () => {
    mockResolveImport.mockReturnValue([]);
    mockVisitImpl = () => {
      capturedVisitorCallbacks.CallExpression?.({
        type: 'CallExpression',
        callee: { type: 'Identifier', name: 'require' },
        arguments: [{ type: 'TemplateLiteral', expressions: [], quasis: [{ type: 'TemplateElement', value: { raw: 'pkg', cooked: 'pkg' } }] }],
      });
    };

    const ast = fakeAst([]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(0);
  });

  // EC-6. require inside function body → 1 relation with isRequire
  it('should produce relation for require inside function body', () => {
    mockResolveImport.mockReturnValue([]);
    mockVisitImpl = () => {
      // The Visitor pattern walks all CallExpressions regardless of scope
      capturedVisitorCallbacks.CallExpression?.({
        type: 'CallExpression',
        callee: { type: 'Identifier', name: 'require' },
        arguments: [{ type: 'Literal', value: 'pkg' }],
      });
    };

    const ast = fakeAst([]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
    const meta = JSON.parse(relations[0]!.metaJson!);
    expect(meta.isRequire).toBe(true);
  });

  // 51. [HP] mixed imports where only some are re-exported
  it('should handle mixed imports where only some are re-exported', () => {
    const ast = fakeAst([
      {
        type: 'ImportDeclaration',
        source: { value: './other' },
        importKind: 'value',
        specifiers: [
          { type: 'ImportSpecifier', imported: { name: 'A' }, local: { name: 'A' }, importKind: 'value' },
          { type: 'ImportSpecifier', imported: { name: 'B' }, local: { name: 'B' }, importKind: 'value' },
        ],
      },
      { type: 'ExportNamedDeclaration', source: undefined, exportKind: 'value', specifiers: [] },
    ]);

    const module = {
      hasModuleSyntax: true,
      staticImports: [{
        start: 0, end: 35,
        moduleRequest: { value: './other', start: 25, end: 34 },
        entries: [
          { importName: { kind: 'Name', name: 'A', start: 9, end: 10 }, localName: { value: 'A', start: 9, end: 10 }, isType: false },
          { importName: { kind: 'Name', name: 'B', start: 12, end: 13 }, localName: { value: 'B', start: 12, end: 13 }, isType: false },
        ],
      }],
      staticExports: [{
        start: 36, end: 55,
        // Only A is re-exported
        entries: [{
          start: 45, end: 46,
          moduleRequest: { value: './other', start: 25, end: 34 },
          importName: { kind: 'Name', name: 'A', start: 9, end: 10 },
          exportName: { kind: 'Name', name: 'A', start: 45, end: 46 },
          localName: { kind: 'Name', name: 'A', start: 45, end: 46 },
          isType: false,
        }],
      }],
      dynamicImports: [],
      importMetas: [],
    };

    const relations = extractImports(ast, FILE, undefined, mockResolveImport, module as any);

    const reExports = relations.filter((r) => r.type === 're-exports');
    // Only A should get re-export relation, B should not
    expect(reExports).toHaveLength(1);
    const meta = JSON.parse(reExports[0]!.metaJson!);
    expect(meta.specifiers).toEqual([{ local: 'A', exported: 'A' }]);

    // B should only appear as an import, not re-export
    const imports = relations.filter((r) => r.type === 'imports');
    expect(imports.some((r) => r.dstSymbolName === 'B')).toBe(true);
  });

  // 52. module path: side-effect import (empty entries)
  it('should produce imports relation for side-effect import via module.staticImports', () => {
    mockResolveImport.mockReturnValue(['/resolved/side.ts']);
    const ast = fakeAst([]);

    const module = {
      hasModuleSyntax: true,
      staticImports: [{
        start: 0, end: 20,
        moduleRequest: { value: './side', start: 7, end: 15 },
        entries: [],
      }],
      staticExports: [],
      dynamicImports: [],
      importMetas: [],
    };

    const relations = extractImports(ast, FILE, undefined, mockResolveImport, module as any);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.type).toBe('imports');
    expect(relations[0]!.dstFilePath).toBe('/resolved/side.ts');
    expect(relations[0]!.srcSymbolName).toBeNull();
    expect(relations[0]!.dstSymbolName).toBeNull();
  });

  // 53. module path: export * as ns from (namespace alias via staticExports)
  it('should capture namespace alias for export star as via module.staticExports', () => {
    mockResolveImport.mockReturnValue(['/resolved/utils.ts']);
    const ast = fakeAst([]);

    const module = {
      hasModuleSyntax: true,
      staticImports: [],
      staticExports: [{
        start: 0, end: 30,
        entries: [{
          start: 0, end: 30,
          moduleRequest: { value: './utils', start: 20, end: 29 },
          importName: { kind: 'All', name: null, start: null, end: null },
          exportName: { kind: 'Name', name: 'ns', start: 12, end: 14 },
          localName: { kind: 'None', name: null, start: null, end: null },
          isType: false,
        }],
      }],
      dynamicImports: [],
      importMetas: [],
    };

    const relations = extractImports(ast, FILE, undefined, mockResolveImport, module as any);

    const reExports = relations.filter((r) => r.type === 're-exports');
    expect(reExports).toHaveLength(1);
    expect(reExports[0]!.dstSymbolName).toBe('ns');
    const meta = JSON.parse(reExports[0]!.metaJson!);
    expect(meta.namespaceAlias).toBe('ns');
    expect(meta.isReExport).toBe(true);
  });

  // --- MODULE-based path: comprehensive coverage ---

  // 54. external import via module path
  it('should produce import with isExternal in metaJson when module.staticImports has bare specifier', () => {
    mockResolveImport.mockReturnValue([]);
    const ast = fakeAst([]);

    const module = {
      hasModuleSyntax: true,
      staticImports: [{
        start: 0, end: 30,
        moduleRequest: { value: 'lodash', start: 7, end: 15 },
        entries: [{
          importName: { kind: 'Name', name: 'get', start: 9, end: 12 },
          localName: { value: 'get', start: 9, end: 12 },
          isType: false,
        }],
      }],
      staticExports: [],
      dynamicImports: [],
      importMetas: [],
    };

    const relations = extractImports(ast, FILE, undefined, mockResolveImport, module as any);

    const imports = relations.filter((r) => r.type === 'imports');
    expect(imports).toHaveLength(1);
    expect(imports[0]!.dstFilePath).toBeNull();
    expect(imports[0]!.specifier).toBe('lodash');
    expect(imports[0]!.dstSymbolName).toBe('get');
    const meta = JSON.parse(imports[0]!.metaJson!);
    expect(meta.isExternal).toBe(true);
    expect(meta.isUnresolved).toBeUndefined();
  });

  // 55. unresolved relative import via module path
  it('should produce import with isUnresolved in metaJson when module.staticImports has unresolved relative path', () => {
    mockResolveImport.mockReturnValue([]);
    const ast = fakeAst([]);

    const module = {
      hasModuleSyntax: true,
      staticImports: [{
        start: 0, end: 30,
        moduleRequest: { value: './missing', start: 7, end: 18 },
        entries: [{
          importName: { kind: 'Name', name: 'Foo', start: 9, end: 12 },
          localName: { value: 'Foo', start: 9, end: 12 },
          isType: false,
        }],
      }],
      staticExports: [],
      dynamicImports: [],
      importMetas: [],
    };

    const relations = extractImports(ast, FILE, undefined, mockResolveImport, module as any);

    const imports = relations.filter((r) => r.type === 'imports');
    expect(imports).toHaveLength(1);
    expect(imports[0]!.dstFilePath).toBeNull();
    expect(imports[0]!.specifier).toBe('./missing');
    const meta = JSON.parse(imports[0]!.metaJson!);
    expect(meta.isUnresolved).toBe(true);
    expect(meta.isExternal).toBeUndefined();
  });

  // 56. plain export * from via module path — no specifiers in metaJson
  it('should produce re-export with no specifiers in metaJson when module.staticExports is export star from', () => {
    const ast = fakeAst([]);

    const module = {
      hasModuleSyntax: true,
      staticImports: [],
      staticExports: [{
        start: 0, end: 30,
        entries: [{
          start: 0, end: 30,
          moduleRequest: { value: './barrel', start: 15, end: 25 },
          importName: { kind: 'All', name: null, start: null, end: null },
          exportName: { kind: 'None', name: null, start: null, end: null },
          localName: { kind: 'None', name: null, start: null, end: null },
          isType: false,
        }],
      }],
      dynamicImports: [],
      importMetas: [],
    };

    const relations = extractImports(ast, FILE, undefined, mockResolveImport, module as any);

    const reExports = relations.filter((r) => r.type === 're-exports');
    expect(reExports).toHaveLength(1);
    expect(reExports[0]!.dstSymbolName).toBeNull();
    const meta = JSON.parse(reExports[0]!.metaJson!);
    expect(meta.isReExport).toBe(true);
    expect(meta.specifiers).toBeUndefined();
  });

  // 57. per-specifier type in mixed export via module path
  it('should produce separate relations with correct types when module.staticExports has mixed type and value entries', () => {
    // Use different moduleRequests to avoid the existingReExports deduplication
    (mockResolveImport as any).mockImplementation((_file: string, importPath: string) => {
      if (importPath === './types-mod') return ['/resolved/types-mod.ts'];
      if (importPath === './value-mod') return ['/resolved/value-mod.ts'];
      return [RESOLVED];
    });
    const ast = fakeAst([]);

    const module = {
      hasModuleSyntax: true,
      staticImports: [],
      staticExports: [{
        start: 0, end: 60,
        entries: [
          {
            start: 0, end: 30,
            moduleRequest: { value: './types-mod', start: 20, end: 33 },
            importName: { kind: 'Name', name: 'T', start: 9, end: 10 },
            exportName: { kind: 'Name', name: 'T', start: 9, end: 10 },
            localName: { kind: 'Name', name: 'T', start: 9, end: 10 },
            isType: true,
          },
          {
            start: 31, end: 60,
            moduleRequest: { value: './value-mod', start: 50, end: 63 },
            importName: { kind: 'Name', name: 'V', start: 40, end: 41 },
            exportName: { kind: 'Name', name: 'V', start: 40, end: 41 },
            localName: { kind: 'Name', name: 'V', start: 40, end: 41 },
            isType: false,
          },
        ],
      }],
      dynamicImports: [],
      importMetas: [],
    };

    const relations = extractImports(ast, FILE, undefined, mockResolveImport, module as any);

    const reExports = relations.filter((r) => r.metaJson?.includes('"isReExport":true'));
    expect(reExports).toHaveLength(2);

    const typeRel = reExports.find((r) => r.type === 'type-references');
    const valueRel = reExports.find((r) => r.type === 're-exports');
    expect(typeRel).toBeDefined();
    expect(valueRel).toBeDefined();
    const typeMeta = JSON.parse(typeRel!.metaJson!);
    expect(typeMeta.isType).toBe(true);
    expect(typeMeta.specifiers[0].local).toBe('T');
    const valueMeta = JSON.parse(valueRel!.metaJson!);
    expect(valueMeta.isType).toBeUndefined();
    expect(valueMeta.specifiers[0].local).toBe('V');
  });

  // 58. export entry with no sourcePath (skip branch)
  it('should produce 0 re-export relations when module.staticExports entry has no moduleRequest and localName not in imports', () => {
    const ast = fakeAst([]);

    const module = {
      hasModuleSyntax: true,
      staticImports: [],
      staticExports: [{
        start: 0, end: 30,
        entries: [{
          start: 0, end: 30,
          moduleRequest: null,
          importName: { kind: 'Name', name: 'localOnly', start: 9, end: 18 },
          exportName: { kind: 'Name', name: 'localOnly', start: 9, end: 18 },
          localName: { kind: 'Name', name: 'localOnly', start: 9, end: 18 },
          isType: false,
        }],
      }],
      dynamicImports: [],
      importMetas: [],
    };

    const relations = extractImports(ast, FILE, undefined, mockResolveImport, module as any);

    const reExports = relations.filter((r) => r.metaJson?.includes('"isReExport":true'));
    expect(reExports).toHaveLength(0);
  });

  // 59. external re-export via module path
  it('should produce re-export with isExternal in metaJson when module.staticExports has bare specifier moduleRequest', () => {
    mockResolveImport.mockReturnValue([]);
    const ast = fakeAst([]);

    const module = {
      hasModuleSyntax: true,
      staticImports: [],
      staticExports: [{
        start: 0, end: 40,
        entries: [{
          start: 0, end: 40,
          moduleRequest: { value: 'external-lib', start: 20, end: 34 },
          importName: { kind: 'Name', name: 'Widget', start: 9, end: 15 },
          exportName: { kind: 'Name', name: 'Widget', start: 9, end: 15 },
          localName: { kind: 'Name', name: 'Widget', start: 9, end: 15 },
          isType: false,
        }],
      }],
      dynamicImports: [],
      importMetas: [],
    };

    const relations = extractImports(ast, FILE, undefined, mockResolveImport, module as any);

    const reExports = relations.filter((r) => r.metaJson?.includes('"isReExport":true'));
    expect(reExports).toHaveLength(1);
    expect(reExports[0]!.dstFilePath).toBeNull();
    expect(reExports[0]!.specifier).toBe('external-lib');
    const meta = JSON.parse(reExports[0]!.metaJson!);
    expect(meta.isExternal).toBe(true);
    expect(meta.isReExport).toBe(true);
  });

  // 60. multiple specifiers from same module via module path — no data loss
  it('should produce relations for all specifiers when module.staticExports has multiple entries from same module', () => {
    const ast = fakeAst([]);

    const module = {
      hasModuleSyntax: true,
      staticImports: [],
      staticExports: [{
        start: 0, end: 50,
        entries: [
          {
            start: 0, end: 15,
            moduleRequest: { value: './mod', start: 30, end: 37 },
            importName: { kind: 'Name', name: 'A', start: 9, end: 10 },
            exportName: { kind: 'Name', name: 'A', start: 9, end: 10 },
            localName: { kind: 'None', name: null, start: null, end: null },
            isType: false,
          },
          {
            start: 16, end: 30,
            moduleRequest: { value: './mod', start: 30, end: 37 },
            importName: { kind: 'Name', name: 'B', start: 12, end: 13 },
            exportName: { kind: 'Name', name: 'B', start: 12, end: 13 },
            localName: { kind: 'None', name: null, start: null, end: null },
            isType: false,
          },
          {
            start: 31, end: 45,
            moduleRequest: { value: './mod', start: 30, end: 37 },
            importName: { kind: 'Name', name: 'C', start: 15, end: 16 },
            exportName: { kind: 'Name', name: 'C', start: 15, end: 16 },
            localName: { kind: 'None', name: null, start: null, end: null },
            isType: false,
          },
        ],
      }],
      dynamicImports: [],
      importMetas: [],
    };

    const relations = extractImports(ast, FILE, undefined, mockResolveImport, module as any);

    const reExports = relations.filter((r) => r.metaJson?.includes('"isReExport":true'));
    // All 3 specifiers should produce relations, not just the first one
    expect(reExports).toHaveLength(3);
    const names = reExports.map((r) => JSON.parse(r.metaJson!).specifiers[0].local);
    expect(names).toEqual(['A', 'B', 'C']);
  });

  // 61. real oxc-parser integration test
  it('should produce correct relations when using real parseSync output with various import/export patterns', () => {
    // Use real oxc-parser parseSync (not mocked — mock.module only mocks Visitor)
    const { parseSync } = require('oxc-parser') as { parseSync: (filename: string, source: string, options?: any) => any };

    const source = [
      "import { X } from './other';",
      "import type { T } from './types';",
      "export * from './barrel';",
      "export { Y as Z } from './reexport';",
    ].join('\n');

    const result = parseSync('test.ts', source);
    const ast = result.program;
    const mod = result.module;

    // Use a custom resolver that returns predictable paths
    const testResolver = ((_file: string, importPath: string) => {
      if (importPath === './other') return ['/project/src/other.ts'];
      if (importPath === './types') return ['/project/src/types.ts'];
      if (importPath === './barrel') return ['/project/src/barrel.ts'];
      if (importPath === './reexport') return ['/project/src/reexport.ts'];
      return [];
    }) as any;

    const relations = extractImports(ast, '/project/src/test.ts', undefined, testResolver, mod);

    // import { X } from './other'
    const importX = relations.find((r) => r.type === 'imports' && r.dstSymbolName === 'X');
    expect(importX).toBeDefined();
    expect(importX!.dstFilePath).toBe('/project/src/other.ts');
    expect(importX!.srcSymbolName).toBe('X');

    // import type { T } from './types'
    const importT = relations.find((r) => r.type === 'type-references' && r.dstSymbolName === 'T');
    expect(importT).toBeDefined();
    expect(importT!.dstFilePath).toBe('/project/src/types.ts');
    const importTMeta = JSON.parse(importT!.metaJson!);
    expect(importTMeta.isType).toBe(true);

    // export * from './barrel'
    const barrelReExport = relations.find(
      (r) => r.dstFilePath === '/project/src/barrel.ts' && r.metaJson?.includes('"isReExport":true'),
    );
    expect(barrelReExport).toBeDefined();
    expect(barrelReExport!.type).toBe('re-exports');
    expect(barrelReExport!.dstSymbolName).toBeNull();
    const barrelMeta = JSON.parse(barrelReExport!.metaJson!);
    expect(barrelMeta.specifiers).toBeUndefined();

    // export { Y as Z } from './reexport'
    const namedReExport = relations.find(
      (r) => r.dstFilePath === '/project/src/reexport.ts' && r.metaJson?.includes('"isReExport":true'),
    );
    expect(namedReExport).toBeDefined();
    expect(namedReExport!.type).toBe('re-exports');
    const namedMeta = JSON.parse(namedReExport!.metaJson!);
    expect(namedMeta.specifiers).toEqual([{ local: 'Y', exported: 'Z' }]);
  });

  describe('specifier preservation (verbatim source specifier)', () => {
    it('should preserve the verbatim relative specifier when an import is resolved to a local file', () => {
      mockResolveImport.mockReturnValue([RESOLVED]);
      const ast = fakeAst([{
        type: 'ImportDeclaration',
        source: { value: './local' },
        importKind: 'value',
        specifiers: [{ type: 'ImportSpecifier', imported: { name: 'X' }, local: { name: 'X' }, importKind: 'value' }],
      }]);
      const relations = extractImports(ast, FILE, undefined, mockResolveImport);
      expect(relations).toHaveLength(1);
      expect(relations[0]!.dstFilePath).toBe(RESOLVED);
      expect(relations[0]!.specifier).toBe('./local');
    });

    it('should preserve the verbatim alias specifier when resolver returns an absolute path', () => {
      mockResolveImport.mockReturnValue(['/abs/src/foo.ts']);
      const ast = fakeAst([{
        type: 'ImportDeclaration',
        source: { value: '@app/foo' },
        importKind: 'value',
        specifiers: [{ type: 'ImportSpecifier', imported: { name: 'Foo' }, local: { name: 'Foo' }, importKind: 'value' }],
      }]);
      const relations = extractImports(ast, FILE, undefined, mockResolveImport);
      expect(relations).toHaveLength(1);
      expect(relations[0]!.dstFilePath).toBe('/abs/src/foo.ts');
      expect(relations[0]!.specifier).toBe('@app/foo');
    });

    it('should preserve the verbatim specifier when import is a side-effect-only statement', () => {
      mockResolveImport.mockReturnValue([RESOLVED]);
      const ast = fakeAst([{
        type: 'ImportDeclaration',
        source: { value: './side-effect' },
        importKind: 'value',
        specifiers: [],
      }]);
      const relations = extractImports(ast, FILE, undefined, mockResolveImport);
      expect(relations).toHaveLength(1);
      expect(relations[0]!.specifier).toBe('./side-effect');
      expect(relations[0]!.srcSymbolName).toBeNull();
      expect(relations[0]!.dstSymbolName).toBeNull();
    });

    it('should preserve the verbatim specifier when re-export with `from` is resolved', () => {
      mockResolveImport.mockReturnValue([RESOLVED]);
      const ast = fakeAst([{
        type: 'ExportNamedDeclaration',
        source: { value: './reexport' },
        exportKind: 'value',
        specifiers: [{ type: 'ExportSpecifier', local: { name: 'a' }, exported: { name: 'b' }, exportKind: 'value' }],
      }]);
      const relations = extractImports(ast, FILE, undefined, mockResolveImport);
      expect(relations).toHaveLength(1);
      const reExport = relations[0]!;
      expect(reExport.type).toBe('re-exports');
      expect(reExport.dstFilePath).toBe(RESOLVED);
      expect(reExport.specifier).toBe('./reexport');
    });

    it('should preserve the verbatim specifier when export-all is resolved', () => {
      mockResolveImport.mockReturnValue([RESOLVED]);
      const ast = fakeAst([{
        type: 'ExportAllDeclaration',
        source: { value: './all-of-them' },
        exportKind: 'value',
        exported: null,
      }]);
      const relations = extractImports(ast, FILE, undefined, mockResolveImport);
      expect(relations).toHaveLength(1);
      const reExport = relations[0]!;
      expect(reExport.type).toBe('re-exports');
      expect(reExport.dstFilePath).toBe(RESOLVED);
      expect(reExport.specifier).toBe('./all-of-them');
    });

    it('should preserve the verbatim specifier when type-only import is resolved', () => {
      mockResolveImport.mockReturnValue([RESOLVED]);
      const ast = fakeAst([{
        type: 'ImportDeclaration',
        source: { value: './types' },
        importKind: 'type',
        specifiers: [{ type: 'ImportSpecifier', imported: { name: 'T' }, local: { name: 'T' }, importKind: 'type' }],
      }]);
      const relations = extractImports(ast, FILE, undefined, mockResolveImport);
      expect(relations).toHaveLength(1);
      expect(relations[0]!.type).toBe('type-references');
      expect(relations[0]!.dstFilePath).toBe(RESOLVED);
      expect(relations[0]!.specifier).toBe('./types');
    });

    it('should preserve the verbatim specifier when dynamic import() is resolved', () => {
      mockResolveImport.mockReturnValue([RESOLVED]);
      mockVisitImpl = () => {
        capturedVisitorCallbacks.ImportExpression?.({ type: 'ImportExpression', source: { type: 'Literal', value: './dynamic' } });
      };
      const ast = fakeAst([]);
      const relations = extractImports(ast, FILE, undefined, mockResolveImport);
      expect(relations).toHaveLength(1);
      expect(relations[0]!.dstFilePath).toBe(RESOLVED);
      expect(relations[0]!.specifier).toBe('./dynamic');
      expect(JSON.parse(relations[0]!.metaJson!).isDynamic).toBe(true);
    });

    it('should preserve the verbatim specifier when require() is resolved', () => {
      mockResolveImport.mockReturnValue([RESOLVED]);
      mockVisitImpl = () => {
        capturedVisitorCallbacks.CallExpression?.({
          type: 'CallExpression',
          callee: { type: 'Identifier', name: 'require' },
          arguments: [{ type: 'Literal', value: './required' }],
        });
      };
      const ast = fakeAst([]);
      const relations = extractImports(ast, FILE, undefined, mockResolveImport);
      expect(relations).toHaveLength(1);
      expect(relations[0]!.dstFilePath).toBe(RESOLVED);
      expect(relations[0]!.specifier).toBe('./required');
      expect(JSON.parse(relations[0]!.metaJson!).isRequire).toBe(true);
    });
  });
});
