---
"@zipbul/gildash": patch
---

feat: add anyConstituent option to isTypeAssignableToType

`isTypeAssignableToType(file, pos, target, { anyConstituent: true })` checks if any member of a union type is assignable to the target, instead of requiring the entire union to be assignable. For non-union types, behavior is unchanged.
