---
"@zipbul/gildash": minor
---

feat: export parseSource, extractSymbols, extractRelations from main entrypoint

These standalone functions were implemented internally but not exported, preventing per-file parse/extract without a Gildash instance.
