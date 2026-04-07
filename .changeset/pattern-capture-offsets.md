---
"@zipbul/gildash": minor
---

feat: add column and byte offset to PatternMatch and PatternCapture

- `PatternMatch` and `PatternCapture` now include `startColumn`, `endColumn` (0-based), `startOffset`, `endOffset` (byte offset)
- Enables precise byte-level source text slicing: `sourceText.slice(capture.startOffset, capture.endOffset)`
- Data was already available from ast-grep's `Pos.index` and `Pos.column` but was previously discarded
