---
"@zipbul/gildash": minor
---

feat: add importSource to ExpressionValue identifier/member/call/new

- `ExpressionIdentifier` gains `importSource?: string` and `originalName?: string`
- `ExpressionMember` gains `importSource?: string` (resolved from the object's root identifier)
- `ExpressionCall` gains `importSource?: string` (resolved from the callee)
- `ExpressionNew` gains `importSource?: string` (resolved from the callee)
- Import source is the raw module specifier from `staticImports` (e.g. `'./my.service'`, `'@zipbul/http-adapter'`), not a resolved file path
- Non-breaking: all new fields are optional
