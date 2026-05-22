/**
 * Types for the gildash Semantic Layer (tsc-based).
 *
 * All types in this file are plain data shapes — no runtime logic.
 * The Semantic Layer is opt-in via `Gildash.open({ semantic: true })`.
 */

import type { WriteKind, EnclosingScope } from './reference-classifier';

/**
 * The resolved type of a TypeScript symbol, as determined by the tsc TypeChecker.
 *
 * Captures the full structural description of a type including union/intersection
 * decomposition and generic argument resolution.
 *
 * **Tree structure guarantee**: The returned value is always a bounded, finite,
 * acyclic tree. Beyond the internal depth limit, `members` and `typeArguments`
 * are `undefined` (leaf node), but `text` is always populated with the full
 * type string at every level.
 */
export interface ResolvedType {
  /** Human-readable type string, e.g. `"string | undefined"`, `"Promise<number>"`. */
  text: string;
  /** Raw TypeScript `TypeFlags` bitmask. */
  flags: number;
  /** Whether this type is a union type (`A | B`). */
  isUnion: boolean;
  /** Whether this type is an intersection type (`A & B`). */
  isIntersection: boolean;
  /**
   * Whether this type is a generic instantiation (has type arguments).
   * `true` when the type was instantiated with concrete type arguments
   * (e.g. `Promise<string>`), `false` for non-generic types or uninstantiated generics.
   */
  isGeneric: boolean;
  /**
   * Constituent types for union or intersection.
   * Populated only when `isUnion` or `isIntersection` is `true`.
   */
  members?: ResolvedType[];
  /**
   * Resolved type arguments for generic instantiations.
   * e.g. `Promise<string>` → `[{ text: "string", ... }]`
   */
  typeArguments?: ResolvedType[];
  /**
   * Properties of an object type, enumerated via `checker.getPropertiesOfType()`.
   * Only populated for non-union, non-intersection, non-primitive object types.
   * Capped at 50 properties to avoid huge type expansions.
   */
  properties?: Array<{ name: string; type: ResolvedType }>;
}

/**
 * A single reference to a symbol, resolved via `LanguageService.findReferences`.
 *
 * Unlike text-based search, semantic references are based on symbol identity —
 * renames, re-exports, and shadowed names are handled correctly.
 */
export interface SemanticReference {
  /** Absolute path of the file containing the reference. */
  filePath: string;
  /** Zero-based character offset within the file. */
  position: number;
  /** One-based line number. */
  line: number;
  /** Zero-based column offset. */
  column: number;
  /** Whether this reference is the symbol's own declaration site. */
  isDefinition: boolean;
  /** Whether this reference is a write (assignment) rather than a read. */
  isWrite: boolean;
}

/**
 * A {@link SemanticReference} enriched with the syntactic classification that
 * tsc's `findReferences` does not provide on its own: the kind of write, whether
 * the binding is ambient (no runtime definition), and the lexical scope in which
 * the reference occurs.
 *
 * Binding identity (which declaration each reference binds to, including `var`
 * hoisting and shadowing) is supplied authoritatively by tsc; these fields layer
 * dataflow-relevant metadata on top.
 */
export interface EnrichedReference extends SemanticReference {
  /**
   * The kind of write, or `undefined` for reads. Compound/logical/update writes
   * also read their target — splitting that read-component is the consumer's job.
   */
  writeKind?: WriteKind;
  /**
   * `true` when the binding has no runtime definition (all declarations are
   * ambient: `declare` / `.d.ts`). Computed across the symbol's declarations.
   */
  isAmbient: boolean;
  /** The lexical scope in which this reference occurs. */
  enclosingScope: EnclosingScope;
}

/**
 * All references to a single binding within one file, grouped by symbol identity.
 *
 * Produced by a single-pass walk + `getSymbolAtLocation` (no per-symbol
 * `findReferences`), so collecting every binding in a file is `O(identifiers)`
 * rather than `O(symbols × program)`. References are limited to the queried file
 * (dataflow is intra-file); the declaration may live elsewhere.
 */
export interface FileBinding {
  /** The binding's declaration site (may be in another file, e.g. an import). */
  declaration: {
    filePath: string;
    /** Zero-based offset of the declaration name. */
    position: number;
    /** Symbol name. */
    name: string;
    /** Whether the binding is ambient (no runtime definition). */
    isAmbient: boolean;
  };
  /** Every reference to this binding that occurs in the queried file. */
  references: EnrichedReference[];
}

/**
 * A concrete implementation of an interface or abstract class,
 * found via `LanguageService.getImplementationAtPosition` and
 * `TypeChecker.isTypeAssignableTo`.
 *
 * Includes both explicit (`implements` keyword) and structural (duck-typing) implementations.
 */
export interface Implementation {
  /** Absolute path of the file containing the implementation. */
  filePath: string;
  /** Name of the implementing symbol (class, function, or object literal). */
  symbolName: string;
  /** Zero-based character offset within the file. */
  position: number;
  /** Syntactic kind of the implementing construct. */
  kind: 'class' | 'function' | 'object';
  /** `true` if the `implements` keyword is explicitly present; `false` for duck-typing matches. */
  isExplicit: boolean;
}

/**
 * The semantic view of a module's public interface — exports augmented with resolved types.
 *
 * The syntax-layer extractor already captures export names and kinds.
 * This type adds tsc-resolved type information for each export.
 */
export interface SemanticModuleInterface {
  /** Absolute path of the module file. */
  filePath: string;
  /** Per-export type information. */
  exports: SemanticExport[];
}

/**
 * A single export entry within a {@link SemanticModuleInterface}.
 */
export interface SemanticExport {
  /** Export name as it appears in the source. */
  name: string;
  /** Syntactic kind of the exported symbol. */
  kind: string;
  /**
   * Resolved type of this export, or `null` if type resolution failed.
   * `null` does not propagate as an error — the syntax-layer data remains intact.
   */
  resolvedType: ResolvedType | null;
}

/**
 * Options for {@link SemanticLayer.getDiagnostics}.
 */
export interface GetDiagnosticsOptions {
  /**
   * When `true`, uses `ts.getPreEmitDiagnostics()` which includes syntactic,
   * semantic, and declaration diagnostics — equivalent to `tsc --noEmit`.
   *
   * When `false` (default), only semantic diagnostics are returned.
   */
  preEmit?: boolean;
}

/**
 * A single tsc diagnostic for an indexed file.
 *
 * Only covers files known to the Semantic Layer (i.e. files that have been
 * indexed via `notifyFileChanged`).
 *
 * By default only semantic diagnostics are returned. Pass `{ preEmit: true }`
 * to include syntactic and declaration diagnostics (equivalent to `tsc --noEmit`).
 */
export interface SemanticDiagnostic {
  /** Absolute path of the file containing the diagnostic. */
  filePath: string;
  /** One-based line number. */
  line: number;
  /** Zero-based column offset. */
  column: number;
  /** Human-readable diagnostic message. */
  message: string;
  /** TypeScript diagnostic code (e.g. `2322` for type mismatch). */
  code: number;
  /** Severity category. */
  category: 'error' | 'warning' | 'suggestion';
}
