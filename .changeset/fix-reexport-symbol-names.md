---
"@zipbul/gildash": patch
---

fix: preserve symbol names in named re-export relations

- `export { X } from './mod'` and `export type { X } from './mod'` now set `dstSymbolName` to the original name and `srcSymbolName` to the exported name, instead of both being `null`.
- Applies to both oxc module metadata and AST fallback extraction paths.
