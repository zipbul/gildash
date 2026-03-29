---
"@zipbul/gildash": patch
---

fix: deduplicate movedSymbols in incremental indexing, add integration tests

- Fix duplicate entries in `IndexResult.movedSymbols` during incremental indexing. The `deletedSymbols` loop and `renameResult.removed` loop could both match the same symbol by fingerprint, producing duplicates and redundant `retargetRelations` calls.
- Add `test/incremental.test.ts` (21 integration tests) covering: incremental rename/move detection with real files, changelog recording for rename/move, monorepo cross-project relation indexing, external import (`isExternal`/`specifier`) indexing, and Gildash facade-level search for external/cross-project relations.
