---
'@zipbul/gildash': minor
---

feat(semantic): span-based type primitives — `getExpressionTypeAtSpan`, `isThenableAtSpan`, `getContextualCallReturnsAtSpan`

Three read-only primitives that resolve a type fact for the **expression node
exactly spanning a byte range** (`ByteSpan { start, end }`, aligned 1:1 with
`oxc-parser` node offsets). They match the node whose `[getStart(), getEnd())`
equals the span exactly, or return `null` (no nearest-node fallback) — so a
caller that already has an expression's byte range can ask gildash about that
exact expression without a position-proxy.

- `getExpressionTypeAtSpan(filePath, span): ResolvedType | null` — the type of
  the spanned expression. Unlike `getResolvedTypeAtPosition` (innermost node at a
  single offset, identifier/type-node only), this accepts any expression, so a
  call `f()` resolves to the call **result** type, `obj.m()` to the method
  return, `obj.prop` to the property type.
- `isThenableAtSpan(filePath, span, { anyConstituent? }): boolean | null` — a
  language-level thenable predicate (callable `then` whose signature has ≥1
  parameter — the ECMAScript / typescript-eslint definition). Recurses
  union/intersection on the live type (so `A & PromiseLike<X>` is detected) and
  excludes `any`.
- `getContextualCallReturnsAtSpan(filePath, span): ResolvedType[] | null` — the
  return types of the call signatures of the **contextual type** at an argument
  span (overload-selected; `undefined`/`null` stripped before signature
  enumeration). `[]` when the slot expects no callable; `null` when there is no
  contextual type.

`ResolvedType` and the existing collector are unchanged. Also exports the
`ByteSpan` type.
