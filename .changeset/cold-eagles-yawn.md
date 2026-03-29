---
"@zipbul/gildash": patch
---

fix: correct PID recycling false positive, span precision for multi-declarator exports and destructuring, project key desync on boundary refresh

- Fix PID recycling check in `acquireWatcherRole`: the condition `owner.pid !== pid` was always true for reader processes, causing any reader with `instanceId` to immediately take over from a healthy owner. Changed to `owner.pid === pid` so recycling detection only fires when the OS actually recycled the PID to the calling process. This restores the single-writer guarantee for multi-process deployments.
- Fix `ExportNamedDeclaration` handler: stop overwriting individual declarator spans with the parent export statement span for multi-declarator exports (`export const a = …, b = …`). Each symbol now retains its precise source position in the database.
- Fix `collectBindingNames`: return `{name, start, end}` instead of bare strings so each destructured variable (`const { a, b } = x`) gets its own identifier span instead of sharing the pattern's span.
- Fix project key desync on `package.json` name change: trigger `fullIndex` (like `tsconfig.json`) and propagate updated boundaries to `GildashContext` via `onBoundariesChanged` callback, preventing stale query results and orphaned records.
