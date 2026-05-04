# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`@zipbul/gildash` is a **Bun-native** TypeScript code intelligence engine. It indexes TypeScript codebases into a local SQLite database for symbol search, cross-file relation tracking, dependency graph analysis, and AST pattern matching — with incremental file-watcher-driven updates.

## Commands

```bash
bun test                              # Run all tests (bun:test)
bun test src/parser/parse-source.spec.ts  # Run a single test file
bun test --grep "pattern"             # Filter tests by name
bun test --coverage                   # Run with coverage (90% threshold enforced)
bun run build                         # Build (bun bundler + tsc declarations + copy migrations)
bun run typecheck                     # Type-check only (tsc --noEmit)
```

No ESLint or Prettier configured. Pre-commit hooks run `typecheck` + `test`; pre-push runs coverage check. Commit messages use conventional commits (enforced by commitlint).

## Architecture

```
Gildash (Facade — src/gildash/)
├── Parser      — oxc-parser AST parsing + LRU cache (src/parser/)
├── Extractor   — Symbol & relation extraction from AST (src/extractor/)
├── Store       — bun:sqlite + drizzle-orm, FTS5 search (src/store/)
├── Indexer     — File change → parse → extract → store pipeline (src/indexer/)
├── Search      — Symbol FTS, relation queries, dependency graph, ast-grep (src/search/)
├── Semantic    — tsc TypeChecker integration, opt-in (src/semantic/)
├── Watcher     — @parcel/watcher + owner/reader role separation (src/watcher/)
└── Common      — Project discovery, tsconfig resolver, hasher, LRU cache (src/common/)
```

The `Gildash` class in `src/gildash/` is the public facade. All submodules are wired through it. Internal submodules may use `Result<T, GildashError>` freely; the `Gildash` class boundary unwraps Results and either returns values or throws `GildashError`.

**Owner/Reader pattern**: When multiple processes share the same SQLite database, a single-writer guarantee is enforced. The owner runs the watcher and heartbeats every 30s; readers poll health every 60s and self-promote if the owner goes stale.

**Database**: SQLite at `<projectRoot>/.gildash/gildash.db`, WAL mode, FK constraints enforced. Schema managed by drizzle-orm migrations in `src/store/migrations/`.

## Test Conventions

- **Unit tests**: `*.spec.ts` colocated with source files. SUT = single export. All external dependencies must be test-doubled.
- **Integration tests**: `*.test.ts` in `test/`. SUT = cross-module combination. Real implementations inside SUT boundary, test doubles outside.
- Test framework: `bun:test` exclusively. Use `describe`, `it`, `expect`, `mock`, `spyOn`, `beforeEach`, `afterEach`.
- Mock strategy priority: (1) DI injection, (2) `mock.module()`, (3) propose DI refactoring.
- No monkey-patching globals — always use `spyOn().mockImplementation()`.
- BDD-style `it` titles ("should ... when ..."), AAA structure (Arrange → Act → Assert).
- `test/setup.ts` is preloaded for global mock management.

## Coding Conventions

