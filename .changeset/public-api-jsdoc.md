---
"@zipbul/gildash": patch
---

fix: export missing public types and add JSDoc to all facade methods

- Export `BatchParseResult`, `ExtractedSymbol`, `FileChangeEvent` from barrel
- Add `'namespace'` to `SymbolKind` JSDoc
- Change `Gildash.open()` to accept `Partial<GildashInternalOptions>` (no longer leaks internal type as required)
- Remove unused `PatternSearchOptions` from barrel export
- Simplify `searchAllSymbols` query type (remove redundant `Omit` wrapper)
- Add `@param`, `@returns`, `@throws` JSDoc to all 38 public facade methods
