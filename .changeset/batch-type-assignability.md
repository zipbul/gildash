---
"@zipbul/gildash": minor
---

feat: add `isTypeAssignableToTypeAtPositions` batch API

- Check type assignability for multiple positions against a single target type expression in one call.
- Probe file injection/removal happens once instead of per-position, eliminating repeated Program recompile.
- 50 positions: 2,293ms → 54ms (42x speedup).
