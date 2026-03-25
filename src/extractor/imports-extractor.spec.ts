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
      { type: 'ExportNamedDeclaration', source: { value: './local' } },
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
  it('should include all three specifiers in metaJson when re-export has multiple named specifiers', () => {
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

    expect(relations).toHaveLength(1);
    const meta = JSON.parse(relations[0]!.metaJson!);
    expect(meta.specifiers).toHaveLength(3);
  });

  // 22. [HP] single relation maintained for ExportNamedDeclaration
  it('should produce exactly one relation per ExportNamedDeclaration regardless of specifier count', () => {
    const ast = fakeAst([
      {
        type: 'ExportNamedDeclaration',
        source: { value: './foo' },
        exportKind: 'value',
        specifiers: [
          { type: 'ExportSpecifier', local: { name: 'X' }, exported: { name: 'X' } },
          { type: 'ExportSpecifier', local: { name: 'Y' }, exported: { name: 'Y' } },
        ],
      },
    ]);
    const relations = extractImports(ast, FILE, undefined, mockResolveImport);

    expect(relations).toHaveLength(1);
    expect(JSON.parse(relations[0]!.metaJson!).isReExport).toBe(true);
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

  // 28. [OR] {A,B,C} order preserved in specifiers
  it('should preserve specifier order in metaJson specifiers array when re-export has multiple specifiers', () => {
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

    const meta = JSON.parse(relations[0]!.metaJson!);
    expect(meta.specifiers[0].local).toBe('First');
    expect(meta.specifiers[1].local).toBe('Second');
    expect(meta.specifiers[2].local).toBe('Third');
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

  // 40. [HP] resolved import should NOT have specifier field
  it('should not include specifier field when import is resolved to a file path', () => {
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
    expect(relations[0]!.specifier).toBeUndefined();
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
});
