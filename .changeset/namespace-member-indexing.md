---
"@zipbul/gildash": minor
---

feat: index namespace members as individual symbols

- TS namespace exported members (`export function`, `export const`, etc.) are now extracted as `members` on the namespace symbol, matching the existing enum member pattern.
- `getSymbolsByFile` returns `Guards.isString` (kind: function, memberName: isString) as individual rows, enabling unused namespace member detection.
