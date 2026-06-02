---
"@zipbul/gildash": patch
---

Internal hardening — no public API change.

Bug fixes (behavioral):
- File/graph query APIs (`getFileStats`, `getFileInfo`, `getFullSymbol`,
  `getDependencies`/`getDependents`, `getTransitiveDependencies`/`getTransitiveDependents`,
  `getAffected`, `getFanMetrics`) now normalize an absolute `filePath` to the store's
  project-relative domain instead of silently returning empty/throwing.

Hardening:
- Compiler-enforced branded path types (`RelPath`) at query sinks.
- Single `guard` primitive replaces ~63 hand-copied closed-check/error-wrap blocks;
  callback subscriptions now reject use after close.
- Re-typed extractor/ast-utils against oxc's typed AST and typed the DB enum columns
  (kind/type/source) end-to-end, removing ~105 unsound `as` casts. Remaining casts are
  sanctioned (brand mint, deserialization boundaries, documented oxc/ts upstream gaps —
  see oxc-project/oxc#22134).
- Removed dead code: `getNodeHeader`/`getNodeName`/`getStringLiteralValue`,
  `SymbolRepository.searchByName`/`searchByKind`, `TscProgram.getChecker`,
  unused `absPath`/`inboundAbsPath`.
