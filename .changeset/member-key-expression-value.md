---
"@zipbul/gildash": minor
---

refactor!: unify member keys under structured `key: SymbolKey` model (BREAKING)

Replaces the prior `keyKind?: 'private' | 'literal' | 'computed'` flag with a structured `key?: SymbolKey` field on `ExtractedSymbol`, and aligns object literal property keys to the same model. Class members, interface members, and enum members now share a single principled abstraction.

### Breaking changes

- **`ExtractedSymbol.keyKind` removed.** Replaced by `ExtractedSymbol.key?: SymbolKey` where `SymbolKey = { kind: 'private' } | KeyExpression`. For computed keys, the inner expression's structure (and `importSource` resolution for imported identifiers) is preserved instead of being collapsed to a string.
- **Private member name now includes `#` prefix.** `class C { #foo }` → `name: '#foo'` (previously `'foo'`). This eliminates collisions with same-named public members (`foo` and `#foo` are now indexed as distinct symbols and both retrievable via FTS prefix search).
- **`ExpressionObjectProperty` shape changed.** Now `{ kind: 'property', key: KeyExpression, value: ExpressionValue, shorthand?: boolean }`. The `computed` flag is removed (derivable from `key.kind`). Static identifier keys (`{ foo: 1 }`) and string-literal keys (`{ 'foo': 1 }`) are both encoded as `{ kind: 'string', value: 'foo' }` since their runtime semantics are identical.
- **`ExpressionObject.properties` is now `(ExpressionObjectProperty | ExpressionSpread)[]`.** Spread elements (`{ ...x }`) are emitted as separate `ExpressionSpread` entries instead of as fake-keyed properties.
- **`ExpressionLiteral` is now a discriminated union** with per-kind value typing (`{ kind: 'string'; value: string }`, `{ kind: 'number'; value: number }`, etc.). Strengthens existing TypeScript narrowing.

### Additions

- **`'bigint'` and `'regex'` literal kinds** in `ExpressionValue`. Previously these fell back to `unresolvable`. `42n` now extracts as `{ kind: 'bigint', value: '42' }`; `/foo/g` as `{ kind: 'regex', value: '/foo/g' }`.
- **TC39 auto-accessor support.** `class C { accessor x = 1 }` is now extracted as a property with `'accessor'` modifier. Handles `AccessorProperty` and `TSAbstractAccessorProperty` node types (including private and computed variants).
- **`'accessor'` added to `Modifier` union.**
- **New public types:** `SymbolKey`, `KeyExpression`, `ExpressionObjectEntry`.

### Fingerprint stability

Structural fingerprints now incorporate the `key` field via deterministic JSON serialization (sorted keys). Logically-identical members produce identical fingerprints regardless of property insertion order in the JS object representation.

### Migration

- `symbol.keyKind === 'private'` → `symbol.key?.kind === 'private'`
- `symbol.keyKind === 'computed'` → check `symbol.key?.kind` against any non-private `KeyExpression` variant (e.g. `'identifier'`, `'member'`, `'call'`, etc.)
- `prop.key === 'foo'` (string) → `prop.key.kind === 'string' && prop.key.value === 'foo'`
- `prop.computed === true` → `prop.key.kind` is not `'string'` / `'number'` / `'bigint'`
- Spread access in object literals: `{ ...x }` is now an entry with `kind: 'spread'`, not a property with `key: '...'`.
