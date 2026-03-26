---
"@zipbul/gildash": minor
---

feat: oxc infrastructure overhaul, import/export extraction improvements, symbol extraction fixes

**Breaking**

- `searchSymbols`, `searchRelations`, `searchAnnotations` now return unlimited results when `limit` is omitted (previously defaulted to 100/500). Set explicit `limit` if you relied on the default cap.
- `SymbolKind` adds `'namespace'`. Update exhaustive matches accordingly.
- Re-export relations changed from 1 per statement to 1 per specifier. `metaJson.specifiers` now always contains a single element.

**Import/export extraction**

- Refactor imports-extractor to use `module.staticImports`/`staticExports` for static analysis (AST fallback preserved)
- Track external imports with `specifier` field and `isExternal` meta on unresolved bare specifiers
- Track unresolved relative imports with `isUnresolved` meta
- Track `require()` and `require.resolve()` calls with `isRequire`/`isRequireResolve` meta
- Detect indirect re-export patterns: `import { X } from './a'; export { X }` and `import X from './a'; export default X`
- Capture namespace alias on `export * as ns from './mod'` in `dstSymbolName` and `namespaceAlias` meta
- Classify per-specifier type annotations in `export { type T, value } from './mod'` as separate `type-references` vs `re-exports` relations

**Symbol extraction**

- Fix `export default <identifier>` not marking the referenced variable as exported
- Fix nested destructuring extracting key names instead of binding names (e.g. `const { a: { b: c } } = x` now extracts `c`, not `a`)
- Extract `namespace`, `declare namespace`, and `declare module "name"` as `kind: 'namespace'` with `declare` modifier

**tsconfig**

- `loadTsconfigPaths()` follows `extends` chains recursively (maxDepth=5), inheriting `baseUrl`/`paths` from parent configs

**Semantic layer**

- Add `SymbolDetail` type and `getBaseTypes()` facade method
- Expand public utility exports from semantic layer

**Infrastructure**

- Upgrade oxc-parser 0.115.0 → 0.121.0 with `preserveParens: false` (~25% AST node reduction)
- Replace custom AST traversal with oxc-parser `Visitor` and oxc-walker `walk()`
- Replace custom `OxcNode` types with `@oxc-project/types` ESTree types
- Re-export oxc types (`Program`, `Node`, `Visitor`, `visitorKeys`) for consumers
- DB migration 0008: `specifier` and `is_external` columns for external import storage
- Add `normalizePath` utility for forward-slash path normalization
- Add SQLite index verification and CI benchmark scripts
- Add `FUTURE.md` — blocked/rejected feature decisions documentation
