---
"@zipbul/gildash": patch
---

Harden core internals without changing the public API surface:

- Fix latent absolute-path bugs: `getFileStats`, `getFileInfo`, `getFullSymbol`,
  `getDependencies`/`getDependents`, and the graph APIs (`getTransitiveDependencies`/
  `getTransitiveDependents`/`getAffected`/`getFanMetrics`) now normalize an absolute
  `filePath` to the store's project-relative domain instead of silently missing.
- Introduce compiler-enforced branded path types (`RelPath`/`AbsPath`) so query sinks
  reject un-normalized paths.
- Centralize the facade closed-check + error-wrap into a single `guard` primitive
  (removes ~63 hand-copied guards; callback subscriptions now reject use after close).
- Re-type the extractor/ast-utils against oxc's typed AST, removing ~88 unsound casts.
- Remove dead code (`getNodeHeader`/`getNodeName`/`getStringLiteralValue`).
