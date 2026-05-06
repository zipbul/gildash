# CLAUDE.md

Guidance for Claude Code working in this repo.

## What this is
@zipbul/gildash — Bun-native TypeScript code intelligence engine.
Public API + architecture: see README.md.

## Conventions
- **Bun-first.** Prefer Bun built-ins over Node/npm.
- **Strict TS.** strict · noUncheckedIndexedAccess · noImplicitOverride · noFallthroughCasesInSwitch.
- **Naming.** Files kebab-case · Types PascalCase (no `I` prefix) · Functions camelCase · Constants UPPER_SNAKE_CASE.
- **Module surface.** Public API only via `index.ts`. Internals stay unexported.
- **Commits.** Conventional commits (commitlint).
- **Releases.** Changeset required: `minor` for feat, `patch` for fix.
- **Hooks.** Pre-commit runs typecheck + test. Pre-push runs coverage (≥ 90%).

## Tests
- Unit (`*.spec.ts`) colocated · SUT = single export · external deps test-doubled.
- Integration (`*.test.ts`) in `test/` · SUT = cross-module · real impls inside, doubles outside.
- Framework: `bun:test` only. `test/setup.ts` preloaded.
- Mock priority: DI > `mock.module()` > propose DI refactor.
- No monkey-patching globals — use `spyOn().mockImplementation()`.
- BDD titles: `"should ... when ..."`.

## Error handling
- Internal submodules use `Result<T, GildashError>` freely.
- `Gildash` facade unwraps Results — returns value or throws `GildashError`.
- `T | null` means "not found is normal" (not "this might fail"). Side effects return `void`.

## Code Audit Rules — MANDATORY
코드 감사·리뷰·버그 탐색·품질 분석 시 위반 없이 따른다. 서브에이전트 동일.

### Gate 1: 증명 없이 보고 금지
- 버그: `bun -e` / 테스트로 재현 가능해야 보고.
- 타입 문제: 정의 원본까지 추적 (`@zipbul/*` 는 src, npm 은 .d.ts).
- 성능: 시간복잡도 라인 단위 근거. "비효율적일 수 있다" 금지.

### Gate 2: 호출 체인 추적
- 호출자 grep + 전부 읽기.
- 사용 타입/함수 정의 import 원본까지.
- 감싸는 컨텍스트 (트랜잭션·try-catch·스코프·sync/async) 확인.
- 상위 호출자 최소 facade(`src/gildash/`) 까지.

### Gate 3: 반증 시도
- "정상 동작 이유는?" 있으면 이슈 아님.
- "기존 테스트는 왜 못 잡는가?" 설명 못 하면 내가 틀렸을 가능성부터.
- "typecheck 통과하는데 타입 문제 주장?" 모순 해소부터.

### Gate 4: 에이전트 출력 검증
서브에이전트 출력 = 후보 목록. Gate 1~3 직접 수행 후에만 전달. "에이전트가 N건 발견" 금지 — 검증 건수만.

### Gate 5: 분류 혼동 금지
| 분류 | 정의 | 보고 조건 |
|---|---|---|
| 버그 | 재현 가능한 오동작 | 재현 코드 |
| 설계 결함 | 동작하나 구조적 취약 | 구체적 실패 시나리오 |
| 코드 스타일 | 동작 무관 | 별도 섹션, 격상 금지 |

이론적 우려 (현 코드에서 발생 불가) 금지.

### Gate 6: 수량보다 정확도
확인 5건 > 미확인 100건. 미증명 수량 채움 금지. 불확실은 "미확인 — 추가 조사 필요" 분리.
