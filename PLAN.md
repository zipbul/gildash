# PLAN — @zipbul/code-ledger

> **Status**: Draft v5.0 — 2026-02-18  
> **One-line definition**: Watch, parse, index, and search a codebase — shared infrastructure for static analysis tools.

---

## 1. Purpose

zipbul, firebat, and agent-kit all require the same capabilities: file change detection, TypeScript AST parsing, code symbol indexing, and code search. Duplicating these across packages wastes effort and OS resources when running simultaneously on the same project.

code-ledger is the **shared L0 foundation**. It owns the code infrastructure layer so every consumer imports code-ledger instead of reimplementing.

**code-ledger does NOT**:

- Start an MCP server or export MCP tool definitions.
- Depend on any consumer framework (zipbul, firebat, agent-kit).
- Provide a CLI entry point.

---

## 2. Fixed Paths

All code-ledger artifacts live under `{projectRoot}/.zipbul/`. There is no `cacheDir` option.

| Artifact | Path |
|---|---|
| SQLite database | `.zipbul/code-ledger.db` |
| WAL file | `.zipbul/code-ledger.db-wal` |
| SHM file | `.zipbul/code-ledger.db-shm` |

---

## 3. Configuration

```typescript
interface CodeLedgerOptions {
  /** Absolute path to the project root directory. Required. */
  projectRoot: string;

  /** Glob patterns to ignore during file watching. Default: see WATCHER_IGNORE_GLOBS. */
  ignorePatterns?: string[];

  /** File extensions to watch and index. Default: ['.ts', '.mts', '.cts']. */
  extensions?: string[];

  /** Maximum entries in the in-process AST LRU cache. Default: 500. */
  parseCacheCapacity?: number;
}
```

### 3.1 Project Detection Policy

code-ledger automatically discovers project boundaries from `package.json` files. No manual configuration required.

**Single repo**: One `package.json` at project root → `project = root package name`.

**Monorepo**: Multiple `package.json` files → each defines a project boundary.

```
/workspace/
├── apps/
│   ├── web/
│   │   ├── package.json     ← name: "@ws/web"     → project = '@ws/web'
│   │   └── src/App.ts       → this file's project = '@ws/web'
│   └── mobile/
│       ├── package.json     ← name: "@ws/mobile"  → project = '@ws/mobile'
│       └── src/index.ts
├── libs/
│   └── shared/
│       ├── package.json     ← name: "@ws/shared"  → project = '@ws/shared'
│       └── src/utils.ts
├── scripts/
│   └── deploy.ts            → nearest package.json = root → project = '@ws/root'
├── package.json             ← name: "@ws/root"    → root project
└── .zipbul/code-ledger.db   ← one DB for entire workspace
```

**Rule**: A file's `project` = the `name` field of the nearest ancestor `package.json`.

#### `discoverProjects(projectRoot: string): ProjectBoundary[]`

```typescript
interface ProjectBoundary {
  dir: string;       // Relative to projectRoot. e.g., 'apps/web'
  project: string;   // package.json name field. e.g., '@ws/web'
}
```

Algorithm:

```
1. Bun.Glob('**/package.json').scan(projectRoot, {
     onlyFiles: true,
     exclude: ['**/node_modules/**', '**/.git/**', '**/.zipbul/**', '**/dist/**']
   })
2. For each package.json:
   a. JSON.parse → extract name field.
   b. If name is missing → use directory basename.
   c. Create ProjectBoundary { dir: relativePath, project: name }.
3. Sort by dir length descending (deepest paths match first).
4. Return ProjectBoundary[].
```

#### `resolveFileProject(filePath: string, boundaries: ProjectBoundary[]): string`

`filePath` is **relative to projectRoot** (same coordinate system as `ProjectBoundary.dir`).

```
1. Iterate boundaries (deepest first):
   if filePath.startsWith(boundary.dir + '/') → return boundary.project
2. No match → return root project name (root package.json's name, or 'default').
```

**Cache invalidation**: When the watcher detects a `package.json` create/change/delete event, `discoverProjects()` re-runs and the boundary cache is replaced.

---

## 4. Error Handling Policy

**All errors are thrown. code-ledger never swallows errors silently.**

Each module defines its own error class extending a base `CodeLedgerError`. This enables consumers to catch errors by module.

```typescript
class CodeLedgerError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CodeLedgerError';
  }
}

class WatcherError extends CodeLedgerError { name = 'WatcherError'; }
class ParseError extends CodeLedgerError { name = 'ParseError'; }
class ExtractError extends CodeLedgerError { name = 'ExtractError'; }
class IndexError extends CodeLedgerError { name = 'IndexError'; }
class StoreError extends CodeLedgerError { name = 'StoreError'; }
class SearchError extends CodeLedgerError { name = 'SearchError'; }
```

Every `throw` wraps the original error via `{ cause: originalError }` so stack traces chain.

---

## 5. Directory Structure

```
src/
├── index.ts                          # Public API barrel re-export (CodeLedger, types).
├── code-ledger.ts                    # CodeLedger facade class.
├── errors.ts                         # CodeLedgerError + all subclass definitions.
│
├── watcher/
│   ├── index.ts                      # Re-export: ProjectWatcher.
│   ├── project-watcher.ts
│   └── types.ts
│
├── parser/
│   ├── index.ts                      # Re-export: parseSource, ParseCache, ast-utils, source-position.
│   ├── parse-source.ts
│   ├── parse-cache.ts
│   ├── ast-utils.ts
│   ├── jsdoc-parser.ts
│   ├── source-position.ts
│   └── types.ts
│
├── extractor/
│   ├── index.ts                      # Re-export: extractSymbols, extractRelations, all sub-extractors.
│   ├── symbol-extractor.ts
│   ├── relation-extractor.ts
│   ├── imports-extractor.ts
│   ├── calls-extractor.ts
│   ├── heritage-extractor.ts         # Merged extends + implements.
│   ├── extractor-utils.ts
│   └── types.ts
│
├── indexer/
│   ├── index.ts
│   ├── file-indexer.ts
│   ├── symbol-indexer.ts
│   ├── relation-indexer.ts
│   ├── index-coordinator.ts
│   └── types.ts
│
├── search/
│   ├── index.ts
│   ├── symbol-search.ts
│   ├── relation-search.ts
│   ├── dependency-graph.ts
│   └── types.ts
│
├── store/
│   ├── index.ts
│   ├── connection.ts
│   ├── schema.ts
│   ├── migrations/
│   └── repositories/
│       ├── file.repository.ts
│       ├── symbol.repository.ts
│       └── relation.repository.ts
│
└── common/
    ├── index.ts
    ├── hasher.ts
    ├── path-utils.ts
    ├── project-discovery.ts          # discoverProjects, resolveFileProject.
    ├── tsconfig-resolver.ts          # loadTsconfigPaths, TsconfigPaths.
    ├── lru-cache.ts
    └── types.ts
```

---

## 6. Module Internal Dependency Graph

```
common ← (no internal deps)
errors ← (no internal deps)

store ← common, errors
parser ← common, errors
extractor ← parser, common, errors
search ← store, common, errors
watcher ← common, errors
indexer ← watcher, parser, extractor, store, common, errors
code-ledger (facade) ← indexer, search, watcher, store, parser, extractor, common, errors
```

No circular dependencies. `common` and `errors` are leaves. `code-ledger` (facade) is the root that composes all modules. `indexer` is the internal orchestration module.

---

## 7. Design Decision: Function vs Class

**Rule**: Pure transformation = function. Resource lifecycle / mutable state = class.

| Symbol | Kind | Rationale |
|---|---|---|
| `parseSource()` | function | Stateless. `(filePath, sourceText) → ParsedFile`. |
| `parseJsDoc()` | function | Stateless. `(commentText) → JsDocBlock`. Wraps comment-parser. |
| `extractSymbols()` | function | Stateless. `(parsedFile) → ExtractedSymbol[]`. |
| `extractRelations()` | function | Stateless. `(ast, filePath, tsconfigPaths?) → CodeRelation[]`. |
| `resolveImport()` | function | Stateless. `(currentFilePath, importPath, tsconfigPaths?) → string \| null`. Pure string resolution. |
| `loadTsconfigPaths()` | function | Stateless I/O. `(projectRoot) → TsconfigPaths \| null`. Reads file, returns data. Caching is caller's responsibility. |
| `buildImportMap()` | function | Stateless. `(ast, currentFilePath, tsconfigPaths?) → Map`. |
| `symbolSearch()` | function | Receives repository as argument. No owned state. |
| `relationSearch()` | function | Same. |
| AST utils (`visit`, `collectNodes`, etc.) | function | Utility. No state. |
| `hashString()` | function | Stateless transform. |
| `getLineColumn()` | function | Stateless transform. |
| `buildLineOffsets()` | function | Stateless. `(sourceText) → number[]`. |
| `discoverProjects()` | function | Stateless scan. `(projectRoot) → ProjectBoundary[]`. |
| `resolveFileProject()` | function | Stateless lookup. `(relativePath, boundaries) → string`. |
| `acquireWatcherRole()` | function | DB transaction. `(db, pid) → WatcherRole`. |
| `releaseWatcherRole()` | function | DB delete. `(db, pid) → void`. |
| `CodeLedger` | class | Top-level facade. Owns all sub-components. `open()` / `close()` lifecycle. |
| `ParseCache` | class | Wraps `LruCache<string, ParsedFile>`. Adds `invalidate` semantics. |
| `ProjectWatcher` | class | Owns OS file watcher subscription. `start()` / `close()` lifecycle. |
| `IndexCoordinator` | class | Orchestrates watcher→indexer pipeline. Owns event subscriptions, debounce, indexing lock. |
| `DependencyGraph` | class | Mutable graph data structure. Incremental node/edge add/remove. |
| `DbConnection` | class | Owns SQLite handle. `open()` / `close()` / `transaction()`. |
| `FileRepository` | class | Injected `DbConnection`. Caches prepared statements. |
| `SymbolRepository` | class | Same. |
| `RelationRepository` | class | Same. |

