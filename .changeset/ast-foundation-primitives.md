---
'@zipbul/gildash': minor
---

feat(ast): expose AST foundation primitives — type predicates and walk

**New type predicates** over the oxc-parser `Node` union (each with `(node: Node) => node is Extract<Node, { type: 'X' }>` signature):

- `isArrowFunctionExpression`
- `isAssignmentExpression`
- `isCallExpression`
- `isFunctionDeclaration`
- `isFunctionExpression`
- `isIdentifier` — 6-way collision (IdentifierName / IdentifierReference / BindingIdentifier / LabelIdentifier / TSThisParameter / TSIndexSignatureName)
- `isMemberExpression` — 3-way collision (Computed / Static / PrivateField)
- `isTSQualifiedName` — 2-way collision (TSQualifiedName / TSImportTypeQualifiedName)
- `isVariableDeclaration`

**`isFunctionNode` signature strengthened** from `(node: Record<string, unknown>) => boolean` to a proper type predicate `(node: Node) => node is Function | ArrowFunctionExpression`. Runtime behavior unchanged. Type-level breaking change: external callers passing arbitrary `Record<string, unknown>` values must now pass `Node`-shaped values or use an explicit `as unknown as Node` cast. This API was not exported from the package main entry, so impact is limited to consumers reaching into the `dist/parser/...` subpath.

**Re-exported from oxc-walker**: `walk`, `parseAndWalk`, `ScopeTracker`, plus types `WalkerEnter` / `WalkerLeave` / `WalkerCallbackContext` / `WalkerThisContextEnter` / `WalkerThisContextLeave` / `WalkOptions` / `ScopeTrackerNode` / `ScopeTrackerOptions`. `gildash` now treats the oxc-walker surface as part of its public contract; future oxc-walker changes are reflected via gildash releases.

README gains an **AST Primitives** section under API Reference documenting the parsing/extraction, traversal, and predicate surfaces alongside collision caveats. CLAUDE.md gains an **oxc-parser / oxc-walker upgrade checklist** to keep the predicate set and collision JSDoc in sync as the upstream Node taxonomy evolves.
