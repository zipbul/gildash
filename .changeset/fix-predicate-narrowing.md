---
'@zipbul/gildash': patch
---

fix(ast): predicate narrowing collapsed to `never` for Function-interface variants

`isFunctionDeclaration`, `isFunctionExpression`, and the `FunctionDeclaration` / `FunctionExpression` branches of `isFunctionNode` shipped in 0.27.0 with `Extract<Node, { type: 'X' }>` signatures. Because `@oxc-project/types`' `Function` interface declares `type: FunctionType` (a 4-way union of `FunctionDeclaration | FunctionExpression | TSDeclareFunction | TSEmptyBodyFunctionExpression`), distributive `Extract` over the `Node` union evaluated `Function extends { type: 'FunctionExpression' }` as **false** — `Function`'s `type` field is broader than the constraint — and the entire branch collapsed to `never`. Field access in narrowed branches (`n.params`, `n.body`, `n.id`, …) failed at typecheck with `Property 'X' does not exist on type 'never'`.

All 10 predicates (the 9 added in 0.27.0 plus the strengthened `isFunctionNode`) now use `Node & { type: 'X' }` instead of `Extract<...>`. This form preserves the field accessibility that consumers expect from a type predicate: `Function & { type: 'FunctionExpression' }` keeps every Function-interface field reachable inside the narrowed branch.

Runtime behavior is unchanged — the bug was type-level only. No public API name or shape changes.

Regression coverage: `src/parser/ast-utils.spec.ts` now contains assignments of the discriminator literal to `n.type` and accesses to backing-interface fields (`.params`, `.body`, `.id`, `.async`, `.generator`, `.callee`, `.arguments`, `.optional`, `.object`, `.left`, `.right`, `.name`) inside each predicate's narrowed branch. If any predicate regresses to a never-narrowing form, `bun run typecheck` fails on these lines.
