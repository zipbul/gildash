---
"@zipbul/gildash": minor
---

Add first-class monorepo (multi-tsconfig) support to the semantic layer.

Previously the semantic layer built a single tsc program from `<projectRoot>/tsconfig.json`.
In a monorepo with multiple tsconfigs (e.g. a root lib plus an app with its own
config), files outside that single program got empty bindings/types, and a root
tsconfig that could not build as one program made `Gildash.open({ semantic: true })`
throw entirely.

The semantic layer now models the workspace as one tsc program per governing
tsconfig:

- **Discovery** — every `tsconfig.json` under `projectRoot` (respecting
  `ignorePatterns`) plus configs reachable via `references` are discovered with
  TypeScript's own config parser, so solution-style roots (`files: []` +
  `references`) and non-standard reference targets (`tsconfig.app.json`) are
  covered.
- **Routing** — each file is resolved under the program of its nearest-up
  tsconfig, so a sub-app's files are checked with the sub-app's own compiler
  options (jsx, decorators, lib, paths) instead of the root's.
- **Per-config isolation** — a tsconfig whose program fails to build degrades
  only its own files (`isFileInSemanticProgram` returns `false`, queries return
  empty/`null`); `open` no longer throws because one project's config is broken.

New public API:
- `isFileInSemanticProgram(filePath): boolean` — whether a file is served by a
  healthy semantic program, so callers can degrade per-file.
- `GildashOptions.tsconfigs?: string[]` — explicit, authoritative config list
  (skips auto-discovery; covers non-standard names).
- `GildashOptions.semanticScope?: 'auto' | 'root'` — `'auto'` (default)
  discovers per-tsconfig programs; `'root'` keeps the legacy single-program
  behavior.

Behavior/compat notes:
- Single-tsconfig repos behave as before (one discovered config, one program).
- `semantic: true` with a missing/unbuildable root tsconfig now opens in a
  degraded state instead of throwing.
- Deferred (documented limitations): live invalidation on tsconfig-file edits
  (reopen required), cross-project two-file queries (e.g. `isTypeAssignableTo`
  across projects return `null`), and cross-project reference/implementation
  results.
