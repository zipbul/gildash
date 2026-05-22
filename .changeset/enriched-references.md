---
'@zipbul/gildash': minor
---

feat(semantic): add `getEnrichedReferences` — authoritative binding resolution with writeKind / isAmbient / enclosingScope

The re-exported oxc-walker `ScopeTracker` tracks only lexical (block) scopes — it does not model JavaScript `var` hoisting, so a `var` declared in a block is not unified with reads in the enclosing function scope. Consumers that used it for *binding resolution* (e.g. dataflow / dead-store detectors) got false positives.

This release adds binding resolution backed by the semantic layer's TypeScript compiler, whose binder is authoritative for `var`/function hoisting, shadowing, and re-exports:

- **`Gildash.getEnrichedReferences(symbolName, filePath, project?)`** and **`Gildash.getEnrichedReferencesAtPosition(filePath, position)`** return `EnrichedReference[]`.
- Each `EnrichedReference` extends `SemanticReference` with:
  - `writeKind?` — `'declaration' | 'assignment' | 'compound-assignment' | 'logical-assignment' | 'update'` (or `undefined` for reads), classified syntactically.
  - `isAmbient` — `true` only when every declaration of the symbol is ambient (`declare` / `.d.ts`).
  - `enclosingScope` — `{ kind: 'function' | 'module' | 'block', pos, end }`, the lexical scope of the reference.
- New exported types: `EnrichedReference`, `WriteKind`, `ScopeKind`, `EnclosingScope`.

`ScopeTracker` remains exported as a syntactic AST-walk primitive (alongside `walk` / `parseAndWalk`); binding-semantics consumers should use `getEnrichedReferences` instead. No existing API changed.
