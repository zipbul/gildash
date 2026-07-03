import { describe, it, expect } from 'bun:test';
import { isErr } from '@zipbul/result';
import ts from 'typescript';
import { TscProgram } from './tsc-program';
import { LanguagePluginRegistry } from '../lang/registry';
import { createVuePlugin } from '../lang/vue-plugin';
import type { GildashError } from '../errors';

/**
 * Language-plugin integration of the tsc host: raw SFC notifications expand to
 * virtual TS files, `./Foo.vue` imports resolve through the virtual table, and
 * the virtual lifecycle follows the raw file (edit, lang flip, delete).
 */

const TSCONFIG = '/proj/tsconfig.json';
const VALID_TSCONFIG = JSON.stringify({
  compilerOptions: { strict: true, module: 'esnext', target: 'es2022' },
});
const FAKE_LIB = '// lib\nexport {};\n';

function makeProgram(): TscProgram {
  const result = TscProgram.create(TSCONFIG, {
    readConfigFile: (p) => (p === TSCONFIG ? VALID_TSCONFIG : undefined),
    resolveNonTrackedFile: (p) =>
      p.includes('lib.') && p.endsWith('.d.ts') ? FAKE_LIB : undefined,
    registry: new LanguagePluginRegistry([createVuePlugin()]),
  });
  if (isErr<GildashError>(result)) throw new Error(result.data.message);
  return result;
}

const SFC = `<template><p>{{ msg }}</p></template>
<script setup lang="ts">
export const msg: string = 'hi';
export const count = 42;
</script>
`;

describe('TscProgram — language plugin virtual files', () => {
  it('should expand a notified SFC into a virtual TS source file (raw file not in program)', () => {
    const program = makeProgram();
    program.notifyFileChanged('/proj/Foo.vue', SFC);

    const tsProgram = program.getProgram();
    expect(tsProgram.getSourceFile('/proj/Foo.vue.__sfc__.ts')).toBeDefined();
    expect(tsProgram.getSourceFile('/proj/Foo.vue')).toBeUndefined();
  });

  it('should resolve an import of ./Foo.vue to the virtual file with exact cross-file types', () => {
    const program = makeProgram();
    program.notifyFileChanged('/proj/Foo.vue', SFC);
    program.notifyFileChanged('/proj/a.ts', `import { msg, count } from './Foo.vue';\nexport const x = msg;\nexport const y = count;\n`);

    const tsProgram = program.getProgram();
    const sf = tsProgram.getSourceFile('/proj/a.ts')!;
    expect(tsProgram.getSemanticDiagnostics(sf)).toEqual([]);

    const checker = tsProgram.getTypeChecker();
    const xDecl = sf.statements.find((s): s is ts.VariableStatement => ts.isVariableStatement(s))!;
    const xType = checker.getTypeAtLocation(xDecl.declarationList.declarations[0]!.name);
    expect(checker.typeToString(xType)).toBe('string');
  });

  it('should surface edited SFC content in the virtual file', () => {
    const program = makeProgram();
    program.notifyFileChanged('/proj/Foo.vue', SFC);
    program.notifyFileChanged('/proj/Foo.vue', SFC.replace("'hi'", "'edited'"));

    const text = program.getProgram().getSourceFile('/proj/Foo.vue.__sfc__.ts')!.getFullText();
    expect(text).toContain("'edited'");
  });

  it('should retire the stale virtual name when the script lang flips ts -> tsx', () => {
    const program = makeProgram();
    program.notifyFileChanged('/proj/Foo.vue', SFC);
    program.notifyFileChanged('/proj/Foo.vue', `<script setup lang="tsx">\nexport const node = <div />;\n</script>\n`);

    const tsProgram = program.getProgram();
    expect(tsProgram.getSourceFile('/proj/Foo.vue.__sfc__.tsx')).toBeDefined();
    expect(tsProgram.getSourceFile('/proj/Foo.vue.__sfc__.ts')).toBeUndefined();
  });

  it('should remove all virtual files when the raw SFC is removed', () => {
    const program = makeProgram();
    program.notifyFileChanged('/proj/Foo.vue', SFC);
    program.removeFile('/proj/Foo.vue');

    expect(program.getProgram().getSourceFile('/proj/Foo.vue.__sfc__.ts')).toBeUndefined();
  });

  it('should leave unresolved .vue imports as diagnostics, not crashes, when the SFC was never fed', () => {
    const program = makeProgram();
    program.notifyFileChanged('/proj/a.ts', `import { msg } from './Missing.vue';\nexport const x = msg;\n`);

    const sf = program.getProgram().getSourceFile('/proj/a.ts')!;
    expect(program.getProgram().getSemanticDiagnostics(sf).length).toBeGreaterThan(0);
  });
});
