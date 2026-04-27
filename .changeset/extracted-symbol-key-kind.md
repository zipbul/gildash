---
"@zipbul/gildash": minor
---

feat: expose member key syntactic form via `ExtractedSymbol.keyKind`

Adds an optional `keyKind?: 'private' | 'literal' | 'computed'` field to `ExtractedSymbol`, populated for class and interface members whose key is not a plain identifier:

- `'private'` — `#name` PrivateIdentifier. The `name` field continues to hold the bare identifier without `#`.
- `'literal'` — string- or numeric-literal key (e.g. `'my-method'() {}`, `42 = 'answer'`). The `name` field holds the literal value.
- `'computed'` — `[expr]` key. The `name` field now holds the source text of the bracket expression (e.g. `'Symbol.iterator'`) instead of the previous fallback of `'unknown'`.

Plain identifier keys continue to omit the field, so existing JSON shapes are unchanged for the common case. This unblocks consumers that need to distinguish private/computed members syntactically without re-walking the raw AST.
