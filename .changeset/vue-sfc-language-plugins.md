---
"@zipbul/gildash": minor
---

Vue SFC support via a language-plugin architecture.

New `GildashOptions.plugins` accepts language plugins; `createVuePlugin()`
(optional peer `@vue/compiler-sfc` >= 3.4) teaches gildash `.vue` files on both
pipeline sides:

- **Indexing** — `<script>` / `<script setup>` blocks (including dual-block
  SFCs, `lang="ts"/"tsx"`) are extracted and parsed; symbols and annotations are
  stored at **raw `.vue` coordinates** via an exact slice-based position map
  (unmappable spans are skipped, never approximated). `import './Foo.vue'`
  resolves in the relation graph.
- **Semantics** — each per-tsconfig program registers a virtual TS module per
  SFC and resolves `.vue` imports through a host `resolveModuleNameLiterals`
  hook, so cross-file types, references, bindings, and diagnostics work through
  the `.vue` boundary. Every public semantic surface (bindings, enriched
  references, ByteSpan/type queries, diagnostics, `lineColumnToPosition`,
  `findNamePosition`, `isFileInSemanticProgram`, `getStandaloneFileBindings`)
  speaks **raw file coordinates** — inputs are translated to the virtual module,
  outputs translated back. `getStandaloneFileBindings` extracts the script for a
  plugin file rather than parsing the raw markup.
- Virtual lifecycle follows the raw file: edits re-expand, a `lang` flip retires
  the stale virtual name, deletion removes the expansion. Plugin-less pipelines
  are untouched (registry bypass; the resolution hook is only installed when
  plugins exist).

New public API: `createVuePlugin()`, `LanguagePlugin`, `PositionMap`,
`GildashOptions.plugins`. Add `'.vue'` to `extensions` to index SFCs.

Known limits (documented): template expressions are not analyzed (script blocks
only); a `.vue` file with no script block contributes an empty module.
