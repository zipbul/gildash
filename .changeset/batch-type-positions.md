---
"@zipbul/gildash": minor
---

feat: add `getResolvedTypesAtPositions` batch API

- Add `getResolvedTypesAtPositions(filePath, positions)` to resolve types at multiple byte offsets in a single file with one Program/TypeChecker/SourceFile lookup, reducing per-call overhead when querying many positions in the same file.
