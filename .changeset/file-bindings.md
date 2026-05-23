---
'@zipbul/gildash': minor
---

feat(semantic): add `getFileBindings` — single-pass file-level binding resolution

`getEnrichedReferences` resolves one symbol at a time via tsc `findReferences`,
which reverse-scans the whole program per call. Dataflow / dead-store consumers
that need *every* binding in a file (declarations + their reads/writes) were
forced into an `O(symbols × program)` loop — ~150× slower per file than a single
syntactic walk.

`getFileBindings(filePath)` collects all of a file's bindings in **one AST pass**:
walk every identifier once, resolve it with `getSymbolAtLocation`, and group by
symbol identity (the binder handles `var` hoisting and shadowing, so a block
`var` and an outer read land in the same binding). Cost is `O(identifiers)`.

- Returns `FileBinding[]` — `{ declaration: { filePath, position, name, isAmbient }, references: EnrichedReference[] }`.
- References are limited to the queried file (dataflow is intra-file); the
  declaration may live elsewhere (e.g. an import).
- Each reference carries the same `writeKind` / `isAmbient` / `enclosingScope`
  classification as `getEnrichedReferences`, with binding identity from tsc.
- New exported type `FileBinding`; facade methods
  `Gildash.getFileBindings(filePath)` and `SemanticLayer.getFileBindings`.

Consumers replace per-symbol `getEnrichedReferences` loops with one
`getFileBindings` call per file.
