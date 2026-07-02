---
"@zipbul/gildash": minor
---

Fix nested `package.json` files silently emptying main-project symbol/relation queries.

A `package.json` anywhere under `projectRoot` (e.g. test fixtures — even inside
`ignorePatterns`-matched directories) became a package boundary, and because
boundaries are sorted deepest-first, the **deepest subpackage** was picked as the
default project. `searchSymbols`/`searchRelations` query the default project, so
main-project results silently went to 0 rows while graph APIs (cross-project
unions) stayed alive.

Fixes (root-cause):
- **Root boundary invariant** — boundary discovery now always yields a root (`.`)
  boundary (synthesized from the projectRoot basename when no root `package.json`
  exists), and the default project is the root boundary — never the deepest
  subpackage. This also removes a latent mismatch where boundary-less files were
  indexed under a hardcoded `"default"` project no query ever targeted.
- **`ignorePatterns` now applies to boundary discovery** (open-time and
  package.json-change rediscovery), combined with the built-in excludes — ignored
  paths no longer reshape the project structure.
- Deterministic boundary ordering for equal-depth directories.

Observability (customer request):
- New `defaultProject` getter on the facade.
- `Logger` gains an optional `warn?` channel; open logs one summary line when
  multiple boundaries are discovered (boundary list + chosen default).
- `query.project` scoping on `searchSymbols`/`searchRelations` is now documented
  and covered by tests (`searchAllSymbols`/`searchAllRelations` remain the
  cross-project union).

Hardening from adversarial review:
- **Orphan-row garbage collection** — a full index now removes rows of projects
  that are no longer in the boundary set (package renames, boundary reshapes, or
  this upgrade changing attribution previously left stale rows double-counting in
  `searchAllSymbols`/graph unions forever).
- The root boundary always sorts **last**, so a nested package whose directory
  ties with `.` on length is no longer swallowed by the root catch-all.
- The synthetic root name is deduplicated against discovered package names
  (a repo directory named like a nested package no longer merges query scopes).
- The root-boundary invariant is enforced for injected/custom discovery results
  and runtime boundary changes, not just built-in discovery.

Behavioral notes: repos with nested packages may see `defaultProject` change from
the deepest subpackage to the root (this is the fix); discovery output now always
contains a root boundary entry; the first full index after upgrading may prune
rows stored under stale project attributions (they are re-indexed under the
correct project in the same pass). Known pre-existing limitation (documented,
unchanged): project identity is the package *name*, so two identically-named
real packages merge query scopes.
