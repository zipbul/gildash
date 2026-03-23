---
"@zipbul/gildash": minor
---

feat: add preEmit option to getSemanticDiagnostics

`getSemanticDiagnostics(filePath, { preEmit: true })` now uses `ts.getPreEmitDiagnostics()` which includes syntactic, semantic, and declaration diagnostics — equivalent to `tsc --noEmit`. This allows consumers to use a single tsc Program managed by gildash instead of creating a separate one for full diagnostics.
