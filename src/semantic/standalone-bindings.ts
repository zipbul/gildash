/**
 * standalone-bindings — resolve a self-contained source's bindings in isolation.
 *
 * Builds a throwaway single-file tsc program (`noLib`, `noResolve`) and runs the
 * shared {@link collectBindings} core. It never touches the shared project
 * program, so its cost is independent of project size — unlike notifying an
 * ad-hoc file into the shared program, which invalidates the whole TypeChecker
 * (full re-typecheck on the next query). The source content is served in-memory
 * (never read from disk); `noResolve` still lets the compiler host issue
 * existence stats for any import specifiers, but no file contents are read and
 * bindings are unaffected.
 *
 * Scope: LOCAL/intra-file binding identity only (var hoisting, shadowing,
 * destructuring, writeKind, enclosingScope). It does NOT resolve cross-file
 * import targets or global/lib symbols — those are omitted (the shared-program
 * path surfaces them as ambient bindings, which dataflow consumers exclude).
 */

import ts from "typescript";
import { collectBindings } from "./reference-resolver";
import type { FileBinding } from "./types";

/** Syntax-affecting compiler options inherited from the project for parsing parity. */
export interface StandaloneParseOptions {
  target?: ts.ScriptTarget;
  module?: ts.ModuleKind;
  jsx?: ts.JsxEmit;
  jsxFactory?: string;
  jsxFragmentFactory?: string;
  jsxImportSource?: string;
  experimentalDecorators?: boolean;
  useDefineForClassFields?: boolean;
}

/**
 * Resolve `content`'s bindings as a self-contained source. `filePath` is used
 * only for the returned `declaration.filePath` and to pick the `.tsx` parser;
 * `content` is authoritative (never read from disk).
 */
export function buildStandaloneBindings(
  filePath: string,
  content: string,
  inherited: StandaloneParseOptions = {},
): FileBinding[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    inherited.target ?? ts.ScriptTarget.ESNext,
    /*setParentNodes*/ true,
  );

  const options: ts.CompilerOptions = {
    target: inherited.target,
    module: inherited.module,
    // `.tsx` with no project `jsx` → Preserve so it still parses.
    jsx: inherited.jsx ?? (filePath.endsWith(".tsx") ? ts.JsxEmit.Preserve : undefined),
    jsxFactory: inherited.jsxFactory,
    jsxFragmentFactory: inherited.jsxFragmentFactory,
    jsxImportSource: inherited.jsxImportSource,
    experimentalDecorators: inherited.experimentalDecorators,
    useDefineForClassFields: inherited.useDefineForClassFields,
    // Isolation: no lib, no module resolution, no @types — keeps it O(file).
    noLib: true,
    noResolve: true,
    types: [],
  };

  // Default host with only the in-memory source overridden. noLib + noResolve +
  // a single root mean no file *contents* are read from disk (the host may still
  // stat import-specifier paths, which does not affect bindings).
  const host = ts.createCompilerHost(options, /*setParentNodes*/ true);
  host.getSourceFile = (f) => (f === filePath ? sourceFile : undefined);

  const program = ts.createProgram([filePath], options, host);
  const sf = program.getSourceFile(filePath);
  if (!sf) return [];
  return collectBindings(sf, program.getTypeChecker());
}
