---
"@zipbul/gildash": patch
---

perf: memoize buildResolvedType to eliminate exponential re-traversal

- Add per-invocation `Map<ts.Type, ResolvedType>` cache to `buildResolvedType`, preventing the same `ts.Type` object from being recursively expanded multiple times within a single API call.
- Eliminates diamond-pattern re-traversal where shared property types (e.g. `GildashContext` with 44 properties) caused 11,000+ recursive calls per position.
- `getResolvedTypesAtPositions` batch: 652ms → 111ms (5.9x). `getFileTypes`: 1,268ms → 525ms (2.4x). Measured on 150 files × 20 bindings.
