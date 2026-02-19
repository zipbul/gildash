import { describe, it, expect } from 'bun:test';
import { parseSync } from 'oxc-parser';
import { extractRelations } from './relation-extractor';

const FILE = '/project/src/index.ts';

function parse(source: string, filePath = FILE) {
  const { program } = parseSync(filePath, source);
  return program as any;
}

describe('extractRelations', () => {
  // HP — merges all extractors
  it('should include imports relations in the merged result when source has import declarations', () => {
    const ast = parse(`import { foo } from './foo';`);
    const relations = extractRelations(ast, FILE);
    expect(relations.some((r) => r.type === 'imports')).toBe(true);
  });

  it('should include extends relations in the merged result when source has class inheritance', () => {
    const ast = parse(`class A {} class B extends A {}`);
    const relations = extractRelations(ast, FILE);
    expect(relations.some((r) => r.type === 'extends')).toBe(true);
  });

  it('should include calls relations in the merged result when source has function calls', () => {
    const ast = parse(`function caller() { callee(); } function callee() {}`);
    const relations = extractRelations(ast, FILE);
    expect(relations.some((r) => r.type === 'calls')).toBe(true);
  });

  it('should return empty array when source is empty', () => {
    const ast = parse('');
    expect(extractRelations(ast, FILE)).toEqual([]);
  });

  it('should return empty array when source has no imports or calls', () => {
    const ast = parse(`const x = 1; export { x };`);
    expect(extractRelations(ast, FILE)).toEqual([]);
  });

  // tsconfigPaths forwarding
  it('should resolve import path using tsconfig aliases when tsconfigPaths option is provided', () => {
    const tsconfigPaths = {
      baseUrl: '/project',
      paths: new Map([['@utils/*', ['src/utils/*']]]),
    };
    const ast = parse(`import { helper } from '@utils/format';`);
    const relations = extractRelations(ast, FILE, tsconfigPaths);
    const rel = relations.find((r) => r.type === 'imports');
    expect(rel?.dstFilePath).toContain('utils/format');
  });

  // ID
  it('should return identical relations when called repeatedly with the same AST', () => {
    const ast = parse(`
      import { x } from './x';
      class A {} class B extends A {}
      function main() { helper(); }
    `);
    const r1 = extractRelations(ast, FILE);
    const r2 = extractRelations(ast, FILE);
    expect(r1.length).toBe(r2.length);
  });

  // implements
  it('should include implements relations in the merged result when source has class interface implementation', () => {
    const ast = parse(`interface I {} class C implements I {}`);
    const relations = extractRelations(ast, FILE);
    expect(relations.some((r) => r.type === 'implements')).toBe(true);
  });
});
