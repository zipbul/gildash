---
'@zipbul/gildash': minor
---

feat(semantic): add `getStandaloneFileBindings` — isolated O(file) binding resolution

Resolving an ad-hoc in-memory source by `notifyFileChanged` + `getFileBindings`
forces the shared tsc TypeChecker to be discarded and the whole project
re-type-checked on the next query (≈210 ms on a 554-file project), because tsc's
checker is per-program and not incremental. Consumers that analyze many
self-contained sources (e.g. test fixtures) paid this per source.

`getStandaloneFileBindings(filePath, content)` resolves the source in a throwaway
single-file program (`noLib`, `noResolve`) that never touches the shared project
program. It is `O(file)` and constant regardless of project size (~1 ms/call vs
~210 ms), and returns the same `FileBinding[]` shape.

- **Scope**: LOCAL/intra-file binding identity only — var hoisting, shadowing,
  destructuring, `writeKind`, `enclosingScope` are identical to `getFileBindings`.
  Cross-file import targets and global/lib symbols are **not** resolved (omitted);
  for those, use `getFileBindings`.
- Also exposes the in-memory file APIs added alongside: `getFileBindingsBatch`,
  `notifyFileChanged`, `notifyFileDeleted` (see prior release).

Use `getStandaloneFileBindings` for independent ad-hoc sources; reserve
`getFileBindings` for sources that must resolve against the indexed project.
