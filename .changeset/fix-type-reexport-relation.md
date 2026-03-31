---
"@zipbul/gildash": patch
---

fix: classify type re-exports as `re-exports` instead of `type-references`

- `export type { X } from './mod'` now produces `type: 're-exports'` with `meta.isType: true`, instead of `type: 'type-references'`.
- Ensures `searchRelations({ type: 're-exports' })` and dependency graph include type re-exports, enabling dead type re-export detection.