---

## 8. Dependencies

| Package | Version | Purpose | Justification |
|---|---|---|---|
| `oxc-parser` | `^0.112.0` | Native TypeScript/JavaScript AST parser. <1ms per file. | No alternative matches speed. |
| `@parcel/watcher` | `^2.5.6` | Native OS-level file system watcher. | Cross-platform, proven, low overhead. Events are throttled and coalesced in C++ natively. |
| `drizzle-orm` | `^0.45.1` | Type-safe SQL query builder for SQLite. | Lightweight ORM, Bun-native driver support. |
| `comment-parser` | `^1.4.5` | JSDoc comment block parser. | 0 dependencies, 6M+ weekly downloads, TypeScript built-in types. oxc-parser and Bun do not provide JSDoc semantic parsing. |

Dev dependencies: `@types/bun`, `drizzle-kit`, `typescript`.

No other runtime dependencies.

---

## 9. Watcher Module

### 9.1 Types

```typescript
type FileChangeEventType = 'create' | 'change' | 'delete';

interface FileChangeEvent {
  eventType: FileChangeEventType;
  /** Relative path from project root. Always uses forward slashes. */
  filePath: string;
}

interface WatcherOptions {
  projectRoot: string;
  ignorePatterns?: string[];
  extensions?: string[];
}

type WatcherRole = 'owner' | 'reader';
```

### 9.2 ProjectWatcher

Wraps `@parcel/watcher` to provide filtered, normalized file change events.

**Constructor**: `new ProjectWatcher(options: WatcherOptions)`

**Fields**:

- `private subscription: watcher.AsyncSubscription | undefined`
- `private readonly rootPath: string`
- `private readonly ignoreGlobs: string[]`
- `private readonly extensions: Set<string>`

**Constants**:

```typescript
const WATCHER_IGNORE_GLOBS: readonly string[] = [
  '**/.git/**',
  '**/.zipbul/**',
  '**/dist/**',
  '**/node_modules/**',
];
```

The final ignore list = `WATCHER_IGNORE_GLOBS` merged with `options.ignorePatterns`.

**Methods**:

#### `start(onChange: (event: FileChangeEvent) => void): Promise<void>`

1. Call `@parcel/watcher.subscribe(rootPath, callback, { ignore: ignoreGlobs })`.
2. Store returned `AsyncSubscription` in `this.subscription`.
3. In the callback:
   ```
   try {
     for each raw event: [Guard 1~3 + mapping + onChange(...)]
   } catch (err) {
     // Log and swallow — do not crash the watcher subscription.
     console.error(new WatcherError('Callback error', { cause: err }));
   }
   ```
   For each raw event:
   - a. Compute `relativePath = path.relative(rootPath, evt.path)`, replace all `\\` with `/`.
   - b. **Guard 1**: If `relativePath.startsWith('..')` → skip. The event is outside the project root.
   - c. **Guard 2**: If `path.extname(relativePath)` is not in `this.extensions` AND the file is not `package.json` AND the file is not `tsconfig.json` AND the file is not `jsconfig.json` → skip.
   - d. **Guard 3**: If path ends with `.d.ts` → skip.
   - e. Map event type: `@parcel/watcher` `'create'` → `'create'`, `'update'` → `'change'`, `'delete'` → `'delete'`.
   - f. Call `onChange({ eventType, filePath: relativePath })`.
4. If `@parcel/watcher.subscribe` throws → wrap in `WatcherError` and re-throw.

**Note**: `package.json`, `tsconfig.json`, and `jsconfig.json` events bypass the extension filter. `package.json` triggers project boundary re-discovery (see §3.1). `tsconfig.json`/`jsconfig.json` triggers path alias cache refresh (see §13.4).

#### `close(): Promise<void>`

1. If `this.subscription` is defined, call `this.subscription.unsubscribe()`.
2. Set `this.subscription = undefined`.
3. If `unsubscribe()` throws → wrap in `WatcherError` and re-throw.

---

### 9.3 Watcher Coordination (DB-based)

Only ONE process should run the OS-level file watcher for a given project. Coordination is handled via the `watcher_owner` table in the shared SQLite database. No lock files, no JSONL changeset, no signal files.

#### `watcher_owner` table

```sql
CREATE TABLE watcher_owner (
  id INTEGER PRIMARY KEY CHECK (id = 1),  -- singleton row
  pid INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL
);
```

#### `isProcessAlive(pid: number): boolean`

```
try:
  process.kill(pid, 0)  // signal 0 = existence check only, ~1μs
  return true
catch (e):
  if e.code === 'ESRCH' → return false   // process does not exist
  return true                              // EPERM = different user, but alive
```

#### `acquireWatcherRole(db: Database, pid: number): WatcherRole`

```
1. BEGIN IMMEDIATE TRANSACTION
2. SELECT pid, heartbeat_at FROM watcher_owner WHERE id = 1
3. If no row:
   a. INSERT INTO watcher_owner (id, pid, started_at, heartbeat_at)
      VALUES (1, pid, datetime('now'), datetime('now'))
   b. COMMIT
   c. Return 'owner'
4. If row exists:
   a. existingPid = row.pid
   b. heartbeatAge = (now - row.heartbeat_at) in seconds
   c. If isProcessAlive(existingPid) AND heartbeatAge < 90:
      → COMMIT → return 'reader'
   d. Else (process dead OR heartbeat stale):
      → UPDATE watcher_owner SET pid = ?, started_at = datetime('now'),
        heartbeat_at = datetime('now') WHERE id = 1
      → COMMIT → return 'owner'
```

`BEGIN IMMEDIATE` serializes concurrent access — SQLite's write lock prevents two processes from both becoming owner.

#### `releaseWatcherRole(db: Database, pid: number): void`

```
DELETE FROM watcher_owner WHERE id = 1 AND pid = ?
```

Only deletes if the current process is the registered owner. If another process already took over, this is a no-op.

#### `updateHeartbeat(db: Database, pid: number): void`

```
UPDATE watcher_owner SET heartbeat_at = datetime('now') WHERE id = 1 AND pid = ?
```

### 9.4 Crash Recovery

**Abnormal termination** (SIGKILL, OOM kill, power loss) leaves a stale `watcher_owner` row. This is handled at three levels:

#### Level 1 — Process lifecycle hooks (graceful exits)

```typescript
// Registered by IndexCoordinator on startup
process.on('SIGTERM', () => coordinator.shutdown());
process.on('SIGINT',  () => coordinator.shutdown());
process.on('beforeExit', () => coordinator.shutdown());
```

`shutdown()` calls `watcher.close()`, `releaseWatcherRole()`, `db.close()`.

#### Level 2 — Reader health check (detects crashed owner)

Reader processes run a periodic check:

```
Every 60 seconds:
  1. SELECT pid, heartbeat_at FROM watcher_owner WHERE id = 1
  2. If PID dead OR heartbeat_at > 90 seconds old:
     a. acquireWatcherRole() → becomes 'owner'
     b. Start ProjectWatcher + IndexCoordinator
     c. detectChanges() → catch up on missed changes
```

#### Level 3 — Startup recovery (detects stale state)

Every process calls `acquireWatcherRole()` on startup. If the registered owner is dead, the new process takes over immediately. Then `detectChanges()` compares disk state against DB, re-indexing any files that changed while no watcher was active.

#### Level 4 — DB corruption (extreme)

```
DbConnection.open():
  SQLite WAL auto-recovery on open.
  If migrations fail → delete DB files (.db, .db-wal, .db-shm) → recreate → fullIndex().
  The DB is a cache/index, not source of truth. Deletion and rebuild is always safe.
```

### 9.5 Owner lifecycle

```
Process start
  → DbConnection.open()
  → acquireWatcherRole(db, process.pid)
  → If 'owner':
      Start ProjectWatcher
      Start heartbeat timer (every 30s → updateHeartbeat)
      Start IndexCoordinator pipeline
  → If 'reader':
      Start health check timer (every 60s → check owner liveness)
      Use search/query APIs only (data kept current by owner)

Process shutdown (graceful)
  → watcher.close()
  → clearInterval(heartbeat/healthCheck timer)
  → releaseWatcherRole(db, process.pid)
  → db.close()

Process crash (SIGKILL)
  → Nothing runs
  → Other processes detect via PID check + heartbeat age
  → Next check → takeover → detectChanges() → catch up
```

---

## 10. Parser Module

### 10.1 Types

```typescript
interface ParsedFile {
  filePath: string;
  program: Program;                    // oxc-parser AST root node.
  errors: readonly OxcError[];         // Parse errors (file may be partially parsed).
  comments: readonly Comment[];        // All comments from the source.
  sourceText: string;                  // Original source text. Needed for offset→position.
}
```

### 10.2 parseSource

`parseSource(filePath: string, sourceText: string): ParsedFile`

`filePath` must be an **absolute path**. This is required because `extractRelations` → `resolveImport` uses `path.dirname(filePath)` to resolve relative imports. Consumers must pass absolute paths consistently.

Pure function. No side effects. No caching.

Algorithm:

1. Call `oxc-parser.parseSync(filePath, sourceText)`. No additional options.
2. Extract `program`, `errors`, `comments` from the result.
3. Return `{ filePath, program, errors, comments, sourceText }`.
4. If `parseSync` throws (malformed input, internal parser crash) → wrap in `ParseError` and re-throw.

### 10.3 Source Position Utilities

Converts character offsets into 1-based line and 0-based column. Uses a pre-built line offset table for O(log n) lookups instead of O(n) linear scan per call.

