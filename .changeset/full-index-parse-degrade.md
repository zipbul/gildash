---
"@zipbul/gildash": patch
---

Fix `Gildash.open` hard-failing when a single file fails to parse.

`open` runs an initial full index, and the full-index path parsed files **inside**
the SQLite transaction, throwing on the first parse error. A single unparseable
file (e.g. a broken fixture in a large repo like microsoft/TypeScript) therefore
aborted the entire `open`, indexing nothing.

The incremental path already degraded per-file (skip + report via `failedFiles`),
and the result assembly already excludes failed files from `indexedFiles` and
surfaces them in `failedFiles`. The full-index (transaction) path now applies the
same degrade: the per-file parse is wrapped so an `Err`/throw is logged, recorded
in `failedFiles`, and skipped, while the transaction continues. The failed file's
record is still upserted and its stale symbols cascade-deleted, so it ends up with
no symbols and is not re-parsed on subsequent unchanged runs.

Failures are available via the logger and the `IndexResult.failedFiles` returned
by `reindex()` / delivered to `onIndexed()`. Indexing failures (as opposed to
parse failures) still roll the transaction back, since those indicate an internal
bug rather than untrusted input.

Scope: this handles oxc returning an error or throwing a JS-level exception. It
does **not** protect against a native oxc process abort (e.g. stack overflow on
pathologically deep input), which is uncatchable in-process and would require
out-of-process parsing.
