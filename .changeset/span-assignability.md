---
'@zipbul/gildash': minor
---

feat(semantic): `isTypeAssignableToTypeAtSpan` — span-based assignability check

The span counterpart of `isTypeAssignableToTypeAtPositions`' single check:
resolves the **expression node exactly spanning a byte range** (so a
`NewExpression`/`CallExpression` like `new CustomError()` works, where the
identifier-only position resolver returns `null`) and reports whether its type is
assignable to a `targetTypeExpression`.

```ts
isTypeAssignableToTypeAtSpan(
  filePath: string,
  span: ByteSpan,
  targetTypeExpression: string,
  options?: { anyConstituent?: boolean },
): boolean | null
```

Completes the 0.33.0 span family (type / thenable / contextual-returns) with the
assignability query — e.g. "is this throw value an `Error` subtype?". Transitive
subclassing and `anyConstituent` union handling work as in the position-based
`isTypeAssignableToType`. Returns `null` when the span resolves no node or the
source/target type cannot be resolved.