```typescript
interface SourcePosition {
  line: number;    // 1-based.
  column: number;  // 0-based.
}
```

#### `buildLineOffsets(sourceText: string): number[]`

Builds a lookup table of character offsets where each line starts. Called ONCE per file.

```
1. offsets = [0]          // line 1 starts at offset 0
2. for i = 0 to sourceText.length - 1:
     if sourceText[i] === '\n': offsets.push(i + 1)
3. return offsets
```

Result: `offsets[lineIndex]` = character offset of the start of line `lineIndex + 1`.

#### `getLineColumn(offsets: number[], offset: number): SourcePosition`

Binary search on the pre-built offsets array.

```
1. lo = 0, hi = offsets.length - 1
2. while lo < hi:
     mid = (lo + hi + 1) >> 1
     if offsets[mid] <= offset: lo = mid
     else: hi = mid - 1
3. return { line: lo + 1, column: offset - offsets[lo] }
```

**Performance**: For a file with 200 symbols (400 position lookups):
- Old: O(n) × 400 = O(400n)
- New: O(n) once + O(log n) × 400 ≈ O(n + 400 log n)

### 10.4 ParseCache

In-process LRU cache for parsed ASTs. Delegates to `LruCache<string, ParsedFile>` (§15.4) internally. Watcher integration invalidates entries on file change.

**Constructor**: `new ParseCache(capacity: number = 500)`

**Fields**:

- `private readonly lru: LruCache<string, ParsedFile>` — generic LRU from common module.

**Methods**:

#### `get(filePath: string): ParsedFile | undefined`

1. Return `this.lru.get(filePath)`.

#### `set(filePath: string, parsed: ParsedFile): void`

1. `this.lru.set(filePath, parsed)`.

#### `invalidate(filePath: string): void`

1. `this.lru.delete(filePath)`.

#### `invalidateAll(): void`

1. `this.lru.clear()`.

#### `size(): number`

1. Return `this.lru.size`.

---

### 10.5 AST Utility Functions

All located in `parser/ast-utils.ts`. All are pure functions.

#### `isNode(value: unknown): value is Record<string, unknown>`

Returns `true` if `value` is a non-null, non-array object.

#### `isNodeArray(value: unknown): value is ReadonlyArray<unknown>`

Returns `true` if `value` is an `Array`.

#### `visit(node: unknown, callback: (node: Record<string, unknown>) => void): void`

Pre-order recursive traversal of an AST subtree.

```
1. If node is falsy or not an object → return.
2. If node is an array → recurse into each element.
3. If node is a record:
   a. callback(node).
   b. For each key in node (skip 'loc', 'start', 'end', 'scope'):
      → If value is array: recurse each element.
      → If value is object: recurse.
```

#### `collectNodes(root: unknown, predicate: (node: Record<string, unknown>) => boolean): Record<string, unknown>[]`

Collects all nodes matching `predicate` via `visit`.

#### `getNodeHeader(node: Record<string, unknown>, parent?: Record<string, unknown> | null): string`

Extracts the "name" of an AST node. Resolution order:

1. `node.id.name` (e.g., `FunctionDeclaration.id.name`).
2. `node.key.name` (e.g., `MethodDefinition.key.name`).
3. `node.key` as string literal value.
4. If `parent` provided:
   - a. `parent.type === 'VariableDeclarator'` → `parent.id.name`.
   - b. `parent.type` is `MethodDefinition | PropertyDefinition | Property` → `parent.key.name` or literal.
5. Fallback: `'anonymous'`.

#### `isFunctionNode(node: Record<string, unknown>): boolean`

`node.type` is `FunctionDeclaration`, `FunctionExpression`, or `ArrowFunctionExpression`.

#### `getNodeName(node: unknown): string | null`

If `node` has a string `name` property, return it. Otherwise `null`.

#### `getStringLiteralValue(node: unknown): string | null`

If `node.type` is `StringLiteral` or (`Literal` with string `value`), return the value. Otherwise `null`.

#### `getQualifiedName(expr: unknown): QualifiedName | null`

Resolves dotted member expressions into a structured representation.

```typescript
interface QualifiedName {
  root: string;        // Leftmost identifier (e.g., 'a' in 'a.b.c').
  parts: string[];     // Subsequent parts (['b', 'c']).
  full: string;        // Joined ('a.b.c').
}
```

Algorithm:

1. `Identifier` → `{ root: name, parts: [], full: name }`.
2. `ThisExpression` → `{ root: 'this', ... }`.
3. `Super` → `{ root: 'super', ... }`.
4. `MemberExpression` → walk the `.object` chain collecting `.property` names into `parts`. Chain root must be `Identifier`, `ThisExpression`, or `Super`.
5. Anything else → `null`.

---

## 11. Extractor Module

### 11.1 Symbol Extractor

#### `extractSymbols(parsed: ParsedFile): ExtractedSymbol[]`

Pure function. Walks the full AST and extracts all code symbols with rich metadata.

**Output type**:

```typescript
type SymbolKind = 'function' | 'method' | 'class' | 'variable'
               | 'type' | 'interface' | 'enum' | 'property';

interface SourceSpan {
  start: SourcePosition;  // { line: number, column: number }
  end: SourcePosition;
}

interface ExtractedSymbol {
  kind: SymbolKind;
  name: string;
  span: SourceSpan;
  isExported: boolean;
  methodKind?: 'method' | 'getter' | 'setter' | 'constructor';

  // Rich metadata — populated when applicable, undefined otherwise.
  parameters?: Parameter[];
  returnType?: string;
  typeParameters?: string[];
  modifiers: Modifier[];
  heritage?: Heritage[];
  decorators?: Decorator[];
  members?: ExtractedSymbol[];     // Recursive: class/interface/enum members.
  jsDoc?: JsDocBlock;              // Parsed JSDoc comment associated with this symbol.
}

interface Parameter {
  name: string;
  type?: string;       // Type annotation as source text.
  isOptional: boolean;
  defaultValue?: string;
  decorators?: Decorator[];  // Parameter-level decorators (e.g., @Inject, @Body).
}

type Modifier = 'async' | 'static' | 'abstract' | 'readonly'
              | 'private' | 'protected' | 'public'
              | 'override' | 'declare' | 'const';

interface Heritage {
  kind: 'extends' | 'implements';
  name: string;
  typeArguments?: string[];
}

interface Decorator {
  name: string;
  arguments?: string[];
}

interface JsDocBlock {
  description: string;          // Full description text before any tags.
  tags: JsDocTag[];             // Parsed @tag entries.
}

interface JsDocTag {
  tag: string;                  // Tag name without '@'. e.g., 'param', 'see', 'deprecated'.
  name: string;                 // First word after tag. e.g., parameter name for @param.
  type: string;                 // Type in curly braces. e.g., '{string}' → 'string'.
  description: string;          // Remaining text after name.
  optional: boolean;            // True if name is wrapped in [brackets].
  default?: string;             // Default value if [name=default] syntax.
}
```

#### AST Traversal Algorithm

Internal recursive function `visitNode(node, exported, parentNode)`:

```
exported: boolean — inherited from parent. True if wrapped in
ExportNamedDeclaration or ExportDefaultDeclaration.
```

**Node type → extraction rules**:

| AST node type | kind | name source | isExported | members | jsDoc | methodKind |
|---|---|---|---|---|---|---|
| `FunctionDeclaration` | `'function'` | `node.id.name` | `exported` | — | Leading `/** */` | — |
| `VariableDeclarator` where `init` is function node | `'function'` | `node.id.name` | `exported` | — | Leading `/** */` | — |
| `VariableDeclarator` where `init` is NOT function node | `'variable'` | `node.id.name` | `exported` | — | Leading `/** */` | — |
| `VariableDeclarator` where `id` is `ObjectPattern` | `'variable'` | each property identifier | `exported` | — | Leading `/** */` | — |
| `ClassDeclaration` / `ClassExpression` | `'class'` | `node.id.name` | `exported` | yes | Leading `/** */` | — |
| `MethodDefinition` | `'method'` | `node.key.name` | always `false` | — | Leading `/** */` | `node.kind` → `'method'` \| `'getter'` \| `'setter'` \| `'constructor'` |
| `PropertyDefinition` | `'property'` | `node.key.name` | always `false` | — | Leading `/** */` | — |
| `TSTypeAliasDeclaration` | `'type'` | `node.id.name` | `exported` | — | Leading `/** */` | — |
| `TSInterfaceDeclaration` | `'interface'` | `node.id.name` | `exported` | yes | Leading `/** */` | — |
| `TSEnumDeclaration` | `'enum'` | `node.id.name` | `exported` | yes | Leading `/** */` | — |

**Skip rules**:

- If computed name resolves to `'anonymous'` → skip entirely, **except** for `ExportDefaultDeclaration` — use `'default'` as the symbol name.
- `VariableDeclarator` where `id` is `ObjectPattern` or `ArrayPattern` → extract **each** destructured identifier as a separate variable symbol. Do NOT skip.
- Nodes inside function bodies are NOT extracted as top-level symbols (only `MethodDefinition` and `PropertyDefinition` inside class bodies are extracted as members).

**Export detection**:

- If `node.type` is `ExportNamedDeclaration` or `ExportDefaultDeclaration` → set `exported = true` for child declaration.
- `VariableDeclaration` inside export → iterate `declarations` array, each `VariableDeclarator` inherits `exported`.

**Rich metadata population per kind**:

##### function / method

- `parameters`: Walk `node.params` array. For each param:
  - `name`: `Identifier.name`, or `RestElement.argument.name` (prefixed with `...`), or `AssignmentPattern.left.name`.
  - `type`: `param.typeAnnotation?.typeAnnotation` → reconstructed as source text substring using `sourceText.slice(ann.start, ann.end)`.
  - `isOptional`: `param.optional === true` or `param.type === 'AssignmentPattern'`.
  - `defaultValue`: If `AssignmentPattern`, `sourceText.slice(param.right.start, param.right.end)`.
  - `decorators`: If `param.decorators` array exists, extract each as `{ name, arguments }` (same logic as class decorators).
