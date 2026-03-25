# Future: Blocked by External Dependencies

This document tracks features that require upstream fixes before implementation.

---

## oxc-parser Raw Transfer (Zero-Copy AST)

**Blocked by**: Bun JavaScriptCore 4GiB ArrayBuffer limit

### What it is

oxc-parser provides `rawTransferSupported()` and an `experimentalRawTransfer` option that enables zero-copy AST transfer from Rust to JavaScript. Instead of serializing/deserializing the AST across the Rust-JS boundary, Rust writes directly into a shared `ArrayBuffer` and JS reads from it — transfer cost drops to near zero.

### Why it matters

Current flow: Rust parses → serializes AST → JS deserializes (the deserialization dominates, 3-20x slower than parsing itself).

With raw transfer: Rust parses → writes to shared buffer → JS reads directly. The AST transfer overhead is eliminated.

This would make `parseSync` significantly faster for large files and batch indexing scenarios (fullIndex).

### Why it's blocked

Raw transfer allocates a 6GiB `ArrayBuffer` (2GiB data + 4GiB alignment padding) per parse operation.

Bun uses JavaScriptCore (JSC), which tracks typed array lengths as `uint32_t`. Maximum allocation: exactly `4,294,967,296` bytes (4GiB). Anything above fails with `Out of memory`.

```
Required: 6GiB (6,442,450,912 bytes)
Bun max:  4GiB (4,294,967,296 bytes)
Deficit:  2GiB
```

oxc-parser hard-blocks Bun in `src-js/raw-transfer/supported.js`:

```js
const isBun = !!global.Bun || !!global.process?.versions?.bun;
if (isBun) return false;
```

Even bypassing the detection check, the 6GiB allocation itself fails on Bun.

### Unblock conditions

One of:
1. WebKit/JSC upgrades typed array length tracking beyond `uint32_t` (upstream)
2. Bun switches to a different memory model for large ArrayBuffers
3. oxc-parser reduces raw transfer buffer requirements below 4GiB

### Currently supported runtimes

- Node.js >= 22.0.0
- Deno >= 2.0.0

### Tracking

- oxc allocator revamp: https://github.com/oxc-project/oxc/issues/20513
- Bun 4GiB issue (closed, only fixed error handling): https://github.com/oven-sh/bun/issues/4897
- JSC ArrayBuffer internals: https://github.com/WebKit/webkit/blob/main/Source/JavaScriptCore/runtime/ArrayBuffer.cpp
