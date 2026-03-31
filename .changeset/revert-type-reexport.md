---
"@zipbul/gildash": patch
---

revert: restore type re-exports as `type-references` classification

- Reverts #80. `export type { X } from './mod'` is again classified as `type-references` with `meta.isReExport: true`, not `re-exports`.
- The original classification was consistent: all type-only operations → `type-references`. The change broke this by reclassifying only type re-exports while leaving type imports unchanged.
- The dependency graph already queries `type-references`, so type re-exports were never missing from the graph.
