# Upgrading `oxc-parser` / `oxc-walker` / `@oxc-project/types`

Checklist for major / minor upgrades of the oxc dependencies. Trigger this runbook on any version bump of `oxc-parser`, `oxc-walker`, or `@oxc-project/types`.

Pay particular attention to: `Node` union variant additions/removals, `WalkOptions` signature drift, and discriminator-collision changes (variants sharing the same `type` literal).

## Checklist

- [ ] `node_modules/@oxc-project/types/types.d.ts` — `Node` union variant additions/removals.
- [ ] `src/parser/ast-utils.ts` hand-written predicates (10 total: `isFunctionNode` + 9 single-discriminator) still cover the variants they document and don't reference removed ones.
- [ ] `IsNamespace` mapped type / `is.X` Proxy — TypeScript validates this against the new `Node['type']` automatically. No manual sync required, but confirm `bun run typecheck` is clean.
- [ ] Discriminator collisions still match documented topology:
  - `Identifier` (currently 6-way: `IdentifierName` / `IdentifierReference` / `BindingIdentifier` / `LabelIdentifier` / `TSThisParameter` / `TSIndexSignatureName`)
  - `MemberExpression` (currently 3-way: `ComputedMemberExpression` / `StaticMemberExpression` / `PrivateFieldExpression`)
  - `TSQualifiedName` (currently 2-way: `TSQualifiedName` / `TSImportTypeQualifiedName`)
  - `Function` interface `type` literal (currently 4-way: `FunctionDeclaration` / `FunctionExpression` / `TSDeclareFunction` / `TSEmptyBodyFunctionExpression`)
  - `Class` interface `type` literal (currently 2-way: `ClassDeclaration` / `ClassExpression`)
- [ ] Collision change → fix the predicate's JSDoc + update the README "AST Primitives" section.
- [ ] `oxc-walker` signature drift on `walk` / `parseAndWalk` / `ScopeTracker` → sync `src/index.ts` re-exports + README traversal section.
- [ ] Re-validate that the existing tests still mean something on the new topology:
  - `test/ast-foundation.test.ts` — traversal smoke + `is.X` round-trip on a real parsed program.
  - `src/parser/ast-utils.spec.ts` — collision-narrowing tests, `is` namespace per-discriminator coverage, hand-written ↔ `is.X` pointwise equivalence.
- [ ] Breaking change (consumer-visible) → classify the changeset (`minor` / `major`) and call out collision/topology impact in the changeset body.
