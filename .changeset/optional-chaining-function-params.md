---
"@zipbul/gildash": minor
---

feat: resolve optional chaining and computed string members, add ExpressionFunction.parameters

- `ChainExpression` (optional chaining `a?.b`, `fn?.()`) now unwrapped to inner expression instead of returning `unresolvable`
- Computed member access with string literal key (`a['key']`) now resolved to `ExpressionMember` instead of `unresolvable`
- `ExpressionFunction.parameters` now populated with `Parameter[]` including name, type, typeImportSource, and decorators