- `returnType`: `node.returnType?.typeAnnotation` → source text slice.
- `typeParameters`: `node.typeParameters?.params` → map each to `param.name.name` (or source text slice for complex constraints).
- `modifiers`: Collect from `node.async` (`'async'`), node accessibility/flags, parent `MethodDefinition` properties (`static`, `override`, accessibility).
- `methodKind`: If parent is `MethodDefinition`, set from `parent.kind`: `'get'` → `'getter'`, `'set'` → `'setter'`, `'constructor'` → `'constructor'`, `'method'` → `'method'`. Undefined for standalone functions.

##### class

- `heritage`: Walk `node.superClass` → `{ kind: 'extends', name: qualifiedName }`. Walk `node.implements` → `{ kind: 'implements', name }` for each.
- `typeParameters`: from `node.typeParameters`.
- `decorators`: from `node.decorators` → `{ name: decorator.expression callee name, arguments: [source text slices of args] }`.
- `members`: Recurse into `node.body.body`, calling `visitNode` on each `MethodDefinition`, `PropertyDefinition`, `TSIndexSignature`. Each produces an `ExtractedSymbol` with `kind = 'method'` (with appropriate `methodKind`) or `kind = 'property'`.

##### interface

- `heritage`: Walk `node.extends` → `{ kind: 'extends', name }`.
- `typeParameters`: from `node.typeParameters`.
- `members`: Recurse into `node.body.body` → extract `TSMethodSignature` (as `'method'`), `TSPropertySignature` (as `'property'`).

##### enum

- `members`: Each `TSEnumMember` → `{ kind: 'property', name: member.id.name, ... }`.

#### JSDoc Association

Each symbol looks for a **leading JSDoc comment** using positional association and parses it via `comment-parser`:

```
1. Find the comment from parsed.comments whose end offset is closest to
   (but strictly before) the symbol's start offset, with no other AST
   statement node between the comment end and the symbol start.
2. If that comment's text starts with '/**' (JSDoc block):
   a. Parse via comment-parser → JsDocBlock { description, tags[] }.
   b. Attach to ExtractedSymbol.jsDoc.
3. If no JSDoc block found → jsDoc is undefined.
```

Consumers extract what they need from the parsed JSDoc structure. For example, `@see` tags: `symbol.jsDoc?.tags.filter(t => t.tag === 'see')`. This replaces hard-coded seeLinks extraction with a general-purpose JSDoc parser.

**Span calculation**: `getLineColumn(lineOffsets, node.start)` / `getLineColumn(lineOffsets, node.end)` where `lineOffsets = buildLineOffsets(sourceText)`.

---

### 10.6 JSDoc Parser (parser/jsdoc-parser.ts)

#### `parseJsDoc(commentText: string): JsDocBlock`

Pure function. Wraps `comment-parser` to produce a normalized `JsDocBlock`.

```
1. Strip leading '/**' and trailing '*/' from commentText.
2. Call comment-parser's parse(`/** ${stripped} */`)[0].
   (comment-parser expects full block comment syntax.)
3. Map result to JsDocBlock:
   - description = result.description (trimmed).
   - tags = result.tags.map(t => ({
       tag: t.tag,
       name: t.name,
       type: t.type,
       description: t.description,
       optional: t.optional,
       default: t.default ?? undefined,
     })).
4. Return { description, tags }.
5. If comment-parser throws → wrap in ParseError and re-throw.
```

This function is called by `extractSymbols()` during JSDoc Association (§11.1). It is NOT called independently by consumers — consumers receive the parsed `JsDocBlock` via `ExtractedSymbol.jsDoc`.

---

### 11.2 Relation Extractor

#### `extractRelations(ast: Program, filePath: string, tsconfigPaths?: TsconfigPaths): CodeRelation[]`

Pure function. Orchestrates all 4 sub-extractors and merges their results. Passes `tsconfigPaths` through to `buildImportMap` for alias resolution.

```typescript
interface CodeRelation {
  type: 'imports' | 'calls' | 'extends' | 'implements';
  srcFilePath: string;
  srcSymbolName: string | null;    // null = module-level.
  dstFilePath: string;
  dstSymbolName: string | null;
  metaJson?: string;
}
```

Implementation:

```
1. const importMap = buildImportMap(ast, filePath, tsconfigPaths);
2. const relations: CodeRelation[] = [];
3. relations.push(...importsExtractor.extract(ast, filePath, tsconfigPaths));
4. relations.push(...callsExtractor.extract(ast, filePath, importMap));
5. relations.push(...extendsExtractor.extract(ast, filePath, importMap));
6. relations.push(...implementsExtractor.extract(ast, filePath, importMap));
7. return relations;
```

`importMap` is built once and shared by calls/heritage extractors. Imports extractor builds its own relations from raw `ImportDeclaration` nodes but uses the same `resolveImport` + `tsconfigPaths`.

Each sub-extractor conforms to:

```typescript
interface RelationExtractor {
  readonly name: string;
  extract(ast: Program, filePath: string, context: TsconfigPaths | ImportMap): CodeRelation[];
}
```

---

### 11.3 Sub-Extractor Utilities (extractor-utils.ts)

#### `buildImportMap(ast: Program, currentFilePath: string, tsconfigPaths?: TsconfigPaths): Map<string, ImportReference>`

```typescript
interface ImportReference {
  path: string;           // Resolved absolute path of imported module.
  importedName: string;   // 'default', '*', or named identifier.
}
```

Algorithm:

1. Walk top-level `ast.body` only (no deep traversal).
2. For each `ImportDeclaration`:
   - a. `resolveImport(currentFilePath, source.value, tsconfigPaths)`.
   - b. If `null` → skip (external module).
   - c. For each specifier:
     - `ImportSpecifier` → `localName → { path, importedName: imported.name }`.
     - `ImportDefaultSpecifier` → `localName → { path, importedName: 'default' }`.
     - `ImportNamespaceSpecifier` → `localName → { path, importedName: '*' }`.

#### `resolveImport(currentFilePath: string, importPath: string, tsconfigPaths?: TsconfigPaths): string | null`

Resolves both relative imports and tsconfig path aliases. Replaces `resolveRelativeImport`.

```
1. If importPath starts with '.':
   a. resolved = path.resolve(dirname(currentFilePath), importPath).
   b. If path.extname(resolved) === '' → append '.ts'.
   c. Return resolved.
2. If tsconfigPaths is provided:
   a. For each pattern in tsconfigPaths.paths (ordered by specificity, longest prefix first):
      - Split pattern at '*': prefix = part before '*', suffix = part after '*' (if any).
      - If importPath starts with prefix AND ends with suffix:
        - captured = importPath.slice(prefix.length, importPath.length - suffix.length || undefined).
        - For the **first** target path in the array:
          - Replace '*' in target with captured.
          - Resolve as absolute: path.resolve(tsconfigPaths.baseUrl, replacedTarget).
          - If extname === '' → append '.ts'.
          - Return resolved.
      - If pattern has no '*' (exact match):
        - If importPath === pattern → resolve first target directly.
3. Return null (external package).
```

**No file system access.** Pure string resolution. `.ts` extension is assumed for extensionless imports.

**Multi-target policy**: Only the **first** target path is used. tsconfig's fallback semantics (try paths in order until a file is found) require file system access, which violates code-ledger's pure resolution principle. Consumers requiring multi-target fallback should configure their tsconfig to use a single canonical path per alias.

#### tsconfig paths loading (common/tsconfig-resolver.ts)

```typescript
interface TsconfigPaths {
  baseUrl: string;              // Absolute path. Defaults to projectRoot.
  paths: Map<string, string[]>; // Pattern → replacement paths.
}
```

#### `loadTsconfigPaths(projectRoot: string): TsconfigPaths | null`

```
1. Read tsconfig.json (or jsconfig.json) from projectRoot.
2. If file not found → return null.
3. Parse JSON. Extract compilerOptions.baseUrl and compilerOptions.paths.
4. If neither baseUrl nor paths defined → return null.
5. Resolve baseUrl to absolute path (relative to tsconfig.json location).
6. Convert paths object to Map<string, string[]>.
7. Return { baseUrl, paths }.
8. Cache result per projectRoot. Invalidate when watcher detects tsconfig.json change.
```

Note: `tsconfig.json` change events are handled by ProjectWatcher alongside `package.json` events — the extension filter bypass applies to both.

#### Entity key conventions

In code-ledger relations, keys use **file paths** (relative to project root) and **symbol names** rather than the zipbul `module:` / `symbol:` prefix system. This simplifies the schema:

- `srcFilePath` / `dstFilePath`: Relative path from project root.
- `srcSymbolName` / `dstSymbolName`: Symbol name, or `null` for module-level.

---

### 11.4 Imports Extractor

**Traversal**: Two passes.

**Pass 1 — top-level statements** (`ast.body` for loop):

| Node type | Condition | Relation | metaJson |
|---|---|---|---|
| `ImportDeclaration` | `resolveImport(source)` returns non-null | `type: 'imports'` | `importKind === 'type'` → `{"isType":true}` else `undefined` |
| `ExportAllDeclaration` | source resolves | `type: 'imports'` | `{"isReExport":true}` (+ `"isType":true` if type export) |
| `ExportNamedDeclaration` with `source` | source resolves | `type: 'imports'` | `{"isReExport":true}` |

**Pass 2 — deep traversal** (`visit()`):

| Node type | Condition | Relation | metaJson |
|---|---|---|---|
| `ImportExpression` | `getStringLiteralValue(node.source)` resolves | `type: 'imports'` | `{"isDynamic":true}` |

