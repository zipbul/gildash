---
"@zipbul/gildash": patch
---

Harden the language-plugin frontend support (Vue/Svelte):

- **Svelte generics**: `generics="..."` type parameters using a `const` type-parameter
  modifier, `in`/`out` variance, an `extends` constraint combined with a default,
  whitespace (tab/newline) separated `extends`, or string/template-literal
  constraints no longer emit invalid virtual TS. Such (valid Svelte 5) components
  previously indexed **zero** symbols — a silent syntax error erased the whole
  component from the index; they now index correctly.
- **Watch mode**: file edits now update the semantic layer. The watcher emits
  project-relative paths; these are now resolved to absolute before notifying the
  semantic program (they previously desynced with the absolute-keyed program,
  leaving watch-mode semantic queries stale after every edit).
- **`getParsedAst`**: plugin files (`.vue`/`.svelte`) are no longer exposed through
  the parse cache — their cached AST holds virtual (extracted-script) coordinates,
  and returning it under the raw path violated the raw-coordinate invariant every
  other public API upholds. Query their symbols via `searchSymbols`/`getSymbolsByFile`.
- **Path-alias imports**: semantic resolution of `.vue`/`.svelte` imports now
  honors tsconfig `baseUrl`/`paths` (longest-matching pattern wins), not only
  relative specifiers. Alias imports like `@/Foo.vue` / `$lib/Foo.svelte` —
  standard in Vite/Nuxt/SvelteKit — previously failed with a spurious
  "cannot find module" from the semantic layer.
- **API cleanup**: removed the unused `resolveModuleName` member from the
  `LanguagePlugin` interface. Module resolution of plugin-file imports is owned by
  the semantic host's virtual-file table; the member was never called.
