---
"@zipbul/gildash": minor
---

feat: handle export specifiers and add memberName to SymbolSearchResult

- Fix `export { name }` specifiers marking symbols as `isExported: true`
- Add `memberName` field to `SymbolSearchResult` for unqualified member name access
- Remove deprecated `gildashError()` factory function (use `new GildashError()` directly)
- Add 72 test cases covering annotation-api, changelog-api, modifiers, relation types, edge cases, and batch boundaries