**For all**: `srcFilePath` = current file (relative). `srcSymbolName` = `null`. `dstFilePath` = resolved import target (relative). `dstSymbolName` = `null`.

---

### 11.5 Calls Extractor

**Traversal**: Custom recursive `walk()` function (not `visit()`). Maintains a function stack and class stack for caller identification.

**Internal state during walk**:

- `functionStack: string[]` — current function context.
- `classStack: string[]` — current class context.
- `importMap: Map<string, ImportReference>` — built via `buildImportMap()`.

**Walk rules**:

1. **`ClassDeclaration` / `ClassExpression`**: Push `className` (or `'AnonymousClass'`) to `classStack`. Walk `node.body`. Pop.
2. **`FunctionDeclaration`**: Push name to `functionStack`. Walk body. Pop.
3. **`VariableDeclarator`** with function init: Push `id.name`. Walk init body. Pop.
4. **`MethodDefinition`** with function value: Push `ClassName.methodName`. Walk value body. Pop.
5. **`CallExpression`**: Resolve callee → produce `type: 'calls'` relation.
6. **`NewExpression`**: Resolve callee → produce `type: 'calls'` relation with `{"isNew":true}` in meta.
7. **`JSXOpeningElement`**: Resolve `node.name` via `getQualifiedName()` → produce `type: 'calls'` relation with `{"isJsx":true}` in meta. Uses the same callee resolution table as `CallExpression`.
8. **All other nodes**: Recurse into children (skip `loc`, `start`, `end`, `scope`).

**Callee resolution** via `getQualifiedName(callee)`:

| Condition | dstFilePath | dstSymbolName | meta.resolution |
|---|---|---|---|
| No parts + in importMap | imported module file | importedName | `'import'` |
| No parts + not in importMap | current file | root name | `'local'` |
| Has parts + root is namespace import (`*`) | namespace module file | last part | `'namespace'` |
| Has parts + other | current file | full qualified name | `'local-member'` |

**Caller (src) identification**:

- If `functionStack` is non-empty → `srcSymbolName = functionStack[top]`.
- If empty (module scope) → `srcSymbolName = null`, meta adds `"scope":"module"`.

---

### 11.6 Heritage Extractor (merged extends + implements)

**Traversal**: `visit()` over entire AST. Single pass extracts both `extends` and `implements` relations.

**Trigger**: `ClassDeclaration` or `ClassExpression`.

For each class node:

**extends** (if `node.superClass` is present):

1. `srcSymbolName` = class name.
2. Resolve `superClass` via `getQualifiedName()`.
3. Resolve dst using importMap (same resolution table as Calls Extractor).
4. Produce `type: 'extends'` relation.
5. If local (not imported): `metaJson = {"isLocal":true}`.
6. If namespace import: `metaJson = {"isNamespaceImport":true}`.

**implements** (if `node.implements` array is present):

For each element in `implements`:

1. `srcSymbolName` = class name.
2. Resolve `impl.expression` via `getQualifiedName()`.
3. Resolve dst using importMap (same resolution table).
4. Produce `type: 'implements'` relation.
5. Identical meta rules as extends.

---

## 12. Store Module

### 12.1 DbConnection

**Constructor**: `new DbConnection(options: { projectRoot: string })`

- `this.dbPath = path.join(projectRoot, '.zipbul', 'code-ledger.db')`
- Connection is NOT opened in constructor. Call `open()` explicitly.

**Methods**:

#### `open(): void`

1. `mkdirSync(dirname(dbPath), { recursive: true })`.
2. `new Database(dbPath)` via `bun:sqlite`.
3. Execute PRAGMA:
   - `PRAGMA journal_mode = WAL`
   - `PRAGMA busy_timeout = 5000`
4. Wrap with `drizzle(client, { schema, casing: 'snake_case' })`.
5. Resolve migrations folder: `path.join(import.meta.dirname, 'migrations')`. This resolves to the code-ledger package's own migrations directory, even when installed as a dependency in `node_modules/@zipbul/code-ledger/`. When consumers install or update code-ledger, the next `open()` call automatically applies new migrations.
6. Run drizzle migrations from the resolved folder.
7. If migrations fail → delete DB files (`dbPath`, `dbPath-wal`, `dbPath-shm`), retry once. If retry fails → throw `StoreError`.

#### `close(): void`

1. Call `this.client.close()`.

#### `transaction<T>(fn: (tx: DrizzleSQLiteTransaction) => T): T`

Uses drizzle-orm's `db.transaction()` internally. `DrizzleSQLiteTransaction` = drizzle's `SQLiteTransaction` type re-exported from store module.

1. Begin transaction (or savepoint for nested).
2. Execute `fn(tx)`.
3. Commit (or release savepoint).
4. On error: rollback (or rollback to savepoint) → re-throw.

**Nesting**: Track depth via instance variable. Depth 0 = `BEGIN`/`COMMIT`. Depth > 0 = `SAVEPOINT sp_{n}` / `RELEASE`.

### 12.2 Schema (Drizzle)

#### files table

| Column | Type | Constraints |
|---|---|---|
| `project` | text | NOT NULL, part of composite PK |
| `file_path` | text | NOT NULL, part of composite PK |
| `mtime_ms` | real | NOT NULL |
| `size` | integer | NOT NULL |
| `content_hash` | text | NOT NULL |
| `updated_at` | text | NOT NULL |

PK: `(project, file_path)`.

#### symbols table

| Column | Type | Constraints |
|---|---|---|
| `id` | integer | PK, autoincrement |
| `project` | text | NOT NULL |
| `file_path` | text | NOT NULL |
| `kind` | text | NOT NULL |
| `name` | text | NOT NULL |
| `start_line` | integer | NOT NULL |
| `start_column` | integer | NOT NULL |
| `end_line` | integer | NOT NULL |
| `end_column` | integer | NOT NULL |
| `is_exported` | integer | NOT NULL, default 0 |
| `signature` | text | nullable |
| `fingerprint` | text | nullable |
| `detail_json` | text | nullable |
| `content_hash` | text | NOT NULL |
| `indexed_at` | text | NOT NULL |

FK: `(project, file_path) → files(project, file_path) ON DELETE CASCADE`.

Indexes: `(project, file_path)`, `(project, kind)`, `(project, name)`.

**detail_json contents** (JSON-serialized from ExtractedSymbol):

```json
{
  "parameters": [
    { "name": "query", "type": "string", "isOptional": false }
  ],
  "returnType": "Promise<Result[]>",
  "typeParameters": ["T"],
  "modifiers": ["async", "static"],
  "heritage": [{ "kind": "extends", "name": "Base" }],
  "decorators": [{ "name": "Injectable", "arguments": [] }],
  "members": [],
  "jsDoc": {
    "description": "Handles user authentication.",
    "tags": [
      { "tag": "see", "name": "auth/login", "description": "" },
      { "tag": "deprecated", "description": "Use AuthServiceV2 instead." }
    ]
  }
}
```

Only fields with values are included; undefined fields are omitted from the JSON.

**signature format**: `params:{N}|async:{0|1}` for functions/methods. `null` for other kinds.

**fingerprint format**: `xxHash64(symbolName|kind|signature)`. Used for move tracking.

#### relations table

| Column | Type | Constraints |
|---|---|---|
| `id` | integer | PK, autoincrement |
| `project` | text | NOT NULL |
| `type` | text | NOT NULL |
| `src_file_path` | text | NOT NULL |
| `src_symbol_name` | text | nullable |
| `dst_file_path` | text | NOT NULL |
| `dst_symbol_name` | text | nullable |
| `meta_json` | text | nullable |

FK: `(project, src_file_path) → files(project, file_path) ON DELETE CASCADE`.

Indexes: `(project, src_file_path)`, `(project, dst_file_path)`, `(project, type)`.

#### symbols_fts virtual table (FTS5)

```sql
CREATE VIRTUAL TABLE symbols_fts USING fts5(
  name,
  file_path,
  kind,
  content=symbols,
  content_rowid=id
);
```

**FTS synchronization**: Triggers on `symbols` table.

```sql
CREATE TRIGGER symbols_ai AFTER INSERT ON symbols BEGIN
  INSERT INTO symbols_fts(rowid, name, file_path, kind)
  VALUES (new.id, new.name, new.file_path, new.kind);
END;

CREATE TRIGGER symbols_ad AFTER DELETE ON symbols BEGIN
  INSERT INTO symbols_fts(symbols_fts, rowid, name, file_path, kind)
  VALUES ('delete', old.id, old.name, old.file_path, old.kind);
END;

CREATE TRIGGER symbols_au AFTER UPDATE ON symbols BEGIN
  INSERT INTO symbols_fts(symbols_fts, rowid, name, file_path, kind)
  VALUES ('delete', old.id, old.name, old.file_path, old.kind);
  INSERT INTO symbols_fts(rowid, name, file_path, kind)
  VALUES (new.id, new.name, new.file_path, new.kind);
END;
```

### 12.3 Repositories

Each repository takes `DbConnection` via constructor injection.

#### FileRepository

| Method | Signature | SQL |
|---|---|---|
| `getFile` | `(project, filePath) → FileRecord \| null` | `SELECT * FROM files WHERE project = ? AND file_path = ?` |
| `upsertFile` | `(record: FileRecord) → void` | `INSERT ... ON CONFLICT(project, file_path) DO UPDATE SET mtime_ms, size, content_hash, updated_at` |
| `deleteFile` | `(project, filePath) → void` | `DELETE FROM files WHERE project = ? AND file_path = ?` |
| `getAllFiles` | `(project) → FileRecord[]` | `SELECT * FROM files WHERE project = ?` |
| `getFilesMap` | `(project) → Map<string, FileRecord>` | Same query, returns Map keyed by `file_path`. |

