---
"@zipbul/gildash": minor
---

feat: expose normalizePath, add isExternal/specifier to StoredCodeRelation, document forward slash path guarantee

**New exports**

- `normalizePath` is now re-exported from the top-level barrel. Consumers can `import { normalizePath } from '@zipbul/gildash'` instead of reaching into internal paths.

**StoredCodeRelation**

- Add `isExternal: boolean` — `true` when the relation targets an external (bare specifier) package. Previously only available as a query filter; now included in every result so consumers can classify relations from a single query.
- Add `specifier: string | null` — the raw import specifier string (e.g. `'lodash'`, `'./missing'`). `null` when the import was resolved to a file. Previously only accessible via `(rel as any).specifier`.

**Path guarantee**

- All file paths returned by gildash APIs (`filePath`, `srcFilePath`, `dstFilePath`, `originalFilePath`, etc.) use forward slash (`/`) as separator, regardless of platform. This is now explicitly documented in the `Gildash` class JSDoc.

**Breaking**

- `StoredCodeRelation.specifier` changed from `string | undefined` (inherited from `CodeRelation`, field absent when resolved) to `string | null` (always present, `null` when resolved). Update checks from `rel.specifier !== undefined` to `rel.specifier !== null`, or use a truthy check (`if (rel.specifier)`).
