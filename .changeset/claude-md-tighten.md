---
'@zipbul/gildash': patch
---

chore(docs): tighten CLAUDE.md scope, move oxc upgrade runbook to `docs/runbooks/`

`CLAUDE.md` had grown to host content that did not belong there — an architecture diagram duplicating the README, the `bun test` / `bun run build` command list duplicating `package.json` scripts, and a 15-line oxc-parser upgrade checklist that was a narrow operational runbook (not an AI behavior rule). All three were paid as a permanent context tax on every Claude Code session.

This release:

- **Compresses `CLAUDE.md`** to its actual scope: project context (1 paragraph), conventions, test conventions, error-handling boundary rules, and the Gate 1–6 audit rules. 148 → 63 lines.
- **Moves the oxc upgrade checklist** to `docs/runbooks/upgrading-oxc.md` and adds an entry covering the new `is` namespace / `IsNamespace` mapped type (which TypeScript validates against the new `Node['type']` automatically — no manual sync).

No public API changes. No behavior changes. Pure docs/runbook reorganization.