#### SymbolRepository

| Method | Signature | SQL |
|---|---|---|
| `replaceFileSymbols` | `(project, filePath, contentHash, symbols: SymbolRecord[]) → void` | In transaction: `DELETE FROM symbols WHERE project AND file_path`, then batch `INSERT`. |
| `getFileSymbols` | `(project, filePath) → SymbolRecord[]` | `SELECT * FROM symbols WHERE project = ? AND file_path = ?` |
| `searchByName` | `(project, query, limit?) → SymbolRecord[]` | `SELECT * FROM symbols_fts WHERE symbols_fts MATCH ? ... JOIN symbols` |
| `searchByKind` | `(project, kind, limit?) → SymbolRecord[]` | `SELECT * FROM symbols WHERE project = ? AND kind = ?` |
| `getStats` | `(project) → { fileCount, symbolCount }` | `SELECT COUNT(DISTINCT file_path), COUNT(*) FROM symbols WHERE project = ?` |
| `getByFingerprint` | `(project, fingerprint) → SymbolRecord[]` | `SELECT * FROM symbols WHERE project = ? AND fingerprint = ?` |
| `deleteFileSymbols` | `(project, filePath) → void` | `DELETE FROM symbols WHERE project = ? AND file_path = ?` |

#### RelationRepository

| Method | Signature | SQL |
|---|---|---|
| `replaceFileRelations` | `(project, srcFilePath, relations: RelationRecord[]) → void` | In transaction: `DELETE WHERE project AND src_file_path`, then batch `INSERT`. |
| `getOutgoing` | `(project, srcFilePath, srcSymbolName?) → RelationRecord[]` | `SELECT * FROM relations WHERE project AND src_file_path AND (src_symbol_name = ? OR src_symbol_name IS NULL)` |
| `getIncoming` | `(project, dstFilePath, dstSymbolName?) → RelationRecord[]` | `SELECT * FROM relations WHERE project AND dst_file_path ...` |
| `getByType` | `(project, type, limit?) → RelationRecord[]` | `SELECT * FROM relations WHERE project = ? AND type = ?` |
| `deleteFileRelations` | `(project, filePath) → void` | `DELETE FROM relations WHERE project = ? AND src_file_path = ?` |
| `retargetRelations` | `(project, oldFilePath, oldSymbol, newFilePath, newSymbol) → void` | `UPDATE relations SET src/dst WHERE project AND matching old values` |

---

## 13. Indexer Module

### 13.1 FileIndexer

Compares current file system state against stored `files` table to determine which files need reindexing.

#### `detectChanges(options: { projectRoot, extensions, ignorePatterns, fileRepo, project?: string }): Promise<FileChangeset>`

`project` is optional. If provided, compares only against DB records for that project. If omitted, compares against **all** DB records (used by `fullIndex` for workspace-wide rebuild).

```typescript
interface FileChangeset {
  changed: FileEntry[];      // New or modified files.
  unchanged: FileEntry[];    // No change since last index.
  deleted: string[];         // Paths in DB but not on disk.
}

interface FileEntry {
  filePath: string;          // Relative to projectRoot.
  contentHash: string;
  mtimeMs: number;
  size: number;
}
```

Algorithm:

```
1. Scan projectRoot for files matching extensions, excluding ignorePatterns.
   Use Bun.Glob for scanning.
2. Load existing file records from fileRepo.getFilesMap(project).
3. For each scanned file:
   a. stat() → mtimeMs, size.
   b. Look up existing record by filePath.
   c. If no record exists → changed (new file).
      Compute contentHash = hashString(await Bun.file(absPath).text()).
   d. If mtimeMs !== existing.mtimeMs OR size !== existing.size:
      → Compute contentHash = hashString(await Bun.file(absPath).text()).
      → If contentHash !== existing.contentHash → changed.
      → Else → unchanged (mtime changed but content same; update mtime in DB).
   e. If mtimeMs AND size match → unchanged.
4. For each DB record not in scan results → deleted.
5. Return { changed, unchanged, deleted }.
```

**Optimization**: mtime+size check first (cheap). Content hash only when mtime or size differs.

### 13.2 SymbolIndexer

#### `indexFileSymbols(options: { parsed: ParsedFile; project; filePath; contentHash; symbolRepo }): void`

**Members flattening policy**: Class/interface/enum members are stored as **separate symbol rows** in addition to being present in the parent's `detail_json.members`. This enables FTS5 name search to find individual methods/properties. Each member row has the same `file_path` and `project` as its parent. The member's `name` is stored as `ClassName.memberName` (dot-separated) to distinguish from top-level symbols.

```
1. extractSymbols(parsed) → symbols[].
2. Flatten: for each symbol with members[], add each member as a separate entry
   with name = `${parentName}.${memberName}`.
3. For each symbol (including flattened members), compute:
   - signature: for function/method → `params:${paramCount}|async:${isAsync ? 1 : 0}`. Else null.
   - fingerprint: hashString(`${name}|${kind}|${signature ?? ''}`).
   - detail_json: JSON.stringify of rich metadata fields
     (parameters, returnType, typeParameters, modifiers, heritage,
      decorators, members, jsDoc). Omit undefined fields.
4. symbolRepo.replaceFileSymbols(project, filePath, contentHash, symbolRecords).
```

### 13.3 RelationIndexer

#### `indexFileRelations(options: { ast: Program; project; filePath; relationRepo; projectRoot; tsconfigPaths?: TsconfigPaths }): void`

`filePath` is **relative** to `projectRoot`.

```
1. absoluteFilePath = path.resolve(projectRoot, filePath).
2. extractRelations(ast, absoluteFilePath, tsconfigPaths) → relations[].
3. Normalize all file paths in relations to relative (from projectRoot).
4. Filter: discard relations where src or dst filePath starts with '..'
   (points outside project).
5. relationRepo.replaceFileRelations(project, filePath, normalizedRelations).
```

### 13.4 IndexCoordinator

Orchestrates the full indexing pipeline. Connects watcher events to incremental reindexing.

**Constructor**:

```typescript
new IndexCoordinator(options: {
  projectRoot: string;
  boundaries: ProjectBoundary[];
  extensions: string[];
  ignorePatterns: string[];
  dbConnection: DbConnection;
  parseCache: ParseCache;
})
```

**Fields**:

- `private boundaries: ProjectBoundary[]` — project boundary cache. Refreshed on `package.json` change.
- `private tsconfigPaths: TsconfigPaths | null` — loaded on startup via `loadTsconfigPaths(projectRoot)`. Refreshed when watcher detects `tsconfig.json` change.
- `private indexingLock: boolean = false` — prevents re-entrant indexing (see §13.4 concurrency).
- `private pendingQueue: FileChangeEvent[] = []` — debounce buffer.
- `private onIndexedCallbacks: Set<(result: IndexedResult) => void>` — registered listeners.

**Startup sequence** (called by CodeLedger facade):

```
1. this.tsconfigPaths = loadTsconfigPaths(projectRoot).
2. Register watcher callback: watcher events that match 'tsconfig.json' or 'jsconfig.json'
   → this.tsconfigPaths = loadTsconfigPaths(projectRoot).
   → Re-index all files via fullIndex()
     (tsconfig path changes may affect all relation extractions).
```

`tsconfigPaths` is owned solely by `IndexCoordinator`. The CodeLedger facade reads `this.coordinator.tsconfigPaths` (see §16.6), so updates are automatically visible without a sync callback.

**Methods**:

#### `fullIndex(): Promise<IndexResult>`

Full project reindex from scratch.

```typescript
interface IndexResult {
  indexedFiles: number;
  removedFiles: number;
  totalSymbols: number;
  totalRelations: number;
  durationMs: number;
}
```

Algorithm:

```
1. fileIndexer.detectChanges({ projectRoot, extensions, ignorePatterns, fileRepo })
   → { changed: ALL files, deleted: [] }.
   (In full mode, treat every scanned file as changed.)
2. Begin transaction.
3. Clear all files in the workspace: `DELETE FROM files`.
   (symbols and relations cascade via FK ON DELETE CASCADE.
    Full index rebuilds ALL projects, so all rows are cleared.)
4. For each changed file:
   a. Read source: await Bun.file(absPath).text().
   b. parseSource(filePath, sourceText) → parsed.
   c. parseCache.set(filePath, parsed).
   d. symbolIndexer.indexFileSymbols(parsed, ...).
   e. relationIndexer.indexFileRelations(parsed.program, ..., this.tsconfigPaths).
   f. fileRepo.upsertFile(fileEntry).
5. Commit transaction.
6. Return stats.
```

#### `incrementalIndex(changedFiles?: FileChangeEvent[]): Promise<IndexResult>`

Reindex only changed files. If `changedFiles` is not provided, uses `fileIndexer.detectChanges()` to determine the changeset.

```
1. Determine changeset:
   a. If changedFiles provided → use directly.
   b. Else → fileIndexer.detectChanges().
2. Begin transaction.
3. Process deleted files:
   a. Snapshot fingerprints of symbols in deleted files (for move tracking).
   b. Delete file records, symbols cascade via FK.
4. Process changed/created files:
   a. For each file:
      i.   Read source, parseSource → parsed.
      ii.  parseCache.set(filePath, parsed).
      iii. symbolIndexer.indexFileSymbols(parsed, ...).
      iv.  relationIndexer.indexFileRelations(parsed.program, ..., this.tsconfigPaths).
      v.   fileRepo.upsertFile(fileEntry).
5. Move tracking (fingerprint-based):
   a. Match deleted symbols ↔ new symbols by fingerprint.
   b. Only 1:1 matches are accepted (ambiguous = skip).
   c. For each match: relationRepo.retargetRelations(old → new).
6. Commit transaction.
7. Return stats.
```

