---
"@zipbul/gildash": minor
---

feat: structured expression values, enum/property initializers, and pattern captures

### Breaking Changes

- `Decorator.arguments` type changed from `string[]` to `ExpressionValue[]`. Decorator arguments are now recursively structured instead of raw source text.

### New Features

- **`ExpressionValue` type** — discriminated union (13 kinds) for structured representation of JS/TS expressions: `string`, `number`, `boolean`, `null`, `undefined`, `identifier`, `member`, `call`, `new`, `object`, `array`, `spread`, `function`, `template`, `unresolvable`. Recursive with depth limit of 8.
- **Enum member initializers** — `ExtractedSymbol.initializer` now populated for enum members (e.g. `Get = 'GET'` → `{ kind: 'string', value: 'GET' }`).
- **Class property type annotations** — `returnType` now populated for class properties, consistent with interface properties.
- **Class property initializers** — `initializer` populated for class properties with default values.
- **Class property decorators** — decorators on class properties now extracted and stored in `detailJson`.
- **Variable initializers** — non-function variable initializers stored as `ExpressionValue` (e.g. `const cfg = defineModule({...})` → structured call expression).
- **Pattern match captures** — `PatternMatch.captures` returns named metavariable captures (`$NAME`, `$$$NAME`) from ast-grep patterns, with text and line positions.
