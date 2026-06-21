---
"@zipbul/gildash": patch
---

Fix silent type loss for deeply-nested literals in the expression extractor.

`convertExpression` capped recursion at depth 8 and returned `unresolvable` for
*any* node at/beyond it, so plain literals inside ordinary nested config — e.g.
`defineModule({ adapters: [{ middlewares: { OnRequest: [corsMiddleware({ origin, maxAge })] } }] })`
— lost their kind with no signal to the caller.

- Raise the recursion cap 8 → 64. The cap is a stack-safety guard only (oxc
  builds the AST in Rust; the walker descends an existing tree), now with ample
  headroom over realistic config nesting while staying far below the call-stack
  ceiling.
- `ExpressionUnresolvable` gains an optional `reason?: 'depth-cap'`. Depth-cap
  truncations are now tagged (recover the value by re-parsing `sourceText`);
  genuinely-unsupported nodes leave `reason` undefined. Centralized via a single
  `unresolvable()` builder.

Behavioral/output note: literals previously truncated at depth 8–63 now resolve
to their real kind, and depth-capped `unresolvable` values now carry `reason`.
Both change serialized extractor output for those nodes.