- **Bun-first**: Always prefer Bun built-in APIs over Node.js APIs or npm packages. Only use Node.js/npm when Bun has no equivalent.
- **Strict TypeScript**: `strict: true`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`.
- **Files**: kebab-case (`symbol-search.ts`). **Types**: PascalCase, no `I` prefix. **Functions**: camelCase. **Constants**: UPPER_SNAKE_CASE.
- Each module exports public API via its `index.ts`. Internal implementation details stay unexported.
- Changesets required for releases (`.changeset/`). Use `minor` for features, `patch` for fixes.

## Error Handling

Public API uses throw-based error handling:

| Return pattern | Use case |
|---|---|
| `T` | Single value, failure = system error (throw) |
| `T \| null` | Single entity lookup, "not found" is normal |
| `T[]` | Collection search, `[]` = no results |
| `boolean` | Existence/state query |
| `void` | Side effects (close, index) |

`GildashError` is a class extending `Error` with a `type` field (`'watcher' | 'parse' | 'extract' | 'index' | 'store' | 'search' | 'closed' | 'validation' | 'semantic'`). Internal submodules may use `Result<T, GildashError>` freely; the `Gildash` facade boundary unwraps Results and throws.

## Code Audit Rules — MANDATORY

코드 감사, 리뷰, 버그 탐색, 품질 분석 시 아래 규칙을 **위반 없이** 따른다. 이 규칙은 서브에이전트에게도 동일하게 적용된다.

### Gate 1: 증명 없이 보고 금지

- **버그** 주장 → `bun -e` 또는 테스트 코드로 **오동작을 재현**해야 보고 가능. 재현 불가하면 보고하지 않는다.
- **타입 문제** 주장 → 해당 타입 정의를 **원본 소스까지 끝까지** 추적한다. 이 프로젝트의 타입이 workspace 패키지(`@zipbul/*`)에 정의되어 있으면 그 패키지의 `src/types.ts`까지 읽는다. npm 패키지면 `node_modules/` 내 `.d.ts`까지 읽는다. 추적 없이 "타입이 맞지 않는다"고 보고하지 않는다.
- **성능 문제** 주장 → 시간복잡도를 코드 라인 단위로 근거 제시. "비효율적일 수 있다"는 보고 불가.
- 증명 코드 또는 근거를 함께 제시하지 못하는 이슈는 **어떤 심각도로도 보고하지 않는다**.

### Gate 2: 호출 체인 완전 추적 — 경계 규칙

이슈를 보고하기 전에 다음을 **모두** 수행한다:

1. **해당 함수의 모든 호출자를 grep으로 찾아 읽는다** — 한 곳이라도 빠뜨리지 않는다.
2. **해당 함수가 사용하는 타입/함수의 정의를 읽는다** — import를 따라 원본까지 간다.
3. **감싸는 컨텍스트를 확인한다** — 트랜잭션, try-catch, 스코프(모듈/함수/블록), 동기/비동기.

추적 경계:
- 타입 정의 → **`type`/`interface` 선언 원본**까지. `Result`, `Err`, `GildashError` 등 핵심 타입은 반드시 정의를 읽는다.
- 외부 패키지 → workspace 패키지(`@zipbul/*`)는 소스까지, npm 패키지는 `.d.ts`까지.
- 상위 호출자 → 최소 **facade(src/gildash/) 레벨**까지 추적한다.

### Gate 3: 반증 시도 의무 (Devil's Advocate)

이슈를 보고하기 **직전에**, 스스로 반증을 시도한다:

1. **"이 코드가 정상 동작하는 이유가 있는가?"** — 있다면 이슈가 아니다.
2. **"기존 테스트가 이 동작을 검증하고 있는가?"** — 테스트가 통과하면서 이 이슈가 버그라면, 테스트가 왜 잡지 못하는지 설명한다. 설명할 수 없으면 내가 틀렸을 가능성을 먼저 의심한다.
3. **"`bun run typecheck`가 통과하는 이유는?"** — typecheck가 통과하는데 타입 문제를 주장하면, 그 모순을 해소한 후에만 보고한다.

반증에 실패해야(= 정상 동작하는 이유를 찾지 못해야) 비로소 이슈로 보고할 수 있다.

### Gate 4: 에이전트 출력 직접 검증

서브에이전트(Explore, general-purpose 등)의 출력은 **조사 후보 목록**이다.

- 에이전트가 보고한 이슈를 사용자에게 **그대로 전달하지 않는다**.
- 각 후보에 대해 Gate 1~3을 직접 수행하여 사실 여부를 확인한다.
- 확인되지 않은 후보는 보고서에서 제외한다.
- "에이전트가 N건을 발견했습니다"라고 말하지 않는다. 검증된 건수만 말한다.

### Gate 5: 분류 혼동 금지

| 분류 | 정의 | 보고 조건 |
|---|---|---|
| **버그** | 재현 가능한 오동작 | 재현 코드 필수 |
| **설계 결함** | 현재 동작하나 구조적 취약 | 구체적 실패 시나리오 명시 |
| **코드 스타일** | 동작 무관한 가독성/관용성 | 별도 섹션, "버그"로 격상 금지 |

- "이론적 우려"(현재 코드에서 발생 불가능한 시나리오)는 보고하지 않는다.
- 코드 스타일을 버그나 설계 결함으로 포장하지 않는다.

### Gate 6: 수량보다 정확도

- 확인된 이슈 5건이 미확인 후보 100건보다 가치 있다.
- "전수조사" 요청이라도 증명되지 않은 항목을 수량 채우기 위해 포함하지 않는다.
- 불확실한 항목은 보고서에서 제외하거나, "미확인 — 추가 조사 필요"로 명시하고 확인된 이슈와 분리한다.

## oxc-parser / oxc-walker 의존성 업그레이드 체크리스트

`@oxc-project/types`, `oxc-parser`, `oxc-walker` 의 메이저 / 마이너 업그레이드 시 다음을 확인한다 (특히 `Node` union 변동, `WalkOptions` 시그니처 변동, discriminator collision 변동):

- [ ] `node_modules/@oxc-project/types/types.d.ts` 의 `Node` union 변형 추가/제거 여부
- [ ] `src/parser/ast-utils.ts` 의 type predicate 10종 (`isFunctionNode` + 9 신규) 이 새 변형을 누락하거나 제거된 변형을 가리키지 않는지 점검
- [ ] discriminator collision 변동 점검:
  - `Identifier` (현재 6-way: IdentifierName / IdentifierReference / BindingIdentifier / LabelIdentifier / TSThisParameter / TSIndexSignatureName)
  - `MemberExpression` (현재 3-way: ComputedMemberExpression / StaticMemberExpression / PrivateFieldExpression)
  - `TSQualifiedName` (현재 2-way: TSQualifiedName / TSImportTypeQualifiedName)
  - `Function` interface 의 `type` literal 4종 (FunctionDeclaration / FunctionExpression / TSDeclareFunction / TSEmptyBodyFunctionExpression)
- [ ] collision 변동 시 해당 predicate 의 JSDoc 정정 + README "AST Primitives" 표 갱신
- [ ] `oxc-walker` 의 `walk` / `parseAndWalk` / `ScopeTracker` 시그니처 변동 시 `src/index.ts` re-export 와 README 의 traversal 섹션 동기화
- [ ] `test/ast-foundation.test.ts` 의 traversal smoke + `src/parser/ast-utils.spec.ts` 의 collision 테스트가 새 토폴로지에서 여전히 의미 있는지 재검토
- [ ] breaking 동반 시 changeset 분류 (minor/major) 와 release notes 의 collision 변경 영향 명시
