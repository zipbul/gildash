---
"@zipbul/gildash": patch
---

feat: always preserve verbatim `specifier` on import / re-export / dynamic-import / require relations

Previously `CodeRelation.specifier` was populated only when the import path failed to resolve (`dstFilePath === null`). For successfully resolved relations — whether to a relative file, a tsconfig `paths` alias, or an external package — the original source-text specifier was discarded, leaving consumers to reverse-engineer it from `dstFilePath` (fragile under tsconfig aliases, package `exports` maps, and `/index` resolution).

`specifier` is now always set on any relation that originates from a module-source-bearing statement, regardless of resolution outcome:

| Source | Old `specifier` | New `specifier` |
|---|---|---|
| `import x from './foo'` (resolved) | absent | `'./foo'` |
| `import x from '@app/foo'` (resolved via tsconfig paths) | absent | `'@app/foo'` |
| `import x from 'react'` (resolved external) | `'react'` (already preserved) | `'react'` |
| `import x from './missing'` (unresolved) | `'./missing'` | `'./missing'` |
| `export { a } from './re'` (resolved) | absent | `'./re'` |
| `import('./dyn')` (resolved) | absent | `'./dyn'` |
| `require('./req')` (resolved) | absent | `'./req'` |

Behavior at the data-shape level is additive: relations that previously carried `specifier` continue to do so with the same value, no field disappears, no JSON shape is removed.

Note for query callers: relation lookups filtered on `specifier IS NOT NULL` (or equivalent) will return more rows than before — successfully resolved relations now also satisfy that predicate. If a consumer was using `specifier` presence as a *proxy for unresolution*, the correct signal is `dstFilePath === null` or `metaJson.isUnresolved === true`.

Transition note for existing indexes: relation rows written by previous releases retain `specifier = null` on resolved imports until the corresponding source file is re-indexed (next `fullIndex()` or next file-change incremental update). Queries during the transition window may see a mix of old-shape and new-shape rows; consumers needing immediate consistency should run a `fullIndex()`.

`CodeRelation.specifier` and `StoredCodeRelation.specifier` JSDoc updated to describe the always-on contract and the bare-re-export cross-reference case.
