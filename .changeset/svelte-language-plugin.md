---
"@zipbul/gildash": minor
---

Svelte support via `createSveltePlugin()` (optional peer `svelte` >= 5).

Extends the language-plugin architecture (added for Vue) to Svelte components:
`<script module>` / `<script>` blocks (raw order, `lang="ts"`) are extracted into
a virtual TS module with an exact slice-based position map, so `.svelte` files
are indexed at raw coordinates, join the import graph, and answer cross-file
semantic queries — reusing the same host virtual-file table, module-resolution
hook, and raw-coordinate boundary as Vue (no new pipeline code).

Svelte 5 `generics="..."` type parameters are brought into scope via a synthetic
type-alias prelude, so generic components resolve their types (no spurious
`Cannot find name 'T'`).

New API: `createSveltePlugin()`. Add `'.svelte'` to `extensions` to index
components. Limits (documented): markup/template expressions are not analyzed
(script blocks only); Svelte `export let` props are indexed as TypeScript, so
strict-mode `used before assigned` diagnostics may appear on them (full prop
semantics — svelte2tsx-style — is out of scope). Symbols, bindings, types, and
cross-file references are unaffected.
