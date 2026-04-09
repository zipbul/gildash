---
"@zipbul/gildash": patch
---

perf: semantic layer cleanup — eliminate redundant getProgram/getChecker calls, add snapshot caching, use tsc getTokenAtPosition

- All semantic layer methods now call `getProgram()` once and derive TypeChecker from it directly via `program.getTypeChecker()`, instead of calling `getChecker()` which redundantly invoked `getProgram()` a second time
- Fix `isAssignableTo` where checker and program could originate from different Program instances due to reversed call order
- `LanguageServiceHost.getScriptSnapshot` now caches snapshots for tracked files (keyed by path:version) and non-tracked files (lib.d.ts, node_modules), eliminating redundant `ScriptSnapshot.fromString` allocations and `fs.readFileSync` calls on Program rebuilds
- Replace custom `findNodeAtPosition` DFS traversal with tsc's internal `getTokenAtPosition` for faster node lookup
- Fix race condition: heartbeat timer callback now checks `ctx.closed` before accessing DB, preventing "Database is not open" error during concurrent close
