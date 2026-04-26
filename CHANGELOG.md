# @zipbul/gildash

## 0.24.5

### Patch Changes

- [#111](https://github.com/zipbul/gildash/pull/111) [`2acaf8b`](https://github.com/zipbul/gildash/commit/2acaf8baf6fea54d7e3b583cfb91a6cacf9eee4f) Thanks [@parkrevil](https://github.com/parkrevil)! - chore: bump oxc-parser from 0.121.0 to 0.127.0

  Picks up upstream parser improvements between 0.122 and 0.127. Public API surface (`parseSync`, `ParserOptions`, `Program`, `Comment`, `OxcError`, `EcmaScriptModule`) is unchanged — the only `BREAKING` entry in the range is in the Rust `oxc_span` crate (string type re-exports) and does not affect the NAPI binding consumed here. Notable upstream changes: NAPI raw-transfer deserializer now uses `Int32Array` (parsing throughput improvement), `turbopack` magic comment support, additional TS diagnostic codes, and pure comment marking fixes.

## 0.24.4

### Patch Changes

- [#109](https://github.com/zipbul/gildash/pull/109) [`8a1fe51`](https://github.com/zipbul/gildash/commit/8a1fe51dc9f2776530944a8db62b77026491f5e4) Thanks [@parkrevil](https://github.com/parkrevil)! - fix: replace fs.promises.glob with Bun.Glob.scan({ followSymlinks: false })

  Fixes ELOOP (too many symbolic links) error in monorepos with Bun workspace symlinks. Both file-indexer and project-discovery now use `Bun.Glob.scan` with `followSymlinks: false`, preventing infinite symlink cycle traversal. This also aligns with the project's Bun-first convention.

## 0.24.3

### Patch Changes

- [#107](https://github.com/zipbul/gildash/pull/107) [`ea1f929`](https://github.com/zipbul/gildash/commit/ea1f929f6f7cd2bded0d962d97dfaaf2b41ac753) Thanks [@parkrevil](https://github.com/parkrevil)! - fix: heartbeat timer checks ctx.closed before DB access

  Prevents "Database is not open" error caused by race condition between close() and heartbeat timer during owner promotion.

## 0.24.2

### Patch Changes

- [#104](https://github.com/zipbul/gildash/pull/104) [`ad864b9`](https://github.com/zipbul/gildash/commit/ad864b93a477fcf74903cc616e124a25e11e4080) Thanks [@parkrevil](https://github.com/parkrevil)! - perf: semantic layer cleanup — eliminate redundant getProgram/getChecker calls, add snapshot caching, use tsc getTokenAtPosition

  - All semantic layer methods now call `getProgram()` once and derive TypeChecker from it directly via `program.getTypeChecker()`, instead of calling `getChecker()` which redundantly invoked `getProgram()` a second time
  - Fix `isAssignableTo` where checker and program could originate from different Program instances due to reversed call order
  - `LanguageServiceHost.getScriptSnapshot` now caches snapshots for tracked files (keyed by path:version) and non-tracked files (lib.d.ts, node_modules), eliminating redundant `ScriptSnapshot.fromString` allocations and `fs.readFileSync` calls on Program rebuilds
  - Replace custom `findNodeAtPosition` DFS traversal with tsc's internal `getTokenAtPosition` for faster node lookup

## 0.24.1

### Patch Changes

- [#102](https://github.com/zipbul/gildash/pull/102) [`e5298cd`](https://github.com/zipbul/gildash/commit/e5298cdfc0c01bc3f80f85d2ba3d31bb1690a4a7) Thanks [@parkrevil](https://github.com/parkrevil)! - fix: strip $ prefix when calling ast-grep getMatch/getMultipleMatches

  ast-grep's `getMatch` and `getMultipleMatches` expect the metavariable name without `$` prefix (e.g. `'ARG'` not `'$ARG'`). The captures record keys still use the full pattern name (`$ARG`, `$$$ARGS`) for consumer convenience.

## 0.24.0

### Minor Changes

- [#100](https://github.com/zipbul/gildash/pull/100) [`56cfc9b`](https://github.com/zipbul/gildash/commit/56cfc9bde607f561d6d8922baea28f1e6cabe671) Thanks [@parkrevil](https://github.com/parkrevil)! - feat: add column and byte offset to PatternMatch and PatternCapture

  - `PatternMatch` and `PatternCapture` now include `startColumn`, `endColumn` (0-based), `startOffset`, `endOffset` (byte offset)
  - Enables precise byte-level source text slicing: `sourceText.slice(capture.startOffset, capture.endOffset)`
  - Data was already available from ast-grep's `Pos.index` and `Pos.column` but was previously discarded

## 0.23.0

### Minor Changes

- [#98](https://github.com/zipbul/gildash/pull/98) [`627a87e`](https://github.com/zipbul/gildash/commit/627a87e10c0d46383151bec5aebd4985b4397341) Thanks [@parkrevil](https://github.com/parkrevil)! - feat: resolve optional chaining and computed string members, add ExpressionFunction.parameters

  - `ChainExpression` (optional chaining `a?.b`, `fn?.()`) now unwrapped to inner expression instead of returning `unresolvable`
  - Computed member access with string literal key (`a['key']`) now resolved to `ExpressionMember` instead of `unresolvable`
  - `ExpressionFunction.parameters` now populated with `Parameter[]` including name, type, typeImportSource, and decorators

## 0.22.1

### Patch Changes

- [#96](https://github.com/zipbul/gildash/pull/96) [`697ea9b`](https://github.com/zipbul/gildash/commit/697ea9b57397c1a2f6f9fb01dd27ee27390b149a) Thanks [@parkrevil](https://github.com/parkrevil)! - fix: extract method decorators and fix parameter decorator source location

  - Method/abstract method decorators were not extracted in `extractClassMembers` — now populated
  - `TSParameterProperty` decorators were read from `tsp.parameter.decorators` (always empty) instead of `tsp.decorators` — fixed
  - Add `Parameter.typeImportSource` for import specifier of the parameter's type annotation

## 0.22.0

### Minor Changes

- [#94](https://github.com/zipbul/gildash/pull/94) [`92525ea`](https://github.com/zipbul/gildash/commit/92525ea61b6a624188f63b9e5c227a1f13d1ae28) Thanks [@parkrevil](https://github.com/parkrevil)! - feat: export parseSource, extractSymbols, extractRelations from main entrypoint

  These standalone functions were implemented internally but not exported, preventing per-file parse/extract without a Gildash instance.

## 0.21.0

### Minor Changes

- [#92](https://github.com/zipbul/gildash/pull/92) [`aadda71`](https://github.com/zipbul/gildash/commit/aadda713b2118b6bbdbeaa026275573886fa0ad5) Thanks [@parkrevil](https://github.com/parkrevil)! - feat: add importSource to ExpressionValue identifier/member/call/new

  - `ExpressionIdentifier` gains `importSource?: string` and `originalName?: string`
  - `ExpressionMember` gains `importSource?: string` (resolved from the object's root identifier)
  - `ExpressionCall` gains `importSource?: string` (resolved from the callee)
  - `ExpressionNew` gains `importSource?: string` (resolved from the callee)
  - Import source is the raw module specifier from `staticImports` (e.g. `'./my.service'`, `'@zipbul/http-adapter'`), not a resolved file path
  - Non-breaking: all new fields are optional

## 0.20.0

### Minor Changes

- [#90](https://github.com/zipbul/gildash/pull/90) [`175be7b`](https://github.com/zipbul/gildash/commit/175be7b15be18ccad5e01a89389575f0a4ed0649) Thanks [@parkrevil](https://github.com/parkrevil)! - feat: structured expression values, enum/property initializers, and pattern captures

  ### Breaking Changes

  - `Decorator.arguments` type changed from `string[]` to `ExpressionValue[]`. Decorator arguments are now recursively structured instead of raw source text.

  ### New Features

  - **`ExpressionValue` type** — discriminated union (13 kinds) for structured representation of JS/TS expressions: `string`, `number`, `boolean`, `null`, `undefined`, `identifier`, `member`, `call`, `new`, `object`, `array`, `spread`, `function`, `template`, `unresolvable`. Recursive with depth limit of 8.
  - **Enum member initializers** — `ExtractedSymbol.initializer` now populated for enum members (e.g. `Get = 'GET'` → `{ kind: 'string', value: 'GET' }`).
  - **Class property type annotations** — `returnType` now populated for class properties, consistent with interface properties.
  - **Class property initializers** — `initializer` populated for class properties with default values.
  - **Class property decorators** — decorators on class properties now extracted and stored in `detailJson`.
  - **Variable initializers** — non-function variable initializers stored as `ExpressionValue` (e.g. `const cfg = defineModule({...})` → structured call expression).
  - **Pattern match captures** — `PatternMatch.captures` returns named metavariable captures (`$NAME`, `$$$NAME`) from ast-grep patterns, with text and line positions.

## 0.19.1

### Patch Changes

- [#88](https://github.com/zipbul/gildash/pull/88) [`ca1261b`](https://github.com/zipbul/gildash/commit/ca1261b11f03f69a7eafaea5272bbbf1bcf751d6) Thanks [@parkrevil](https://github.com/parkrevil)! - perf: cache probe file across type assignability calls

  - Probe file for `isTypeAssignableToType` / `isTypeAssignableToTypeAtPositions` is now retained between calls with the same target type expression, eliminating redundant Program recompiles.
  - 50 files with same target type: 2,491ms → 42ms (59x). Single calls also benefit automatically.
  - Probe is cleaned up on `dispose()` or when the target type expression changes.

## 0.19.0

### Minor Changes

- [#86](https://github.com/zipbul/gildash/pull/86) [`9aafd06`](https://github.com/zipbul/gildash/commit/9aafd06e69ca742d23740e332b907b35e847d1a3) Thanks [@parkrevil](https://github.com/parkrevil)! - feat: add `isTypeAssignableToTypeAtPositions` batch API

  - Check type assignability for multiple positions against a single target type expression in one call.
  - Probe file injection/removal happens once instead of per-position, eliminating repeated Program recompile.
  - 50 positions: 2,293ms → 54ms (42x speedup).

## 0.18.0

### Minor Changes

- [#84](https://github.com/zipbul/gildash/pull/84) [`085d38f`](https://github.com/zipbul/gildash/commit/085d38f0b4cd34f7b9c2f0c7e523a1ae85cfaf31) Thanks [@parkrevil](https://github.com/parkrevil)! - feat: index namespace members as individual symbols

  - TS namespace exported members (`export function`, `export const`, etc.) are now extracted as `members` on the namespace symbol, matching the existing enum member pattern.
  - `getSymbolsByFile` returns `Guards.isString` (kind: function, memberName: isString) as individual rows, enabling unused namespace member detection.

## 0.17.5

### Patch Changes

- [#82](https://github.com/zipbul/gildash/pull/82) [`eccbf4d`](https://github.com/zipbul/gildash/commit/eccbf4d4ac66a49893d3dfa1160121dcf473c08e) Thanks [@parkrevil](https://github.com/parkrevil)! - revert: restore type re-exports as `type-references` classification

  - Reverts #80. `export type { X } from './mod'` is again classified as `type-references` with `meta.isReExport: true`, not `re-exports`.
  - The original classification was consistent: all type-only operations → `type-references`. The change broke this by reclassifying only type re-exports while leaving type imports unchanged.
  - The dependency graph already queries `type-references`, so type re-exports were never missing from the graph.

## 0.17.4

### Patch Changes

- [#80](https://github.com/zipbul/gildash/pull/80) [`59a648d`](https://github.com/zipbul/gildash/commit/59a648d361014739d3ec99ce01b4a954612acf76) Thanks [@parkrevil](https://github.com/parkrevil)! - fix: classify type re-exports as `re-exports` instead of `type-references`

  - `export type { X } from './mod'` now produces `type: 're-exports'` with `meta.isType: true`, instead of `type: 'type-references'`.
  - Ensures `searchRelations({ type: 're-exports' })` and dependency graph include type re-exports, enabling dead type re-export detection.

## 0.17.3

### Patch Changes

- [#78](https://github.com/zipbul/gildash/pull/78) [`a7b4bf0`](https://github.com/zipbul/gildash/commit/a7b4bf03e94b8dccf89ef9a2c3feaa837bae8cd9) Thanks [@parkrevil](https://github.com/parkrevil)! - fix: preserve symbol names in named re-export relations

  - `export { X } from './mod'` and `export type { X } from './mod'` now set `dstSymbolName` to the original name and `srcSymbolName` to the exported name, instead of both being `null`.
  - Applies to both oxc module metadata and AST fallback extraction paths.

## 0.17.2

### Patch Changes

- [#76](https://github.com/zipbul/gildash/pull/76) [`c854d53`](https://github.com/zipbul/gildash/commit/c854d53b8d6a4d286247cbd7af8ee24645ec2c5e) Thanks [@parkrevil](https://github.com/parkrevil)! - fix: resolve imports with dotted filenames (e.g. `scan.usecase`)

  - `extname()` misidentified non-TS extensions like `.usecase`, `.controller`, `.service` as real extensions, skipping TypeScript candidate generation.
  - Now only recognized TS/JS extensions (`.ts`, `.mts`, `.cts`, `.d.ts`, `.js`, `.mjs`, `.cjs`) are treated as known; all others trigger candidate generation (`.ts`, `.d.ts`, `/index.ts`, etc.).

## 0.17.1

### Patch Changes

- [#74](https://github.com/zipbul/gildash/pull/74) [`b74e875`](https://github.com/zipbul/gildash/commit/b74e8758601f80b5ac11573f948eb056ee773a36) Thanks [@parkrevil](https://github.com/parkrevil)! - perf: memoize buildResolvedType to eliminate exponential re-traversal

  - Add per-invocation `Map<ts.Type, ResolvedType>` cache to `buildResolvedType`, preventing the same `ts.Type` object from being recursively expanded multiple times within a single API call.
  - Eliminates diamond-pattern re-traversal where shared property types (e.g. `GildashContext` with 44 properties) caused 11,000+ recursive calls per position.
  - `getResolvedTypesAtPositions` batch: 652ms → 111ms (5.9x). `getFileTypes`: 1,268ms → 525ms (2.4x). Measured on 150 files × 20 bindings.

## 0.17.0

### Minor Changes

- [#72](https://github.com/zipbul/gildash/pull/72) [`09292eb`](https://github.com/zipbul/gildash/commit/09292eb26ac7c377816ce08793ab541e704bce82) Thanks [@parkrevil](https://github.com/parkrevil)! - feat: add `getResolvedTypesAtPositions` batch API

  - Add `getResolvedTypesAtPositions(filePath, positions)` to resolve types at multiple byte offsets in a single file with one Program/TypeChecker/SourceFile lookup, reducing per-call overhead when querying many positions in the same file.

## 0.16.2

### Patch Changes

- [#70](https://github.com/zipbul/gildash/pull/70) [`64f2ed8`](https://github.com/zipbul/gildash/commit/64f2ed8c3a4ff13ab71769d82391aa63ca96c71a) Thanks [@parkrevil](https://github.com/parkrevil)! - fix: correct PID recycling false positive, span precision for multi-declarator exports and destructuring, project key desync on boundary refresh

  - Fix PID recycling check in `acquireWatcherRole`: the condition `owner.pid !== pid` was always true for reader processes, causing any reader with `instanceId` to immediately take over from a healthy owner. Changed to `owner.pid === pid` so recycling detection only fires when the OS actually recycled the PID to the calling process. This restores the single-writer guarantee for multi-process deployments.
  - Fix `ExportNamedDeclaration` handler: stop overwriting individual declarator spans with the parent export statement span for multi-declarator exports (`export const a = …, b = …`). Each symbol now retains its precise source position in the database.
  - Fix `collectBindingNames`: return `{name, start, end}` instead of bare strings so each destructured variable (`const { a, b } = x`) gets its own identifier span instead of sharing the pattern's span.
  - Fix project key desync on `package.json` name change: trigger `fullIndex` (like `tsconfig.json`) and propagate updated boundaries to `GildashContext` via `onBoundariesChanged` callback, preventing stale query results and orphaned records.

- [#70](https://github.com/zipbul/gildash/pull/70) [`64f2ed8`](https://github.com/zipbul/gildash/commit/64f2ed8c3a4ff13ab71769d82391aa63ca96c71a) Thanks [@parkrevil](https://github.com/parkrevil)! - fix: deduplicate movedSymbols in incremental indexing, add integration tests

  - Fix duplicate entries in `IndexResult.movedSymbols` during incremental indexing. The `deletedSymbols` loop and `renameResult.removed` loop could both match the same symbol by fingerprint, producing duplicates and redundant `retargetRelations` calls.
  - Add `test/incremental.test.ts` (21 integration tests) covering: incremental rename/move detection with real files, changelog recording for rename/move, monorepo cross-project relation indexing, external import (`isExternal`/`specifier`) indexing, and Gildash facade-level search for external/cross-project relations.

## 0.16.1

### Patch Changes

- [#68](https://github.com/zipbul/gildash/pull/68) [`00202dd`](https://github.com/zipbul/gildash/commit/00202dd043a1b74232bd3db20864f4facf14acec) Thanks [@parkrevil](https://github.com/parkrevil)! - fix: deduplicate movedSymbols in incremental indexing, add integration tests

  - Fix duplicate entries in `IndexResult.movedSymbols` during incremental indexing. The `deletedSymbols` loop and `renameResult.removed` loop could both match the same symbol by fingerprint, producing duplicates and redundant `retargetRelations` calls.
  - Add `test/incremental.test.ts` (21 integration tests) covering: incremental rename/move detection with real files, changelog recording for rename/move, monorepo cross-project relation indexing, external import (`isExternal`/`specifier`) indexing, and Gildash facade-level search for external/cross-project relations.

## 0.16.0

### Minor Changes

- [#66](https://github.com/zipbul/gildash/pull/66) [`f5abc35`](https://github.com/zipbul/gildash/commit/f5abc35628de37520841ed833d4321e520aa8a66) Thanks [@parkrevil](https://github.com/parkrevil)! - feat: expose normalizePath, add isExternal/specifier to StoredCodeRelation, document forward slash path guarantee

  **New exports**

  - `normalizePath` is now re-exported from the top-level barrel. Consumers can `import { normalizePath } from '@zipbul/gildash'` instead of reaching into internal paths.

  **StoredCodeRelation**

  - Add `isExternal: boolean` — `true` when the relation targets an external (bare specifier) package. Previously only available as a query filter; now included in every result so consumers can classify relations from a single query.
  - Add `specifier: string | null` — the raw import specifier string (e.g. `'lodash'`, `'./missing'`). `null` when the import was resolved to a file. Previously only accessible via `(rel as any).specifier`.

  **Path guarantee**

  - All file paths returned by gildash APIs (`filePath`, `srcFilePath`, `dstFilePath`, `originalFilePath`, etc.) use forward slash (`/`) as separator, regardless of platform. This is now explicitly documented in the `Gildash` class JSDoc.

  **Breaking**

  - `StoredCodeRelation.specifier` changed from `string | undefined` (inherited from `CodeRelation`, field absent when resolved) to `string | null` (always present, `null` when resolved). Update checks from `rel.specifier !== undefined` to `rel.specifier !== null`, or use a truthy check (`if (rel.specifier)`).

## 0.15.1

### Patch Changes

- [`da2dbb7`](https://github.com/zipbul/gildash/commit/da2dbb7df0a3307fd609d6107abfa1913159cd9c) Thanks [@parkrevil](https://github.com/parkrevil)! - fix: export missing public types and add JSDoc to all facade methods

  - Export `BatchParseResult`, `ExtractedSymbol`, `FileChangeEvent` from barrel
  - Add `'namespace'` to `SymbolKind` JSDoc
  - Change `Gildash.open()` to accept `Partial<GildashInternalOptions>` (no longer leaks internal type as required)
  - Remove unused `PatternSearchOptions` from barrel export
  - Simplify `searchAllSymbols` query type (remove redundant `Omit` wrapper)
  - Add `@param`, `@returns`, `@throws` JSDoc to all 38 public facade methods

## 0.15.0

### Minor Changes

- [#63](https://github.com/zipbul/gildash/pull/63) [`060fe58`](https://github.com/zipbul/gildash/commit/060fe58cfb8a1c90b3bf7e8306da82e2a8b66a99) Thanks [@parkrevil](https://github.com/parkrevil)! - feat: oxc infrastructure overhaul, import/export extraction improvements, symbol extraction fixes

  **Breaking**

  - `searchSymbols`, `searchRelations`, `searchAnnotations` now return unlimited results when `limit` is omitted (previously defaulted to 100/500). Set explicit `limit` if you relied on the default cap.
  - `SymbolKind` adds `'namespace'`. Update exhaustive matches accordingly.
  - Re-export relations changed from 1 per statement to 1 per specifier. `metaJson.specifiers` now always contains a single element.

  **Import/export extraction**

  - Refactor imports-extractor to use `module.staticImports`/`staticExports` for static analysis (AST fallback preserved)
  - Track external imports with `specifier` field and `isExternal` meta on unresolved bare specifiers
  - Track unresolved relative imports with `isUnresolved` meta
  - Track `require()` and `require.resolve()` calls with `isRequire`/`isRequireResolve` meta
  - Detect indirect re-export patterns: `import { X } from './a'; export { X }` and `import X from './a'; export default X`
  - Capture namespace alias on `export * as ns from './mod'` in `dstSymbolName` and `namespaceAlias` meta
  - Classify per-specifier type annotations in `export { type T, value } from './mod'` as separate `type-references` vs `re-exports` relations

  **Symbol extraction**

  - Fix `export default <identifier>` not marking the referenced variable as exported
  - Fix nested destructuring extracting key names instead of binding names (e.g. `const { a: { b: c } } = x` now extracts `c`, not `a`)
  - Extract `namespace`, `declare namespace`, and `declare module "name"` as `kind: 'namespace'` with `declare` modifier

  **tsconfig**

  - `loadTsconfigPaths()` follows `extends` chains recursively (maxDepth=5), inheriting `baseUrl`/`paths` from parent configs

  **Semantic layer**

  - Add `SymbolDetail` type and `getBaseTypes()` facade method
  - Expand public utility exports from semantic layer

  **Infrastructure**

  - Upgrade oxc-parser 0.115.0 → 0.121.0 with `preserveParens: false` (~25% AST node reduction)
  - Replace custom AST traversal with oxc-parser `Visitor` and oxc-walker `walk()`
  - Replace custom `OxcNode` types with `@oxc-project/types` ESTree types
  - Re-export oxc types (`Program`, `Node`, `Visitor`, `visitorKeys`) for consumers
  - DB migration 0008: `specifier` and `is_external` columns for external import storage
  - Add `normalizePath` utility for forward-slash path normalization
  - Add SQLite index verification and CI benchmark scripts
  - Add `FUTURE.md` — blocked/rejected feature decisions documentation

## 0.14.0

### Minor Changes

- [#61](https://github.com/zipbul/gildash/pull/61) [`f2550d3`](https://github.com/zipbul/gildash/commit/f2550d3c10e794f8692d967c988ebefe69c322a5) Thanks [@parkrevil](https://github.com/parkrevil)! - feat: handle export specifiers and add memberName to SymbolSearchResult

  - Fix `export { name }` specifiers marking symbols as `isExported: true`
  - Add `memberName` field to `SymbolSearchResult` for unqualified member name access
  - Remove deprecated `gildashError()` factory function (use `new GildashError()` directly)
  - Add 72 test cases covering annotation-api, changelog-api, modifiers, relation types, edge cases, and batch boundaries

## 0.13.0

### Minor Changes

- [#59](https://github.com/zipbul/gildash/pull/59) [`8096461`](https://github.com/zipbul/gildash/commit/8096461835f7fa2d8f28f819c2af5a273d1c9213) Thanks [@parkrevil](https://github.com/parkrevil)! - feat: add preEmit option to getSemanticDiagnostics

  `getSemanticDiagnostics(filePath, { preEmit: true })` now uses `ts.getPreEmitDiagnostics()` which includes syntactic, semantic, and declaration diagnostics — equivalent to `tsc --noEmit`. This allows consumers to use a single tsc Program managed by gildash instead of creating a separate one for full diagnostics.

## 0.12.2

### Patch Changes

- [#57](https://github.com/zipbul/gildash/pull/57) [`ccd07fd`](https://github.com/zipbul/gildash/commit/ccd07fd6c27b8d88aa63be8b834f53c22ae301d0) Thanks [@parkrevil](https://github.com/parkrevil)! - fix: index function overload signatures consistently with method overloads

  TSDeclareFunction nodes (function overload signatures) are now extracted as separate symbols, matching the existing behavior for method overloads in classes. Previously only the implementation signature was indexed for functions.

## 0.12.1

### Patch Changes

- [#55](https://github.com/zipbul/gildash/pull/55) [`06c93f5`](https://github.com/zipbul/gildash/commit/06c93f598a08992f21b83c1228b8287b2237866d) Thanks [@parkrevil](https://github.com/parkrevil)! - feat: add anyConstituent option to isTypeAssignableToType

  `isTypeAssignableToType(file, pos, target, { anyConstituent: true })` checks if any member of a union type is assignable to the target, instead of requiring the entire union to be assignable. For non-union types, behavior is unchanged.

## 0.12.0

### Minor Changes

- [#52](https://github.com/zipbul/gildash/pull/52) [`017f073`](https://github.com/zipbul/gildash/commit/017f073ddbea162d01aad2e91138f59bac876d34) Thanks [@parkrevil](https://github.com/parkrevil)! - feat: isTypeAssignableToType API, primitive keyword resolve, absolute path fix

  - Add `isTypeAssignableToType(filePath, position, targetTypeExpression)` — check assignability against type expression strings (e.g. `'PromiseLike<any>'`, `'Error'`)
  - Fix `getResolvedTypeAtPosition` to resolve primitive type keywords (`string`, `number`, `boolean`, etc.)
  - Fix `resolveSymbolPosition` to normalize absolute paths to relative before DB search

## 0.11.0

### Minor Changes

- [#50](https://github.com/zipbul/gildash/pull/50) [`d2ccd15`](https://github.com/zipbul/gildash/commit/d2ccd15bc3e5aa51011235f11b6d18470511e608) Thanks [@parkrevil](https://github.com/parkrevil)! - feat: public API extension — position-based semantic API, utility exposure, diagnostics, graph method, type fixes

  - Add position-based semantic API: `getResolvedTypeAtPosition`, `getSemanticReferencesAtPosition`, `getImplementationsAtPosition`, `isTypeAssignableToAtPosition`
  - Expose internal utilities: `lineColumnToPosition`, `findNamePosition`, `getSymbolNode`
  - Add `getSemanticDiagnostics` for tsc diagnostics on indexed files
  - Add `getTransitiveDependents` to facade (was only on DependencyGraph)
  - Narrow `searchRelations` / `searchAllRelations` / `getInternalRelations` return type to `StoredCodeRelation[]`
  - Export `SymbolNode` and `SemanticDiagnostic` types
  - Delete redundant `src/gildash.spec.ts` (251 tests migrated to module-level specs)

## 0.10.0

### Minor Changes

- [#48](https://github.com/zipbul/gildash/pull/48) [`22f7598`](https://github.com/zipbul/gildash/commit/22f75980b69201f3cde17c27e6d69e7826b2efa3) Thanks [@parkrevil](https://github.com/parkrevil)! - ### IndexResult completeness

  - **changedSymbols.isExported**: Added `isExported: boolean` to all `changedSymbols` entries (added/modified/removed). Expanded modified detection to include `isExported` and `structuralFingerprint` changes — return type, decorator, heritage, and export status modifications are now reported.

  - **changedRelations**: New field tracking relation-level diff (added/removed) per indexing cycle. Identity includes `metaJsonHash` to detect re-export specifier changes. Output includes `dstProject` and `metaJson`.

  - **renamedSymbols / movedSymbols**: New fields exposing rename and move detection results that were previously filtered from `changedSymbols` and only available via the changelog.

  ### Search API

  - **RelationSearchQuery pattern matching**: Added `srcFilePathPattern` and `dstFilePathPattern` glob fields for file path filtering via `Bun.Glob`. Mutually exclusive with exact path fields.

  ### Semantic API

  - **isTypeAssignableTo**: Exposes `tsc TypeChecker.isTypeAssignableTo` as a public API. Symbol-name-based (with DB lookup) and position-based (`isTypeAssignableToAt`) variants.

  - **getFileTypes**: Bulk type collection for all declarations in a file.

  - **getResolvedTypeAt**: Position-based type resolution without DB round-trip.

## 0.9.4

### Patch Changes

- [#46](https://github.com/zipbul/gildash/pull/46) [`af54c73`](https://github.com/zipbul/gildash/commit/af54c73ed3ebcea6a97fdbfea9616c265187d3ec) Thanks [@parkrevil](https://github.com/parkrevil)! - docs: document ResolvedType tree structure guarantee in JSDoc

  - Add tree structure guarantee JSDoc to `ResolvedType` interface and `Gildash.getResolvedType()` — returned value is always a bounded, finite, acyclic tree
  - Extract magic number depth limit into `MAX_TYPE_DEPTH` named constant in `type-collector.ts`

## 0.9.3

### Patch Changes

- [#44](https://github.com/zipbul/gildash/pull/44) [`a61adc7`](https://github.com/zipbul/gildash/commit/a61adc7ea4219799ecdc6f708f7a17100d6e848d) Thanks [@parkrevil](https://github.com/parkrevil)! - Remove upgrading section from READMEs — migration history is in CHANGELOG.md

## 0.9.2

### Patch Changes

- [`9465b98`](https://github.com/zipbul/gildash/commit/9465b98da1bc796f2927c28c947cf0633bb5907b) Thanks [@parkrevil](https://github.com/parkrevil)! - Fix FTS query crashes and regex search result loss

  - Fix `searchByQuery` with `regex` option returning empty array when regex matches fewer results than `limit` but total records exceed `limit * 100`
  - Fix `searchAnnotations` crashing with SQLite FTS5 syntax error when `text` is whitespace-only
  - Fix `toFtsPrefixQuery` passing null bytes to SQLite, causing "unterminated string" error on both symbol and annotation search

## 0.9.1

### Patch Changes

- [#40](https://github.com/zipbul/gildash/pull/40) [`7bba9c1`](https://github.com/zipbul/gildash/commit/7bba9c1c9d6acbe54eaccd94007d765ff8b5e3e1) Thanks [@parkrevil](https://github.com/parkrevil)! - fix: hardening and performance improvements

  - fix(lifecycle): update ctx.role on reader-to-owner promotion and clean up heartbeat timer + release watcher role on rollback
  - fix(indexer): track file read failures in fullIndex path via allFailedFiles
  - fix(parse-api): getParsedAst now throws GildashError('closed') when instance is closed
  - fix(store): searchByQuery with invalid regex throws GildashError('validation') instead of returning []
  - fix(gildash): standardize closed error messages across annotation-api and changelog-api
  - perf(store): batch INSERT for symbol, annotation, and changelog repositories
  - perf(extractor): binary search for JSDoc comment association in extractSymbols
  - perf(store): progressive regex fetch strategy replacing fixed 5000-row over-fetch
  - perf(parser): push+reverse instead of O(n^2) unshift in getQualifiedName
  - refactor(store): extract registerRegexpUdf helper, remove dead query() method
  - refactor(search): remove unnecessary async/await in dependency-graph.spec.ts
  - refactor(semantic): use Set for rootFileNames in TscLanguageServiceHost

## 0.9.0

### Minor Changes

- [#38](https://github.com/zipbul/gildash/pull/38) [`f6b59cf`](https://github.com/zipbul/gildash/commit/f6b59cf32048df82224780ea3ad4eb8abe47d270) Thanks [@parkrevil](https://github.com/parkrevil)! - Add annotation extraction system and symbol changelog tracking

  - Generic comment annotation extraction (`@tag value`) from JSDoc, line, and block comments with automatic symbol linking
  - Annotation search via FTS5 (`searchAnnotations`)
  - Symbol changelog tracking with rename/move detection (`getSymbolChanges`, `pruneChangelog`)
  - Structural fingerprinting for rename detection across index runs
  - New migrations: `0006_annotations` and `0007_symbol_changelog`

## 0.8.2

### Patch Changes

- [`5f7a441`](https://github.com/zipbul/gildash/commit/5f7a441d40ee183da5ab5f69bdaaa08166e1d6eb) Thanks [@parkrevil](https://github.com/parkrevil)! - chore: remove sourcemap generation from build

## 0.8.1

### Patch Changes

- [`4ce58c5`](https://github.com/zipbul/gildash/commit/4ce58c595921bb563d7bea972efa6b36b36b271e) Thanks [@parkrevil](https://github.com/parkrevil)! - fix: ensure ResolvedType and SemanticReference types are included in published dist

## 0.8.0

### Minor Changes

- [#34](https://github.com/zipbul/gildash/pull/34) [`20d1ceb`](https://github.com/zipbul/gildash/commit/20d1ceb1a383cd4fb88ea67084858a043fb61f91) Thanks [@parkrevil](https://github.com/parkrevil)! - Implement all 13 recommendations from REPORT.md Section 8.

  ### Code Quality

  - Fix heartbeat timing gap: reduce healthcheck interval to 15s, stale threshold to 60s
  - Add TTL-based graph cache expiry for readers (15s)
  - Add incremental graph cache invalidation via `patchFiles()`
  - Fix silent `.catch(() => {})` in watcher→semantic file read errors
  - Prevent PID recycling race condition with UUID-based instance identification
  - **BREAKING**: `batchParse()` now returns `BatchParseResult` (with `parsed` + `failures`) instead of `Map<string, ParsedFile>`

  ### Performance

  - Add covering index on `relations(project, type, src_file_path)`
  - Chunk large batch file reads into groups of 50 to prevent EMFILE/OOM

  ### Features

  - Add event system: `onFileChanged()`, `onError()`, `onRoleChanged()`
  - Add `patchFiles()` method to `DependencyGraph` for incremental updates

  ### Testing

  - Add stress test suite (10,000 files)
  - Add chaos test suite (ownership contention, PID recycling)
  - Add property-based tests for graph algorithms (fast-check)
  - Add benchmark suite (indexing, search, graph operations)

## 0.7.0

### Minor Changes

- [#31](https://github.com/zipbul/gildash/pull/31) [`b4f50aa`](https://github.com/zipbul/gildash/commit/b4f50aa8ccb44243f4404078a436947556ce2464) Thanks [@parkrevil](https://github.com/parkrevil)! - Replace `Result<T, GildashError>` return types with direct returns and `GildashError` throws across all 34 public API methods.

  **Breaking changes:**

  - All public methods now return values directly and throw `GildashError` on failure (previously returned `Result<T, GildashError>`)
  - `@zipbul/result` is no longer a peer dependency (moved to internal dependency)
  - `GildashError` is now a class extending `Error` (previously a plain interface)
  - `getFullSymbol()`, `getFileInfo()`, `getResolvedType()` return `null` for "not found" (previously returned an error)
  - `resolveSymbol()` returns `{ circular: true }` for circular re-exports (previously returned an error)
  - `ResolvedSymbol` type has a new `circular: boolean` field

## 0.6.0

### Minor Changes

- [#29](https://github.com/zipbul/gildash/pull/29) [`f3a53f7`](https://github.com/zipbul/gildash/commit/f3a53f77c77510e06120c6b91e10cd724fb1cbd7) Thanks [@parkrevil](https://github.com/parkrevil)! - ### Semantic Layer (tsc TypeChecker integration)

  Enable tsc TypeChecker-based semantic analysis via `Gildash.open({ semantic: true })`.

  #### New APIs

  - `getResolvedType(symbolName, filePath)` — resolve the type of a symbol
  - `getSemanticReferences(symbolName, filePath)` — find all references to a symbol
  - `getImplementations(symbolName, filePath)` — find interface / abstract class implementations
  - `getSemanticModuleInterface(filePath)` — list module exports with resolved types
  - `getFullSymbol()` — automatically enriches result with `resolvedType` when semantic is enabled
  - `searchSymbols({ resolvedType })` — filter symbols by resolved type string

  #### Internal modules

  - `SemanticLayer` facade (manages tsc Program / TypeChecker / LanguageService)
  - `TscProgram` — tsconfig parsing + incremental update
  - `TypeCollector` — position / file-based type collection
  - `ReferenceResolver` — wraps tsc `findReferences`
  - `ImplementationFinder` — wraps tsc `findImplementations`
  - `SymbolGraph` — symbol node graph with LRU cache

  #### Characteristics

  - `semantic: false` (default): tsc is never loaded; existing behavior is 100% unchanged
  - `semantic: true` without a `tsconfig.json`: returns `GildashError`
  - Watcher mode: incremental updates are applied automatically on file changes

  ### Relation FK & cross-project support

  - `StoredCodeRelation` type: a `CodeRelation` enriched with `dstProject` (destination project identifier), returned by `searchRelations`, `searchAllRelations`, and `getInternalRelations`.
  - `RelationSearchQuery.dstProject` filter: narrow relation searches by destination project.
  - `DependencyGraph` accepts `additionalProjects` to build a cross-project import graph.

  ### Indexing stability

  - Two-pass indexing: `knownFiles` set populated before extraction prevents false "unresolved" markers on circular or forward references.
  - `node_modules` paths are now unconditionally excluded from indexing. The hard-coded filter in `detectChanges` cannot be overridden by `ignorePatterns`, and the default `ignorePatterns` includes `**/node_modules/**`.

  ### Removed

  - `indexExternalPackages()` API and `MakeExternalCoordinatorFn` type — external package indexing is no longer supported.
  - `resolveBareSpecifier()` utility — bare specifier resolution against `node_modules` is removed.

  ### Internal structure

  - `gildash.ts` façade decomposed into focused API modules (`extract-api`, `graph-api`, `lifecycle`, `misc-api`, `parse-api`, `query-api`, `semantic-api`) for maintainability.

## 0.5.1

### Patch Changes

- [#26](https://github.com/zipbul/gildash/pull/26) [`2df68d2`](https://github.com/zipbul/gildash/commit/2df68d2f608f60e675d3cbdedd7538465a8d03bd) Thanks [@parkrevil](https://github.com/parkrevil)! - ### Bug Fixes

  - **tsconfig.json JSONC parsing** — `SyntaxError: Failed to parse JSON` no longer occurs when `tsconfig.json` contains line comments (`//`), block comments (`/* */`), or trailing commas. Parsing now uses `Bun.JSONC.parse()`.

  - **`fullIndex()` FK constraint violation** — `SQLiteError: FOREIGN KEY constraint failed` no longer occurs on repeated calls to `fullIndex()`. Previously, all file records were deleted before re-inserting only the changed files, causing relations that referenced unchanged files to violate the foreign key constraint. Now only changed and deleted files are removed from the index; unchanged file records are preserved.

  ### Breaking Changes

  - **Data directory renamed from `.zipbul` to `.gildash`** — The SQLite database is now stored at `<projectRoot>/.gildash/gildash.db`. Any existing `.zipbul/` directory is **not** migrated automatically. On first run, a fresh database will be created at `.gildash/gildash.db`. If your application stored anything in `.zipbul/`, move or delete it manually.

## 0.5.0

### Minor Changes

- [#24](https://github.com/zipbul/gildash/pull/24) [`5b532ad`](https://github.com/zipbul/gildash/commit/5b532adee1f4cf29be7171485f9ea9ce65706e48) Thanks [@parkrevil](https://github.com/parkrevil)! - ### Breaking Changes

  - **Remove `getDeadExports` API** — This feature embedded project-specific policies (entry point definitions, build configuration, test file inclusion) that vary per consumer. Use `searchSymbols({ isExported: true })` + `searchRelations({ type: 'imports' })` to build custom dead-export detection in your own code.

  ### New Features

  - **Replace `getCyclePaths` algorithm with Tarjan SCC + Johnson's circuits** — The previous DFS-based implementation could miss cycles sharing common nodes. The new algorithm exhaustively detects every elementary circuit in the import graph. Use the `maxCycles` option to cap the number of returned cycles.
  - **Add `ParserOptions` passthrough to `parseSource` / `batchParse`** — Forward oxc-parser's `ParserOptions` (e.g. `sourceType`, `lang`) directly, allowing explicit control over parser behavior regardless of file extension.

  ### Chores

  - Upgrade `oxc-parser` from 0.114.0 to 0.115.0

## 0.5.0

### Breaking Changes

- **`getDeadExports` 제거** — `Gildash.getDeadExports(project?, opts?)` API가 삭제되었습니다. 이 기능은 진입점(entry point) 정의, 빌드 설정, 테스트 파일 포함 여부 등 프로젝트 정책에 따라 결과가 근본적으로 달라지므로 라이브러리 레벨의 단일 구현으로 제공하기 어렵습니다. 대신 `getImportGraph()` + `getDependents()`를 조합하여 프로젝트 정책에 맞는 dead export 탐지 로직을 직접 구현하세요.

### New Features

- **`getCyclePaths` — 완전한 순환 탐지 알고리즘 교체 (Tarjan SCC + Johnson's circuits)** — 이전 구현은 DFS 기반으로 대표 경로만 반환했습니다. 이번 버전부터 Tarjan SCC로 강연결 컴포넌트를 먼저 식별한 뒤, Johnson's algorithm으로 각 SCC 내의 모든 elementary circuit을 열거합니다. 중복 없는 정규화된 경로(사전순 최솟값 노드 기준 rotation) 전체를 반환하며, `maxCycles` 옵션으로 반환 개수를 제한할 수 있습니다.

- **`parseSource` / `batchParse` — `ParserOptions` passthrough** — `parseSource(filePath, source, options?)` 및 `batchParse(filePaths, options?)`에 `oxc-parser`의 `ParserOptions`를 직접 전달할 수 있습니다. `lang` 필드로 파서 언어(ts / tsx / js 등)를 명시적으로 지정할 수 있어, 파일 확장자와 실제 언어가 다른 경우나 JSX 지원이 필요한 파일 처리에 유용합니다.

### Chores

- `oxc-parser` 0.114.0 → 0.115.0

---

## 0.4.1

### Patch Changes

- [#22](https://github.com/zipbul/gildash/pull/22) [`764cff9`](https://github.com/zipbul/gildash/commit/764cff906ce8bd3eac4050722bb3c3f9a6f920de) Thanks [@parkrevil](https://github.com/parkrevil)! - FTS5 setup을 런타임 코드에서 Drizzle migration으로 이동

  ### Refactor

  - `FTS_SETUP_SQL` 상수를 `schema.ts`/`connection.ts`에서 제거하고 Drizzle SQL migration(`0002_fts_setup.sql`)으로 이동
  - FTS5 virtual table + INSERT/DELETE/UPDATE sync trigger를 migration에서 `IF NOT EXISTS`로 idempotent하게 생성

  ### Chore

  - `.npmignore` 제거 — `README.ko.md`를 npm 패키지에 포함

## 0.4.0

### Minor Changes

- [#20](https://github.com/zipbul/gildash/pull/20) [`fa7c001`](https://github.com/zipbul/gildash/commit/fa7c001d0145d062049e41b650754ab1566088a2) Thanks [@parkrevil](https://github.com/parkrevil)! - Firebat roadmap — new public APIs, structural pattern search, and infra improvements

  ### New Public APIs

  - `getDeadExports(project?, opts?)` — detect exported symbols never imported anywhere in the project
  - `getFullSymbol(name, filePath)` — retrieve full symbol detail including members, JSDoc, decorators, type parameters
  - `getFileStats(filePath)` — file-level statistics (line count, symbol count, relation count, size)
  - `getFanMetrics(filePath)` — import-graph fan-in / fan-out coupling metrics via `DependencyGraph`
  - `resolveSymbol(name, filePath)` — follow re-export chains to the original symbol definition
  - `findPattern(pattern, opts?)` — AST structural pattern search via `@ast-grep/napi`
  - `indexExternalPackages(packages)` — index `.d.ts` type declarations from `node_modules`
  - `getModuleInterface(filePath)` — public interface of a module (all exported symbols with metadata)
  - `getHeritageChain(name, filePath)` — recursive `extends`/`implements` tree traversal
  - `diffSymbols(before, after)` — snapshot diff of symbol search results (added/removed/modified)
  - `batchParse(filePaths)` — concurrent multi-file parsing
  - `getInternalRelations(filePath)` — intra-file relations query
  - `searchAllSymbols(query)` / `searchAllRelations(query)` — cross-project search (no project filter)
  - `searchSymbols({ regex })` — regex filter on symbol names
  - `searchSymbols({ decorator })` — decorator name filter via `json_each()`

  ### New Types & Exports

  - Export new interfaces: `SymbolDiff`, `ModuleInterface`, `HeritageNode`, `FullSymbol`, `FileStats`, `FanMetrics`, `ResolvedSymbol`
  - Export `patternSearch`, `PatternMatch`, `PatternSearchOptions` from `search/pattern-search`
  - Export `ParsedFile` from `parser/types`, `FileRecord` from `store/repositories/file.repository`
  - `IndexResult.changedSymbols` — symbol-level diff (added/modified/removed) per index cycle

  ### Infra & Extractor Improvements

  - `CodeRelation.type` union extended with `'type-references'` and `'re-exports'`
  - Import relations now emit one relation per specifier with `dstSymbolName` (enables dead-export detection and re-export resolution)
  - Re-export relations record named specifiers in `metaJson` (`{ local, exported }` per `ExportSpecifier`)
  - `metaJson` auto-parsed into `meta` field on `CodeRelation`
  - Full member detail objects stored in `detailJson` (visibility, kind, type, static, readonly)
  - New `lineCount` column on `files` table with SQL migration (`0001_add_line_count.sql`)

  ### Scan-only Mode

  - `watchMode: false` option — disables file watcher for CI/one-shot analysis
  - `close({ cleanup: true })` — delete database files after scan

  ### Performance

  - `DependencyGraph` internal caching — graph is built once per project key, invalidated on each index run

  ### Dependencies

  - Added `@ast-grep/napi` `^0.41.0` as runtime dependency
  - Added `oxc-parser` `>=0.114.0` as peer dependency

  ### Bug Fixes

  - Fix FK constraint violation in `fullIndex()` — split single-loop transaction into 2-pass (Pass 1: upsert all files, Pass 2: parse + index symbols/relations)
  - Fix `getFullSymbol()` query using incorrect field name (`exactName` → `{ text, exact: true }`)
  - Fix 5 TypeScript type errors across `gildash.ts`

## 0.3.1

### Patch Changes

- [#18](https://github.com/zipbul/gildash/pull/18) [`1d76d79`](https://github.com/zipbul/gildash/commit/1d76d794862f6780e00868409483f7d2965a8403) Thanks [@parkrevil](https://github.com/parkrevil)! - Update README with new API docs and exclude README.ko.md from npm package

## 0.3.0

### Minor Changes

- [#14](https://github.com/zipbul/gildash/pull/14) [`a93aecb`](https://github.com/zipbul/gildash/commit/a93aecbe60770f2b38a05e110ada59203effd7bf) Thanks [@parkrevil](https://github.com/parkrevil)! - Add public API extensions for AST cache sharing, file metadata, exact symbol search, and file-scoped symbol listing

  - `getParsedAst(filePath)`: retrieve cached oxc-parser AST from internal LRU cache
  - `getFileInfo(filePath, project?)`: query indexed file metadata (hash, mtime, size)
  - `searchSymbols({ text, exact: true })`: exact name match (in addition to existing FTS prefix)
  - `getSymbolsByFile(filePath, project?)`: convenience wrapper for file-scoped symbol listing
  - Re-export `ParsedFile` and `FileRecord` types
  - Add `oxc-parser` to peerDependencies

## 0.2.0

### Minor Changes

- [#12](https://github.com/zipbul/gildash/pull/12) [`57e961b`](https://github.com/zipbul/gildash/commit/57e961bdb719d5d30542418ed2494531e6251021) Thanks [@parkrevil](https://github.com/parkrevil)! - Export missing public API types and expose `role` getter

  - Re-export `IndexResult`, `ProjectBoundary`, `CodeRelation`, `SymbolStats`, `SymbolKind`, `WatcherRole` from the package entry point
  - Make `Gildash.role` property public (was `private readonly`, now `readonly`)

## 0.1.2

### Patch Changes

- [#10](https://github.com/zipbul/gildash/pull/10) [`b6c93c0`](https://github.com/zipbul/gildash/commit/b6c93c062f88e4c562eb110dba5ef8afade99f59) Thanks [@parkrevil](https://github.com/parkrevil)! - Re-publish as 0.1.2: versions 0.1.0 and 0.1.1 permanently blocked by npm after unpublish

## 0.1.1

### Patch Changes

- [#8](https://github.com/zipbul/gildash/pull/8) [`ae82ae0`](https://github.com/zipbul/gildash/commit/ae82ae0b9c28708dbe6678dfef18ad236bc0d2a1) Thanks [@parkrevil](https://github.com/parkrevil)! - Re-publish as 0.1.1: previous 0.1.0 publish attempt blocked by npm 24h re-publish restriction

## 0.1.0

### Minor Changes

- [#6](https://github.com/zipbul/gildash/pull/6) [`108b29c`](https://github.com/zipbul/gildash/commit/108b29c278c3080a6129eefe4e3fc53117b62510) Thanks [@parkrevil](https://github.com/parkrevil)! - Replace class-based error hierarchy with Result-based error handling

  ### Breaking Changes

  - All public API methods now return `Result<T, GildashError>` instead of throwing exceptions
  - `GildashError`, `StoreError`, `ParseError`, `WatcherError` classes removed
  - New `GildashError` interface + `gildashError()` factory + `GildashErrorType` union
  - `@zipbul/result` moved from `dependencies` to `peerDependencies`
  - Consumers must use `isErr()` from `@zipbul/result` to check for errors

  ### Changes

  - Add try-catch wrappers to all 8 Gildash public methods for SQLite throw conversion
  - Update all JSDoc with `@example` blocks showing `isErr()` usage
  - Fix tsc type errors: proper Result narrowing in all spec files
