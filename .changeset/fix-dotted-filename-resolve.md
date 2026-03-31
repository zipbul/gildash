---
"@zipbul/gildash": patch
---

fix: resolve imports with dotted filenames (e.g. `scan.usecase`)

- `extname()` misidentified non-TS extensions like `.usecase`, `.controller`, `.service` as real extensions, skipping TypeScript candidate generation.
- Now only recognized TS/JS extensions (`.ts`, `.mts`, `.cts`, `.d.ts`, `.js`, `.mjs`, `.cjs`) are treated as known; all others trigger candidate generation (`.ts`, `.d.ts`, `/index.ts`, etc.).
