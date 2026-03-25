---
"@zipbul/gildash": minor
---

feat: oxc-parser upgrade, path normalization, unlimited search, type re-exports

- Upgrade oxc-parser 0.115.0 → 0.121.0
- Set `preserveParens: false` — AST nodes ~25% reduction
- Add `normalizePath` utility — all returned paths use forward slashes
- Search APIs (`searchSymbols`, `searchRelations`, `searchAnnotations`) return unlimited results when `limit` is omitted (previously defaulted to 100/500)
- Re-export oxc types (`Program`, `Node`, `Visitor`, `visitorKeys`, `VisitorObject`) for consumers
- Add FUTURE.md and TODO.md project planning documents
- Remove completed plans/incremental-rebuild-api.md

BREAKING: `searchSymbols` default limit changed from 100 to unlimited. `searchRelations` default limit changed from 500 to unlimited. Consumers relying on default limits should set explicit `limit` values.
