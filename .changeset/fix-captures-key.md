---
"@zipbul/gildash": patch
---

fix: strip $ prefix when calling ast-grep getMatch/getMultipleMatches

ast-grep's `getMatch` and `getMultipleMatches` expect the metavariable name without `$` prefix (e.g. `'ARG'` not `'$ARG'`). The captures record keys still use the full pattern name (`$ARG`, `$$$ARGS`) for consumer convenience.