**Move tracking algorithm** (step 5 detail):

```
1. deletedSymbols: Map<fingerprint, SymbolRecord[]> — grouped from snapshots.
2. newSymbols: Map<fingerprint, SymbolRecord[]> — symbols in newly added files only.
3. For each fingerprint present in BOTH maps:
   a. If deletedSymbols[fp].length === 1 AND newSymbols[fp].length === 1:
      → This is a move. Retarget all relations referencing old → new.
   b. Else: skip (ambiguous).
```

#### `handleWatcherEvent(event: FileChangeEvent): void`

Called by the watcher integration. **Synchronous** — only pushes to the pending queue and manages the debounce timer. The actual async `incrementalIndex()` is triggered by the timer callback, not by this method. This ensures the watcher's try-catch (§9.2) catches any synchronous errors.

```
1. Add event to internal pending queue.
2. If debounce timer is not running:
   a. Start timer (100ms).
   b. After timer: flush queue → incrementalIndex(batch).
```

**Debounce constant**: `WATCHER_DEBOUNCE_MS = 100`.

**Note on event coalescing**: `@parcel/watcher` throttles and coalesces events in C++ natively. During large changes like `git checkout` or `npm install`, a single callback is emitted with all events. The 100ms debounce is a secondary defense for rapid sequential changes not caught by the native layer.

#### `onIndexed(callback: (result: IndexedResult) => void): () => void`

Registers a callback that fires immediately after each `incrementalIndex()` completes. Returns an unsubscribe function.

```typescript
interface IndexedResult {
  changedFiles: string[];     // Files that were reindexed.
  deletedFiles: string[];     // Files that were removed from index.
  totalSymbols: number;       // Total symbols across changed files.
  totalRelations: number;     // Total relations across changed files.
  durationMs: number;
}
```

The callback is invoked once per debounced batch. Since `@parcel/watcher` already coalesces events at the C++ level and code-ledger applies 100ms debounce, consumers receive infrequent, batched notifications without needing their own debounce.

Multiple callbacks can be registered. They are called in registration order. If a callback throws, the error is logged via `console.error` but other callbacks still execute.

#### Concurrency: Indexing Lock

`IndexCoordinator` maintains an `indexingLock: boolean` flag to prevent re-entrant indexing:

```
handleWatcherEvent / incrementalIndex / fullIndex:
  1. If this.indexingLock === true:
     → Queue events for next cycle. Do NOT start a new indexing run.
  2. this.indexingLock = true.
  3. try { ... perform indexing ... } finally { this.indexingLock = false; }
  4. If pending queue is non-empty after unlock → schedule next debounce cycle.
```

This prevents conflicts between `fullIndex` (startup/tsconfig change) and `incrementalIndex` (watcher events) running simultaneously.

#### Shutdown Protocol

`shutdown(): Promise<void>`:

```
1. Cancel debounce timer (clearTimeout).
2. If this.indexingLock === true:
   → Wait for current indexing to complete (await internal promise).
3. watcher.close().
4. clearInterval(heartbeat/healthCheck timer).
5. releaseWatcherRole(db, process.pid).
6. db.close().
```

Shutdown waits for in-flight indexing to finish before closing resources. This prevents DB corruption from mid-transaction termination.

---

## 14. Search Module

### 14.1 symbolSearch

```typescript
function symbolSearch(options: {
  symbolRepo: SymbolRepository;
  project?: string;
  query: SymbolSearchQuery;
}): SymbolSearchResult[]

interface SymbolSearchQuery {
  text?: string;             // FTS5 match expression. Applied to name and file_path.
  kind?: SymbolKind;         // Filter by symbol kind.
  filePath?: string;         // Filter by exact file path.
  isExported?: boolean;      // Filter by export status.
  project?: string;          // Filter by project name. If omitted, searches all projects.
  limit?: number;            // Max results. Default: 100.
}

interface SymbolSearchResult {
  id: number;
  filePath: string;
  kind: SymbolKind;
  name: string;
  span: SourceSpan;
  isExported: boolean;
  signature: string | null;
  fingerprint: string | null;
  detail: ExtractedSymbolDetail;   // Parsed from detail_json.
}

// Subset of ExtractedSymbol stored in detail_json.
// Only fields with values are included; undefined fields are omitted.
interface ExtractedSymbolDetail {
  parameters?: Parameter[];
  returnType?: string;
  typeParameters?: string[];
  modifiers?: Modifier[];
  heritage?: Heritage[];
  decorators?: Decorator[];
  members?: ExtractedSymbolDetail[];   // Recursive for class/interface/enum members.
  jsDoc?: JsDocBlock;
  methodKind?: 'method' | 'getter' | 'setter' | 'constructor';
}
```

Query building:

- If `text` is provided → auto-append `*` to each token for prefix matching (e.g., `"User"` → `"User*"`). This enables camelCase/PascalCase partial matching: `"User*"` matches `UserService`, `UserRepo`, etc.
- `SELECT * FROM symbols_fts WHERE symbols_fts MATCH ? ... JOIN symbols`.
- Additional WHERE clauses for `kind`, `filePath`, `isExported`.
- `LIMIT` applied.
- `detail_json` is parsed to hydrate the `detail` field.

### 14.2 relationSearch

```typescript
function relationSearch(options: {
  relationRepo: RelationRepository;
  project?: string;
  query: RelationSearchQuery;
}): CodeRelation[]

interface RelationSearchQuery {
  srcFilePath?: string;
  srcSymbolName?: string;
  dstFilePath?: string;
  dstSymbolName?: string;
  type?: CodeRelation['type'];
  project?: string;          // Filter by project name. If omitted, searches all projects.
  limit?: number;            // Default: 500.
}
```

### 14.3 DependencyGraph

Builds and queries an in-memory directed graph of module-level import dependencies.

**Constructor**: `new DependencyGraph(options: { relationRepo: RelationRepository; project: string })`

**Methods**:

#### `build(): Promise<void>`

```
1. Load all relations where type = 'imports' for this project.
2. For each: add directed edge src_file_path → dst_file_path.
3. Store as adjacency list Map<string, Set<string>>.
4. Store reverse adjacency list Map<string, Set<string>>.
```

#### `getDependencies(filePath: string): string[]`

Direct imports of the given file. Returns `Array.from(adjacencyList.get(filePath) ?? [])`.

#### `getDependents(filePath: string): string[]`

Files that import the given file. Returns `Array.from(reverseAdjacencyList.get(filePath) ?? [])`.

#### `getTransitiveDependents(filePath: string): string[]`

BFS from filePath following reverse edges. Returns all transitively affected files. Does NOT include the input `filePath` itself.

Algorithm:

```
1. visited = new Set<string>()
2. queue = [filePath]
3. while queue is not empty:
   a. current = queue.shift()
   b. for each dependent of current (via reverse adjacency):
      → if not in visited: add to visited, push to queue
4. return Array.from(visited)
```

#### `hasCycle(): boolean`

DFS-based cycle detection on the entire graph.

#### `getAffectedByChange(changedFiles: string[]): string[]`

Union of `getTransitiveDependents` for all `changedFiles`. Deduplicated.

---

## 15. Common Module

### 15.1 hashString

`hashString(input: string): string`

Uses `Bun.hash.xxHash64(input)`. Returns 16-character zero-padded lowercase hex string.

```
1. const raw = Bun.hash.xxHash64(input);  // returns number | bigint
2. const unsigned = BigInt.asUintN(64, BigInt(raw));
3. return unsigned.toString(16).padStart(16, '0');
```

### 15.2 hashFile

`hashFile(filePath: string): Promise<string>`

```
1. const text = await Bun.file(filePath).text();
2. return hashString(text);
```

### 15.3 Path Utilities (path-utils.ts)

#### `toRelativePath(projectRoot: string, absolutePath: string): string`

`path.relative(projectRoot, absolutePath)` with `\\` replaced by `/`.

#### `toAbsolutePath(projectRoot: string, relativePath: string): string`

`path.resolve(projectRoot, relativePath)`.

### 15.4 LruCache<K, V>

Generic LRU cache using `Map` insertion-order semantics.

**Constructor**: `new LruCache<K, V>(capacity: number)`

| Method | Signature | Description |
|---|---|---|
| `get` | `(key: K) → V \| undefined` | Returns value and moves to most-recent. |
| `set` | `(key: K, value: V) → void` | Inserts. Evicts LRU if at capacity. |
| `delete` | `(key: K) → boolean` | Removes entry. |
| `clear` | `() → void` | Removes all entries. |
| `has` | `(key: K) → boolean` | Existence check without moving. |
| `size` | `readonly number` | Current entry count. |

---

## 16. Public API — CodeLedger Facade

### 16.1 Overview

`CodeLedger` is the **single entry point** for consumers. It owns all internal components, manages their lifecycle, and provides a clean API surface. Consumers never instantiate `DbConnection`, `IndexCoordinator`, or `ProjectWatcher` directly.

**Location**: `src/index.ts` (re-exports `CodeLedger` class + all public types).

### 16.2 CodeLedger Class

```typescript
class CodeLedger {
  // --- Static factory ---
  static async open(options: CodeLedgerOptions): Promise<CodeLedger>;

  // --- Properties (readonly, exposed to consumers) ---
  readonly projectRoot: string;
  readonly search: SearchAPI;

  // --- Lifecycle ---
  async close(): Promise<void>;

  // --- Direct parse/extract (stateless, no DB required) ---
  parseSource(filePath: string, sourceText: string): ParsedFile;
  extractSymbols(parsed: ParsedFile): ExtractedSymbol[];
  extractRelations(parsed: ParsedFile): CodeRelation[];

  // --- Event subscription ---
  onIndexed(callback: (result: IndexedResult) => void): () => void;
}

interface SearchAPI {
  symbols(query: SymbolSearchQuery): SymbolSearchResult[];
  relations(query: RelationSearchQuery): CodeRelation[];
  dependencyGraph(project?: string): DependencyGraph;
}
```

