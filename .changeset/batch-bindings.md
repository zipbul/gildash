---
'@zipbul/gildash': minor
---

feat(semantic): batch ad-hoc binding resolution + public notify API

Consumers resolving bindings for many in-memory sources (e.g. unit-test fixtures)
hit a ~10× slowdown: interleaving `notifyFileChanged` with a per-file
`getFileBindings` forces the tsc Program to recompute on every query (notifying a
file bumps its version, so the next query rebuilds). Measured: `(notify, query)`
× 100 files ≈ 300 ms vs ≈ 30 ms when all files are notified before any query.

- **`Gildash.getFileBindingsBatch(files)`** → `Map<filePath, FileBinding[]>`.
  Notifies every file first, then queries, so the Program rebuilds once for the
  whole batch instead of once per file.
- **`Gildash.notifyFileChanged(filePath, content)`** / **`notifyFileDeleted(filePath)`**
  are now public (previously only reachable via the internal context), for
  registering ad-hoc in-memory sources not backed by disk.
- **`notifyFileChanged` is now idempotent**: notifying identical content is a
  no-op (no version bump), so repeated registration of unchanged sources no
  longer triggers needless recomputes.

Binding identity and `FileBinding` shape are unchanged. For large ad-hoc sets,
prefer `getFileBindingsBatch` over interleaving notify/query.
