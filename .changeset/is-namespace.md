---
'@zipbul/gildash': minor
---

feat(ast): expose `is` namespace covering every `Node['type']` discriminator

A new `is` namespace exposes a per-discriminator type predicate for every literal in the oxc-parser `Node['type']` union — and for any literal upstream adds in the future — without per-type hand-written code:

```ts
import { is, walk, parseSource } from '@zipbul/gildash';

walk(program, {
  enter(node) {
    if (is.CallExpression(node)) console.log(node.arguments);
    if (is.ClassDeclaration(node)) console.log(node.id?.name);
    if (is.ImportDeclaration(node)) console.log(node.source.value);
  },
});
```

**Type-level shape**: `is.X(node)` narrows to `Node & { type: 'X' }`. The intersection form is used (rather than `Extract<Node, { type: 'X' }>`) so fields on backing interfaces with multi-literal `type` unions — `Function` (4-way) and `Class` (2-way) — remain accessible inside the narrowed branch.

**Runtime shape**: backed by a `Proxy` whose `get` trap accepts only PascalCase keys; symbols, lowercase typos (`is.callExpression`), and Object-prototype names (`then`, `toString`, `toJSON`, `valueOf`, `constructor`, `hasOwnProperty`) fall through to the empty target via `Reflect.get`. As a result `String(is)` returns `"[object Object]"`, `JSON.stringify(is)` returns `"{}"`, and `await Promise.resolve(is)` resolves to `is` itself instead of deadlocking on a fake thenable. Predicate functions are cached by discriminator, so `is.CallExpression === is.CallExpression` holds — safe to pass directly to `Array#filter`. Calling a predicate with `null` / `undefined` returns `false`.

**Hand-written predicates kept**: `isFunctionDeclaration`, `isFunctionExpression`, `isIdentifier`, `isMemberExpression`, `isTSQualifiedName`, and `isFunctionNode` remain exported because their JSDoc encodes runtime semantics that the bare discriminator does not (collision narrowing, Function-interface caveat, union shorthand). The four single-discriminator legacy predicates (`isArrowFunctionExpression`, `isAssignmentExpression`, `isCallExpression`, `isVariableDeclaration`) also stay for backward compatibility — pointwise-equivalent to `is.X`. No deprecations.

**New types exported**: `IsNamespace` and `NodeTypePredicate<K>`.

**README**: "AST Primitives" section adds a primary `is` subsection, a migration table from the named predicates, and a composition example showing how `searchSymbols` (indexed view) and `parseSource` + `walk` + `is.X` (raw / positional view) compose via `sym.span` + name match without requiring byte offsets on `ExpressionValue`.
