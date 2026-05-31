---
'@zipbul/gildash': patch
---

fix(search): `getHeritageChain` now normalizes an absolute `filePath` to project-relative before querying the relation store

The relation DB stores project-relative paths, but `getHeritageChain` passed its
`filePath` argument straight to the query. An **absolute** path (e.g. a finding's
`file`) therefore matched no rows and silently returned a normal-shaped node with
empty `children` — indistinguishable from "no heritage". Now an absolute path is
converted via `path.relative(projectRoot, …)` first, matching every other
path-taking API.
