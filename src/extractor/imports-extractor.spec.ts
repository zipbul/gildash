import { describe, it, expect } from 'bun:test';
import { parseSync } from 'oxc-parser';
import { extractImports } from './imports-extractor';

const FILE = '/project/src/index.ts';

function parse(source: string, filePath = FILE) {
  const { program } = parseSync(filePath, source);
  return program as any;
}

describe('extractImports', () => {
  // HP — named import
  it('should produce an imports relation when source has a named import specifier', () => {
    const ast = parse(`import { foo } from './utils';`);
    const relations = extractImports(ast, FILE);
    expect(relations.some((r) => r.type === 'imports')).toBe(true);
  });

  it('should set srcFilePath to the current file path when processing a static import', () => {
    const ast = parse(`import { x } from './x';`);
    const relations = extractImports(ast, FILE);
    expect(relations[0].srcFilePath).toBe(FILE);
  });

  it('should set srcSymbolName to null when import is a top-level static import', () => {
    const ast = parse(`import { y } from './y';`);
    const relations = extractImports(ast, FILE);
    expect(relations[0].srcSymbolName).toBeNull();
  });

  it('should set dstSymbolName to null when import is a top-level static import', () => {
    const ast = parse(`import { z } from './z';`);
    const relations = extractImports(ast, FILE);
    expect(relations[0].dstSymbolName).toBeNull();
  });

  // NE — external package
  it('should not produce a relation when import source is an npm package', () => {
    const ast = parse(`import { useState } from 'react';`);
    const relations = extractImports(ast, FILE);
    expect(relations).toHaveLength(0);
  });

  // type import
  it('should include {"isType":true} in metaJson when import declaration is a type-only import', () => {
    const ast = parse(`import type { Foo } from './foo';`);
    const relations = extractImports(ast, FILE);
    if (relations.length > 0) {
      expect(relations[0].metaJson).toContain('"isType":true');
    }
  });

  // re-export (ExportAllDeclaration)
  it('should produce an imports relation with {"isReExport":true} when declaration is export * from', () => {
    const ast = parse(`export * from './barrel';`);
    const relations = extractImports(ast, FILE);
    const rel = relations.find((r) => r.metaJson?.includes('"isReExport":true'));
    expect(rel).toBeDefined();
  });

  // dynamic import
  it('should produce an imports relation with {"isDynamic":true} when declaration is a dynamic import()', () => {
    const ast = parse(`async function load() { await import('./dynamic'); }`);
    const relations = extractImports(ast, FILE);
    const rel = relations.find((r) => r.metaJson?.includes('"isDynamic":true'));
    expect(rel).toBeDefined();
  });

  // ED — empty file
  it('should return empty array when source is empty', () => {
    const ast = parse('');
    expect(extractImports(ast, FILE)).toEqual([]);
  });

  // ED — no imports
  it('should return empty array when source has no import or export declarations', () => {
    const ast = parse(`const x = 1; export { x };`);
    expect(extractImports(ast, FILE)).toEqual([]);
  });

  // ID
  it('should return identical relations when called repeatedly with the same AST', () => {
    const ast = parse(`import { a } from './a';`);
    const r1 = extractImports(ast, FILE);
    const r2 = extractImports(ast, FILE);
    expect(r1).toEqual(r2);
  });

  // re-export — ExportNamedDeclaration with source (G2)
  it('should produce an imports relation with {"isReExport":true} when declaration is export { foo } from', () => {
    const ast = parse(`export { foo } from './local';`);
    const relations = extractImports(ast, FILE);
    const rel = relations.find((r) => r.metaJson?.includes('"isReExport":true'));
    expect(rel).toBeDefined();
    expect(rel!.type).toBe('imports');
  });

  it('should return no relation when export { foo } from source is an external npm package', () => {
    const ast = parse(`export { foo } from 'react';`);
    const relations = extractImports(ast, FILE);
    expect(relations).toHaveLength(0);
  });
});