**Project resolution in SearchAPI**: The facade internally resolves `project` for each search method:
- If `query.project` (or the `project` argument for `dependencyGraph`) is provided → use it.
- If omitted AND workspace is a single project → use the root project.
- If omitted AND workspace is a monorepo → search across **all** projects (union results).

This allows consumers to query a specific project or the entire workspace transparently.

### 16.3 `CodeLedger.open()` — Startup Sequence

```
1. Validate options (projectRoot must be absolute, must exist).
2. dbConnection = new DbConnection({ projectRoot }).
3. dbConnection.open() → WAL, migrations.
4. boundaries = discoverProjects(projectRoot).
5. parseCache = new ParseCache(options.parseCacheCapacity ?? 500).
6. Create repositories: fileRepo, symbolRepo, relationRepo.
7. role = acquireWatcherRole(dbConnection, process.pid).
8. If role === 'owner':
   a. watcher = new ProjectWatcher({ projectRoot, ignorePatterns, extensions }).
   b. coordinator = new IndexCoordinator({
        projectRoot, boundaries,
        extensions, ignorePatterns, dbConnection, parseCache
      }).
   c. watcher.start(coordinator.handleWatcherEvent).
   d. Start heartbeat timer (30s interval).
   e. coordinator.fullIndex() → initial indexing.
9. If role === 'reader':
    a. Start health check timer (60s interval → check owner liveness).
    b. On owner death → re-acquire as owner → start watcher + coordinator.
10. Register process signal handlers (SIGTERM, SIGINT, beforeExit → close()).
11. Return new CodeLedger instance.
```

### 16.4 Monorepo / Multi-Project Handling

**Architecture**: One `ProjectWatcher` per workspace. One `IndexCoordinator` per workspace. Multiple `project` values within the same DB.

The watcher watches the entire `projectRoot`. When a file change event arrives, `IndexCoordinator.handleWatcherEvent(event)` is called. The coordinator resolves the project internally:

```
1. relativePath from event.filePath.
2. project = resolveFileProject(relativePath, this.boundaries).
3. Use project when writing DB records (files, symbols, relations).
```

The `project` field in all schema tables enables per-project queries.

**Boundary refresh**: When `package.json` changes are detected, `discoverProjects()` re-runs and `boundaries` cache is replaced. If a new project appears (new package.json), files under that path are re-assigned on next incremental index.

**Single coordinator, multi-project**: `IndexCoordinator` is NOT project-scoped. It processes all files in the workspace and delegates `project` resolution to `resolveFileProject()`. The constructor's `project` parameter (§13.4) is removed — coordinator resolves project per-file.

### 16.5 `CodeLedger.close()` — Shutdown Sequence

```
1. coordinator.shutdown() → waits for in-flight indexing.
2. watcher.close() → unsubscribes OS watcher.
3. clearInterval(heartbeat/healthCheck timer).
4. releaseWatcherRole(dbConnection, process.pid).
5. dbConnection.close().
```

### 16.6 Stateless API Methods

`parseSource`, `extractSymbols`, `extractRelations` are thin wrappers over the module functions. They pass through the instance's `parseCache` automatically. `tsconfigPaths` is owned solely by `IndexCoordinator` — the facade accesses it via the coordinator:

```typescript
// Inside CodeLedger class:
parseSource(filePath: string, sourceText: string): ParsedFile {
  const parsed = parseSourceFn(filePath, sourceText);
  this.parseCache.set(filePath, parsed);
  return parsed;
}

extractSymbols(parsed: ParsedFile): ExtractedSymbol[] {
  return extractSymbolsFn(parsed);
}

extractRelations(parsed: ParsedFile): CodeRelation[] {
  return extractRelationsFn(parsed.program, parsed.filePath, this.coordinator.tsconfigPaths);
}
```

Consumers can use these without triggering DB writes. DB persistence happens only through the watcher→coordinator pipeline or explicit `fullIndex()`.

---

## 17. Implementation Phases

| Phase | Scope | Deliverables | Depends on |
|---|---|---|---|
| **1** | common + errors + watcher | `CodeLedgerError` hierarchy, `hashString`, `LruCache`, path-utils, `tsconfig-resolver`, `ProjectWatcher`, `acquireWatcherRole`, `releaseWatcherRole`, `discoverProjects`, `resolveFileProject` | — |
| **2** | parser + extractor | `parseSource`, `ParseCache`, all AST utils, `buildLineOffsets`, `getLineColumn`, `parseJsDoc`, `extractSymbols` (8 kinds + rich metadata + jsDoc), `extractRelations` (4 sub-extractors), `buildImportMap`, `resolveImport`, `loadTsconfigPaths` | Phase 1 (errors, common) |
| **3** | store + indexer | Drizzle schema + migrations + FTS triggers, `watcher_owner` table, `DbConnection`, 3 repositories, `FileIndexer`, `SymbolIndexer`, `RelationIndexer`, `IndexCoordinator` (full + incremental + move tracking + indexing lock + shutdown) | Phase 1, Phase 2 |
| **4** | search + facade | `symbolSearch`, `relationSearch`, `DependencyGraph`, `CodeLedger` facade class, `SearchAPI` | Phase 3 |

---

## 18. Consumer Usage Patterns

### zipbul CLI

```
codeLedger.parseSource(file, code)
codeLedger.extractSymbols(parsed)       // jsDoc.tags → filter @see → card-code link
codeLedger.extractRelations(parsed)     // imports/calls/extends/implements
zipbul.AstParser(parsed)               // DI-specific extraction (on top of codeLedger)
```

### firebat

```
codeLedger.parseSource(file, code)
codeLedger.extractSymbols(parsed)       // members, modifiers for analysis
firebat.engine(parsed)                  // fingerprint, CFG, duplicates
```

### agent-kit

```
const symbols = ledger.search.symbols({ text: 'handleRequest', project: '@ws/web' })
const relations = ledger.search.relations({ srcFilePath: 'src/handler.ts' })
agentKit.linkCard(cardKey, {            // card-symbol link (agent-kit's own DB)
  project, filePath, symbolName, symbolKind  // natural key (see §20)
})
```

### Event-driven integration

Consumers register an `onIndexed` callback to react to indexing events:

```
const unsub = ledger.onIndexed((result) => {
  // result.changedFiles, result.deletedFiles, result.durationMs
  zipbul.refreshCardCodeLinks(result.changedFiles)
})
```

---

## 19. Success Criteria

1. firebat, agent-kit, and zipbul CLI share a single code infrastructure package with zero code duplication for AST parsing, symbol extraction, and code indexing.
2. Multiple processes on the same project run only 1 OS-level file watcher via DB-based watcher coordination (`watcher_owner` table with PID liveness check + heartbeat).
3. One code index DB per project (`.zipbul/code-ledger.db`), shared by all consumers via SQLite WAL mode.
4. No framework dependency. Configuration via `CodeLedgerOptions` only.
5. No MCP server. No MCP tool definitions. No MCP transport. Pure infrastructure.
6. AST parser provides rich enough data (8 symbol kinds, parameters, heritage, decorators, members, jsDoc) that consumers never need to re-parse.
7. Every error is thrown with a module-specific error class and chained `cause`.
8. Incremental indexing re-processes only changed files. Move tracking preserves relations when files are renamed.
9. `onIndexed` callback enables consumers to react to indexing events without polling.
10. tsconfig `paths` aliases are resolved correctly in relation extraction.

---

## 20. DB Ownership & Consumer Separation Policy

### 원칙

code-ledger는 `.zipbul/code-ledger.db`의 **유일한 소유자**이다. 모든 소비자(firebat, bunner, agent-kit 등)는 code-ledger의 공개 API(Search 모듈, Repository)만을 통해 코드 인덱스 데이터에 접근한다.

### 금지 사항

- 소비자가 `code-ledger.db`를 직접 열어서(open) 쿼리하는 것
- 소비자가 code-ledger 스키마에 테이블을 추가하는 것
- 소비자가 code-ledger의 내부 스키마 구조에 의존하는 것

### 소비자 데이터 분리

소비자 고유 데이터(카드, 태그, 아티팩트 등)는 별도의 DB 파일에 저장한다:

```
.zipbul/
  code-ledger.db      ← code-ledger 소유 (코드 인덱스)
  bunner.db            ← bunner 소유 (route 카드, 컴포넌트 메타 등)
  firebat.db           ← firebat 소유 (품질 시그널, 스코어 등)
```

### 심볼 참조 규약

소비자 DB에서 code-ledger의 심볼을 참조할 때는 **자연키(natural key)** 를 사용한다:

```typescript
// 소비자 DB 테이블 예시
interface ConsumerSymbolRef {
  project: string     // package.json name. e.g., '@ws/web'
  filePath: string    // 프로젝트 상대 경로
  symbolName: string  // 심볼 이름
  symbolKind: string  // 'function' | 'class' | ... (8 kinds)
}
```

code-ledger의 내부 rowid나 auto-increment ID를 외래키로 사용하지 않는다. 자연키를 사용하면 code-ledger DB가 재생성되어도 소비자 데이터가 깨지지 않는다.

### API 접근 패턴

```typescript
import { CodeLedger } from '@zipbul/code-ledger'

// ✅ 올바른 접근: API를 통한 조회
const ledger = await CodeLedger.open({ projectRoot })
const symbols = ledger.search.symbols({ text: 'handleRequest' })
const graph = ledger.search.dependencyGraph()
const deps = graph.getDependents('src/handler.ts')

// ❌ 금지: 직접 DB 접근
// import Database from 'bun:sqlite'
// const db = new Database('.zipbul/code-ledger.db')  // NEVER
```
