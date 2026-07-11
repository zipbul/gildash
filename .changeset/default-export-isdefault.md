---
"@zipbul/gildash": minor
---

Distinguish default exports via `isDefault`.

Previously an `export default` symbol was stored under its *local* name (`delay`) with no
marker, so it was indistinguishable from an identically-named named export, and consumers
could not join a default import edge (`dstSymbolName: "default"`) to the exported symbol.
Some default forms (arrow/literal/object expression defaults) produced **no symbol at all**.

- **`isDefault` on symbols.** `SymbolDetail.isDefault` (surfaced through `searchSymbols`,
  `getSymbolsByFile`, `getFullSymbol`, and as `getModuleInterface(...).exports[].isDefault`)
  is `true` for the module's default export in every local **value** form: `export default function/class`
  (named or anonymous), `export default <arrow|literal|object|…>`, `export default <ident>`,
  and `export { x as default }` (including the string form `export { x as "default" }`). Type-only
  default exports (`export type { x as default }` / `export { type x as default }`, and a coincidental
  same-name type/interface) are correctly **not** flagged — `isDefault` marks the value binding.
- **Expression defaults are no longer invisible.** `export default () => …` / `export default 42`
  now yield an exported symbol named `"default"` (kind `function` for arrows, `variable`
  otherwise) instead of nothing.
- **`resolveSymbol("default", file)`** now resolves to the local default *definition* (e.g.
  `delay`) instead of returning the bare string `"default"`, matching how sourced default
  re-exports (`export { x as default } from './m'`) already resolve.
- **Move-detection fix.** Anonymous/synthesized `"default"` symbols share a low-entropy
  fingerprint; they are now excluded from cross-file move detection so a deleted anonymous
  default can no longer be falsely reported as "moved" (which would retarget unrelated
  relations). Named defaults are unaffected.

Sourced default re-exports remain re-export relations (with `exported: "default"` in the
re-export metadata) and the semantic `getModuleInterface` already names default exports
`"default"` — both unchanged.
