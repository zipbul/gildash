---
"@zipbul/gildash": patch
---

fix: heartbeat timer checks ctx.closed before DB access

Prevents "Database is not open" error caused by race condition between close() and heartbeat timer during owner promotion.
