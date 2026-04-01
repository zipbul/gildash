---
"@zipbul/gildash": patch
---

perf: cache probe file across type assignability calls

- Probe file for `isTypeAssignableToType` / `isTypeAssignableToTypeAtPositions` is now retained between calls with the same target type expression, eliminating redundant Program recompiles.
- 50 files with same target type: 2,491ms → 42ms (59x). Single calls also benefit automatically.
- Probe is cleaned up on `dispose()` or when the target type expression changes.
