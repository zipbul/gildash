---
"@zipbul/gildash": minor
---

### IndexResult completeness

- **changedSymbols.isExported**: Added `isExported: boolean` to all `changedSymbols` entries (added/modified/removed). Expanded modified detection to include `isExported` and `structuralFingerprint` changes — return type, decorator, heritage, and export status modifications are now reported.

- **changedRelations**: New field tracking relation-level diff (added/removed) per indexing cycle. Identity includes `metaJsonHash` to detect re-export specifier changes. Output includes `dstProject` and `metaJson`.

- **renamedSymbols / movedSymbols**: New fields exposing rename and move detection results that were previously filtered from `changedSymbols` and only available via the changelog.

### Search API

- **RelationSearchQuery pattern matching**: Added `srcFilePathPattern` and `dstFilePathPattern` glob fields for file path filtering via `Bun.Glob`. Mutually exclusive with exact path fields.

### Semantic API

- **isTypeAssignableTo**: Exposes `tsc TypeChecker.isTypeAssignableTo` as a public API. Symbol-name-based (with DB lookup) and position-based (`isTypeAssignableToAt`) variants.

- **getFileTypes**: Bulk type collection for all declarations in a file.

- **getResolvedTypeAt**: Position-based type resolution without DB round-trip.
