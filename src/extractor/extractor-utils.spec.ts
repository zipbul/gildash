import { describe, it, expect } from 'bun:test';
import { parseSync } from 'oxc-parser';
import { resolveImport, buildImportMap } from './extractor-utils';

const FAKE_PROJECT = '/project';

function parseFixture(source: string, filePath = `${FAKE_PROJECT}/src/index.ts`) {
  const { program, errors, comments } = parseSync(filePath, source);
  return { filePath, program, errors, comments, sourceText: source };
}

// ============================================================
// resolveImport
// ============================================================
describe('resolveImport', () => {
  // HP — relative imports
  it('should resolve to absolute path when relative import already has .ts extension', () => {
    const result = resolveImport('/project/src/index.ts', './utils.ts');
    expect(result).toBe('/project/src/utils.ts');
  });

  it('should append .ts extension when relative import specifier has no file extension', () => {
    const result = resolveImport('/project/src/index.ts', './utils');
    expect(result).toBe('/project/src/utils.ts');
  });

  it('should resolve to parent directory path when relative import starts with ../', () => {
    const result = resolveImport('/project/src/nested/index.ts', '../helpers');
    expect(result).toBe('/project/src/helpers.ts');
  });

  it('should resolve correctly when relative import traverses multiple parent directories', () => {
    const result = resolveImport('/project/src/a/b/c.ts', '../../utils');
    expect(result).toBe('/project/src/utils.ts');
  });

  // HP — tsconfig path aliases
  it('should resolve to mapped path when import matches a wildcard tsconfig path alias', () => {
    const tsconfigPaths = {
      baseUrl: '/project',
      paths: new Map([['@utils/*', ['src/utils/*']]]),
    };
    const result = resolveImport('/project/src/index.ts', '@utils/formatter', tsconfigPaths);
    expect(result).toBe('/project/src/utils/formatter.ts');
  });

  it('should resolve to mapped path when import matches an exact-match tsconfig path alias', () => {
    const tsconfigPaths = {
      baseUrl: '/project',
      paths: new Map([['@root', ['src/index']]]),
    };
    const result = resolveImport('/project/src/a.ts', '@root', tsconfigPaths);
    expect(result).toBe('/project/src/index.ts');
  });

  // NE — external packages
  it('should return null when import specifier is a bare npm package name', () => {
    const result = resolveImport('/project/src/index.ts', 'lodash');
    expect(result).toBeNull();
  });

  it('should return null when import specifier is a scoped npm package', () => {
    const result = resolveImport('/project/src/index.ts', '@types/node');
    expect(result).toBeNull();
  });

  it('should return null when import specifier does not match any tsconfig path alias', () => {
    const tsconfigPaths = {
      baseUrl: '/project',
      paths: new Map([['@utils/*', ['src/utils/*']]]),
    };
    const result = resolveImport('/project/src/index.ts', '@other/lib', tsconfigPaths);
    expect(result).toBeNull();
  });

  // ED
  it('should resolve to directory path with .ts when relative import is a bare "."', () => {
    const result = resolveImport('/project/src/index.ts', '.');
    expect(result).toBe('/project/src.ts');
  });

  // ID
  it('should return identical result when called twice with the same input arguments', () => {
    const r1 = resolveImport('/project/src/a.ts', './b');
    const r2 = resolveImport('/project/src/a.ts', './b');
    expect(r1).toBe(r2);
  });

  // tsconfig — append .ts to alias result when no extension
  it('should append .ts to resolved alias path when alias target has no file extension', () => {
    const tsconfigPaths = {
      baseUrl: '/project',
      paths: new Map([['@lib/*', ['lib/*']]]),
    };
    const result = resolveImport('/project/src/index.ts', '@lib/utils', tsconfigPaths);
    expect(result).toBe('/project/lib/utils.ts');
  });

  // tsconfig — target with extension already
  it('should not double-append .ts when alias target already includes .ts extension', () => {
    const tsconfigPaths = {
      baseUrl: '/project',
      paths: new Map([['@lib/utils', ['lib/utils.ts']]]),
    };
    const result = resolveImport('/project/src/index.ts', '@lib/utils', tsconfigPaths);
    expect(result).toBe('/project/lib/utils.ts');
  });
});

// ============================================================
// buildImportMap
// ============================================================
describe('buildImportMap', () => {
  // HP
  it('should map local name to importedName and resolved path when declaration has a named specifier', () => {
    const source = `import { foo } from './utils';`;
    const { program } = parseFixture(source);
    const map = buildImportMap(program as any, `${FAKE_PROJECT}/src/index.ts`);
    const ref = map.get('foo');
    expect(ref).toBeDefined();
    expect(ref!.importedName).toBe('foo');
    expect(ref!.path).toBe(`${FAKE_PROJECT}/src/utils.ts`);
  });

  it('should set importedName to "default" when declaration is a default import', () => {
    const source = `import Foo from './Foo';`;
    const { program } = parseFixture(source);
    const map = buildImportMap(program as any, `${FAKE_PROJECT}/src/index.ts`);
    const ref = map.get('Foo');
    expect(ref?.importedName).toBe('default');
  });

  it('should set importedName to "*" when declaration is a namespace import', () => {
    const source = `import * as utils from './utils';`;
    const { program } = parseFixture(source);
    const map = buildImportMap(program as any, `${FAKE_PROJECT}/src/index.ts`);
    const ref = map.get('utils');
    expect(ref?.importedName).toBe('*');
  });

  it('should return an empty map when source has no import declarations', () => {
    const source = `const x = 1;`;
    const { program } = parseFixture(source);
    const map = buildImportMap(program as any, `${FAKE_PROJECT}/src/index.ts`);
    expect(map.size).toBe(0);
  });

  it('should skip mapping when import source is an external npm package', () => {
    const source = `import React from 'react';`;
    const { program } = parseFixture(source);
    const map = buildImportMap(program as any, `${FAKE_PROJECT}/src/index.ts`);
    expect(map.size).toBe(0);
  });

  it('should map by local alias name when import specifier uses "as" renaming', () => {
    const source = `import { foo as bar } from './utils';`;
    const { program } = parseFixture(source);
    const map = buildImportMap(program as any, `${FAKE_PROJECT}/src/index.ts`);
    expect(map.has('bar')).toBe(true);
    expect(map.get('bar')!.importedName).toBe('foo');
    expect(map.has('foo')).toBe(false);
  });

  it('should map all specifiers when import declaration has multiple named specifiers', () => {
    const source = `import { a, b, c } from './multi';`;
    const { program } = parseFixture(source);
    const map = buildImportMap(program as any, `${FAKE_PROJECT}/src/index.ts`);
    expect(map.has('a')).toBe(true);
    expect(map.has('b')).toBe(true);
    expect(map.has('c')).toBe(true);
  });

  it('should not include dynamic imports from function bodies when processing only top-level nodes', () => {
    const source = `
      function wrap() {
        import('./lazy');
      }
    `;
    const { program } = parseFixture(source);
    const map = buildImportMap(program as any, `${FAKE_PROJECT}/src/index.ts`);
    // Dynamic import inside a function body should not appear in top-level import map
    expect(map.size).toBe(0);
  });

  // ID
  it('should produce identical maps when called repeatedly with the same AST input', () => {
    const source = `import { x } from './x';`;
    const { program } = parseFixture(source);
    const m1 = buildImportMap(program as any, `${FAKE_PROJECT}/src/index.ts`);
    const m2 = buildImportMap(program as any, `${FAKE_PROJECT}/src/index.ts`);
    expect([...m1.entries()]).toEqual([...m2.entries()]);
  });
});
