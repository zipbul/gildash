---
"@zipbul/gildash": patch
---

chore: bump oxc-parser from 0.121.0 to 0.127.0

Picks up upstream parser improvements between 0.122 and 0.127. Public API surface (`parseSync`, `ParserOptions`, `Program`, `Comment`, `OxcError`, `EcmaScriptModule`) is unchanged — the only `BREAKING` entry in the range is in the Rust `oxc_span` crate (string type re-exports) and does not affect the NAPI binding consumed here. Notable upstream changes: NAPI raw-transfer deserializer now uses `Int32Array` (parsing throughput improvement), `turbopack` magic comment support, additional TS diagnostic codes, and pure comment marking fixes.
