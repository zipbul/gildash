# gildash 0.5.0 — Semantic Layer (tsc)

## 정체성

> **gildash** = TypeScript code indexing and dependency graph engine
> 파싱 · 추출 · 인덱싱 · 그래프 구축 · 정책 없는 기계적 가공
>
> **gildash는 정책을 내장하지 않는다.** 알고리즘은 제공하되, 판정은 고객 영역이다.

---

## 배경

gildash는 현재 **구문(Syntax) 계층**만 처리한다 — oxc-parser로 AST 파싱, ast-grep으로 패턴 검색, 구문 기반 심볼·관계 추출.

구문만으로는 얻을 수 없는 데이터가 있다:

| 데이터 | 구문 분석 | 시맨틱 분석 |
|--------|----------|-----------|
| `const x = foo()` 의 타입 | ❌ 알 수 없음 | ✅ `ReturnType<typeof foo>` |
| 구조적 타이핑 구현체 | ❌ `implements` 키워드만 | ✅ 덕 타이핑 포함 |
| 제네릭 해소 결과 | ❌ `T` 그대로 | ✅ `string` |
| 심볼의 정확한 스코프·소유관계 | △ 휴리스틱 | ✅ 타입체커 기반 |
| 시맨틱 참조 | △ 텍스트 매칭 | ✅ 심볼 identity 기반 |
| 구조적 타이핑 구현체 탐색 | ❌ | ✅ `isTypeAssignableTo` |

**Semantic Layer** = tsc(TypeScript Compiler API)의 타입체커 데이터를 gildash에 인덱싱하여 기존 구문 데이터를 보강하는 계층.

---

## tsc 선택 근거

### 전수 조사 결과 (2026-02-24)

TypeScript 시맨틱 정보에 프로그래매틱으로 접근 가능한 도구를 8개 조사:

| # | 도구 | 타입 API | references | implementations | assignability | 상태 |
|---|------|---------|------------|-----------------|---------------|------|
| 1 | **tsc** (`typescript`) | ✅ TypeChecker 완전 | ✅ `findReferences` | ✅ `findImplementations` | ✅ `isTypeAssignableTo` | **즉시 사용** |
| 2 | ts-morph | ✅ tsc 래퍼 | ✅ | ✅ | ✅ | tsc 위 불필요 레이어 |
| 3 | tsgo (`@typescript/api`) | ⚠️ 부분적 | ❌ | ❌ | ❌ | npm 미발행 (`private: true`) |
| 4 | Biome v2 "Biotype" | ❌ lint 내부만 | ❌ | ❌ | ❌ | 75% detection, "100% 미목표" 공식 입장 |
| 5 | Ezno | ❌ diagnostics만 | ❌ | ❌ | ❌ | v0.0.23, 극초기 |
| 6 | stc (swc) | ❌ | ❌ | ❌ | ❌ | 프로젝트 중단 |
| 7 | @flickfyi/tsgo | ❌ diagnostics만 | ❌ | ❌ | ❌ | v0.1.5, 주간 0 |
| 8 | tsserver (LSP) | △ 텍스트 파싱 | △ | △ | ❌ | N+1 문제 |

**결론: tsc만이 완전한 프로그래매틱 타입 API를 제공한다. 유일한 선택지.**

### tsc 선택 이유

1. **100% 정확도** — 덕 타이핑 구현체 탐색에 `isTypeAssignableTo` 사용 가능. AOT 컴파일러(baker)나 Reflect.metadata 대체 프로젝트에서 정확도는 협상 불가.
2. **블로커 없음** — `typescript` 패키지는 npm에 즉시 사용 가능.
3. **완전한 API** — `findReferences`, `findImplementations`, `TypeChecker` 전체.
4. **추상화 레이어 불필요** — tsgo 언제 나올지 불확실. tsc API를 직접 사용한다.

### tsc 한계 (인지하고 수용)

| 항목 | 수치 |
|------|------|
| 성능 | tsgo 대비 ~10x 느림 (빌드 기준) |
| 메모리 | in-process TypeChecker — 대규모 프로젝트 시 수백MB |
| 의존성 크기 | typescript 패키지 ~30MB+ |
| 방향성 | TypeScript 팀이 tsgo로 이동 중 |

인덱싱 엔진의 초기 로드는 한 번 발생. 이후 증분 갱신. 정확도가 성능보다 우선.

---

## 수집 대상 데이터

### 수집하는 것

| 데이터 | tsc API | 가치 |
|--------|---------|------|
| 심볼의 추론된 타입 | `checker.getTypeOfSymbolAtLocation(symbol, declaration)` | 명시적 타입 없는 심볼의 타입 해소 |
| 타입 그래프 | `type.types` (union/intersection), `type.target`, `type.typeParameters` | union 분해, 제네릭 해소, 구조적 탐색 |
| 심볼 그래프 | `symbol.parent`, `symbol.members`, `symbol.exports` | parent/member/export 관계 |
| 타입의 문자열 표현 | `checker.typeToString(type)` | 사람 읽기용 타입 문자열 |
| 선언된 타입 | `checker.getDeclaredTypeOfSymbol(symbol)` | 타입 별칭의 원래 정의 |
| 위치 기반 타입 | `checker.getTypeAtLocation(node)` | 특정 위치의 narrowed 타입 |
| 이름 해소 | `checker.resolveName(name, location, meaning, false)` | 스코프 기반 심볼 조회 |
| 문맥적 타입 | `checker.getContextualType(node)` | 콜백 파라미터 등의 추론 타입 |
| 시맨틱 참조 | `languageService.findReferences(fileName, position)` | 심볼 identity 기반 참조 위치 |
| 구현체 탐색 | `languageService.getImplementationAtPosition(fileName, position)` | 인터페이스/추상 클래스의 구현체 |
| 타입 호환성 | `checker.isTypeAssignableTo(source, target)` | 구조적 타이핑 판정 (100% 정확) |

### 수집하지 않는 것

| 데이터 | 이유 |
|--------|------|
| **diagnostics** | 컴파일러의 정책적 판단 결과. "정책 없는 기계적 가공" 정체성 위반. `tsc --noEmit`으로 누구나 직접 수집 가능. |
| completion | IDE 인터랙티브 기능. 인덱싱 대상 아님. |
| signatureHelp | 동일 |
| rename | 동일 |
| formatting | 동일 |
| codeAction | 동일 |

---

## 수집 전략

### in-process 직접 호출

tsc는 같은 프로세스에서 함수 호출로 동작한다. IPC, 배치, 직렬화 불필요.

```
인덱싱 시:
  1. ts.createProgram(rootFiles, compilerOptions) → Program
  2. program.getTypeChecker() → TypeChecker
  3. ts.createLanguageService(host) → LanguageService
  4. 파일별 구문 인덱싱 (기존 oxc 경로) → 심볼 위치 수집
  5. 각 심볼의 AST 노드 획득 → checker.getTypeOfSymbolAtLocation(symbol, node)
  6. checker.typeToString(type) → DB 저장
  7. references/implementations 수집 → DB 저장

조회 시 (lazy):
  심볼 그래프 (parent/members/exports) → 첫 조회 시 수집 + LRU 캐시

증분 갱신:
  1. watcher 감지 → 기존 구문 인덱싱
  2. LanguageServiceHost의 파일 버전 갱신
  3. Program 자동 재생성 (LanguageService 내부)
  4. 변경 파일 심볼만 타입 재수집
  5. lazy 캐시: 변경 파일 관련 엔트리 무효화
```

### 성능 추정 (500파일, 10,000 심볼)

| 시나리오 | tsc in-process |
|---------|---------------|
| 초기 Program 생성 | ~2–5초 |
| 타입 수집 (10,000 심볼) | ~1–3초 (함수 호출, IPC 없음) |
| references 수집 | ~2–5초 (LanguageService 내부 최적화) |
| 증분 갱신 (1파일 변경) | ~100–500ms (Program 재생성 + 해당 심볼 타입 재수집) |
| 메모리 (500파일) | ~100–300MB (TypeChecker in-process) |

---

## 아키텍처

### opt-in 활성화

```ts
const gildash = await Gildash.open({
  projectRoot: './my-project',
  semantic: true,  // opt-in. 기본값 false.
});
```

`semantic: false` (기본값) → tsc 로드 안 함. 기존 동작 100% 동일.

### 라이프사이클

```
Gildash.open({ semantic: true })
  → tsconfig-resolver로 tsconfig 경로 탐색
  → ts.createProgram(rootFiles, compilerOptions)
  → program.getTypeChecker()
  → ts.createLanguageService(host)
  → 초기 타입 수집

파일 변경 → watcher 감지
  → 구문 인덱싱 (기존)
  → LanguageServiceHost 파일 버전 갱신
  → Program 재생성 (자동)
  → 변경 심볼 타입 재수집

Gildash.close()
  → languageService.dispose()
  → Program/Checker 참조 해제
```

### 디렉토리 구조

tsc API를 직접 사용한다. 추상화 레이어 없음.

```
src/
  semantic/
    index.ts                  — SemanticLayer 클래스 (tsc Program/Checker/LanguageService 직접 관리)
    tsc-program.ts            — Program 생성·재생성·해제 + LanguageServiceHost 구현
    type-collector.ts         — 타입 수집 (checker 직접 호출)
    symbol-graph.ts           — 심볼 그래프 (parent/members/exports) + LRU 캐시
    reference-resolver.ts     — findReferences 기반 시맨틱 참조
    implementation-finder.ts  — findImplementations + isTypeAssignableTo 기반 구현체 탐색
    types.ts                  — ResolvedType, SemanticReference, Implementation 등
```

### 기존 모듈과의 관계

```
┌──────────────────────────────────────────────────┐
│                     Gildash                      │
│                                                  │
│  ┌──────────┐   ┌────────────────────────────┐   │
│  │ Syntax   │   │  Semantic (opt-in)         │   │
│  │          │   │                            │   │
│  │ Parser   │──→│  SemanticLayer             │   │
│  │ Extractor│   │    ├─ TscProgram           │   │
│  │ Indexer  │   │    ├─ TypeCollector         │   │
│  │ Search   │   │    ├─ SymbolGraph           │   │
│  │ Store    │   │    ├─ ReferenceResolver     │   │
│  │ Watcher  │   │    └─ ImplementationFinder  │   │
│  └──────────┘   └────────────────────────────┘   │
│       ↕                     ↕                    │
│    oxc-parser          typescript                │
│    ast-grep         (in-process)                 │
└──────────────────────────────────────────────────┘
```

Parser(구문)가 추출한 심볼 위치 → SemanticLayer에 전달 → 타입 수집 → Store에 저장.

---

## Public API

### 신규 API

```ts
// 심볼의 추론된 타입
getResolvedType(symbolName: string, filePath: string): Result<ResolvedType | null>

// 시맨틱 참조 (심볼 identity 기반 — tsc findReferences)
getSemanticReferences(symbolName: string, filePath: string): Result<SemanticReference[]>

// 구현체 (구조적 타이핑 포함 — tsc findImplementations + isTypeAssignableTo)
getImplementations(symbolName: string, filePath: string): Result<Implementation[]>

// 시맨틱 보강된 모듈 인터페이스
getSemanticModuleInterface(filePath: string): Result<SemanticModuleInterface>
```

### 기존 API 확장 (non-breaking)

| API | 추가 | 설명 |
|-----|------|------|
| `searchSymbols` | `resolvedType?: string` 쿼리 필터 | 추론된 타입으로 심볼 검색 |
| `getFullSymbol` | `resolvedType` 반환 필드 | 기존 구문 정보 + 추론 타입 통합 |

### 타입 정의

```ts
interface ResolvedType {
  text: string;           // "string | undefined"
  flags: number;          // TypeFlags
  isUnion: boolean;
  isIntersection: boolean;
  isGeneric: boolean;
  members?: ResolvedType[];       // union/intersection 구성원
  typeArguments?: ResolvedType[]; // 제네릭 해소 결과 (e.g. Promise<string> → [string])
}

interface SemanticReference {
  filePath: string;
  position: number;
  line: number;
  column: number;
  isDefinition: boolean;
  isWrite: boolean;
}

interface Implementation {
  filePath: string;
  symbolName: string;
  position: number;
  kind: string;           // "class" | "object" | "function"
  isExplicit: boolean;    // implements 키워드 사용 여부
}

interface SemanticModuleInterface {
  exports: Array<{
    name: string;
    kind: string;
    resolvedType: ResolvedType | null;
  }>;
}
```

---

## 에러 처리

| 상황 | 대응 |
|------|------|
| `semantic: true`인데 tsconfig.json 없음 | `GildashError` 반환. |
| Program 생성 실패 (tsconfig 파싱 에러 등) | `GildashError` 반환. silent fallback 없음. |
| 특정 심볼 타입 해소 실패 | 해당 심볼의 시맨틱 데이터 null 반환. 구문 데이터는 정상. |
| `semantic: false` (기본값) | tsc 로드 안 함. 시맨틱 API 호출 시 `GildashError` 반환. |

모든 에러는 `Result<T, GildashError>` 패턴으로 투명하게 전파. silent fallback 금지.

---

## 의존성 변경

```diff
  peerDependencies:
+   "typescript": ">=5.0.0"

  devDependencies:
+   "typescript": "^5.8.0"
```

`typescript`는 peerDependency. 호스트 프로젝트의 typescript 버전을 사용한다.
`semantic: false` (기본값) 시 typescript가 없어도 동작한다 — dynamic import로 로드.

---

## 리스크

| 항목 | 상태 | 비고 |
|------|------|------|
| typescript Bun 호환성 | ✅ | 순수 JS 패키지. Bun에서 문제 없이 동작. |
| 대규모 프로젝트 메모리 | △ | in-process TypeChecker — 수천 파일 시 수백MB~1GB. 모니터링 필요. |
| tsc API stability | ✅ | TypeChecker API는 TypeScript 릴리스 간 안정적. |

블로커 없음. 즉시 구현 가능.

---

## 실행 순서

```
Phase 0 — 선행 검증
├─ tsc in-process 프로토타입: createProgram → getTypeChecker → getTypeOfSymbolAtLocation
├─ LanguageService 프로토타입: findReferences + getImplementationAtPosition
└─ Bun 환경에서 typescript import 동작 확인

Phase 1 — 기반
├─ src/semantic/types.ts — 타입 정의
├─ src/semantic/tsc-program.ts — Program + LanguageServiceHost
└─ src/semantic/tsc-program.spec.ts — 생성·해제 테스트

Phase 2 — 수집
├─ src/semantic/type-collector.ts — 타입 수집
├─ src/semantic/type-collector.spec.ts
├─ src/semantic/symbol-graph.ts — 심볼 그래프 + LRU 캐시
├─ src/semantic/symbol-graph.spec.ts
├─ src/semantic/reference-resolver.ts — findReferences 기반 참조
├─ src/semantic/reference-resolver.spec.ts
├─ src/semantic/implementation-finder.ts — findImplementations + isTypeAssignableTo
├─ src/semantic/implementation-finder.spec.ts
├─ Store migration — resolved_type 컬럼 추가
└─ Store repository — resolvedType 쿼리 지원

Phase 3 — 통합
├─ src/semantic/index.ts — SemanticLayer 진입점
├─ src/gildash.ts — semantic 옵션 + 신규 API 노출
├─ Watcher 연동 — 파일 변경 시 Program 재생성 + 타입 재수집
└─ 통합 테스트 (test/semantic.test.ts)

Phase 4 — 마무리
├─ 문서화 (README, CHANGELOG)
└─ 릴리스
```

각 Phase는 Test-First Flow (OVERFLOW → PRUNE → RED → GREEN) 적용.

---

## 세부 실행 체크리스트

### Phase 0. 선행 검증
- [ ] tsc in-process 프로토타입: `ts.createProgram` → `getTypeChecker` → `getTypeOfSymbolAtLocation` 동작 확인
- [ ] `ts.createLanguageService` → `findReferences` + `getImplementationAtPosition` 동작 확인
- [ ] Bun 환경에서 `import ts from 'typescript'` 정상 동작 확인
- [ ] 결과 기반 Phase 1 진행

### Phase 1. 기반
- [ ] `src/semantic/types.ts` — ResolvedType, SemanticReference, Implementation, SemanticModuleInterface 타입 정의
- [ ] `src/semantic/tsc-program.ts` — createProgram, LanguageServiceHost 구현, dispose
- [ ] `src/semantic/tsc-program.spec.ts` — Program 생성·해제, tsconfig 로드, 증분 갱신

### Phase 2. 수집
- [ ] `src/semantic/type-collector.ts` — getTypeOfSymbolAtLocation → typeToString → DB 저장
- [ ] `src/semantic/type-collector.spec.ts` — 타입 수집, 명시적 타입 없는 심볼만 선택적 수집
- [ ] `src/semantic/symbol-graph.ts` — parent, members, exports + LRU 캐시
- [ ] `src/semantic/symbol-graph.spec.ts` — lazy 수집, 캐시 히트/미스, 무효화
- [ ] `src/semantic/reference-resolver.ts` — findReferences 기반 시맨틱 참조
- [ ] `src/semantic/reference-resolver.spec.ts` — 참조 탐색, isDefinition/isWrite 구분
- [ ] `src/semantic/implementation-finder.ts` — findImplementations + isTypeAssignableTo 기반 구현체 탐색
- [ ] `src/semantic/implementation-finder.spec.ts` — 명시적 implements + 덕 타이핑 구현체
- [ ] Store migration — symbols 테이블에 resolved_type 컬럼 추가
- [ ] Store repository — resolvedType 쿼리 지원

### Phase 3. 통합
- [ ] `src/semantic/index.ts` — SemanticLayer 클래스 (TscProgram + TypeCollector + SymbolGraph + ReferenceResolver + ImplementationFinder)
- [ ] `src/gildash.ts` — `open({ semantic: true })` 옵션, SemanticLayer 초기화/해제
- [ ] `src/gildash.ts` — `getResolvedType()`, `getSemanticReferences()`, `getImplementations()`, `getSemanticModuleInterface()` 추가
- [ ] `src/gildash.ts` — `searchSymbols()` resolvedType 필터 확장
- [ ] `src/gildash.ts` — `getFullSymbol()` resolvedType 필드 확장
- [ ] Watcher 연동 — 파일 변경 시 LanguageServiceHost 파일 버전 갱신 + 타입 재수집
- [ ] 통합 테스트 (`test/semantic.test.ts`)

### Phase 4. 마무리
- [ ] README.md / README.ko.md — Semantic Layer 문서화
- [ ] CHANGELOG.md — 변경사항 기록
- [ ] commit + PR

---

## 작업 할당 (Sonnet / Opus)

할당 기준:
- **Sonnet**: 기계적·보일러플레이트·패턴 반복 — 타입 정의, Store migration/repository, 문서화, 단순 검증
- **Opus**: 아키텍처 결정·핵심 로직·tsc API 통합·통합 테스트 — 설계가 필요한 모든 것

### Phase 0 — 선행 검증

| 작업 | 담당 | 근거 |
|------|------|------|
| tsc in-process 프로토타입 (createProgram → getTypeChecker → getTypeOfSymbolAtLocation) | **Opus** | tsc API 탐색 + 아키텍처 결정 |
| LanguageService 프로토타입 (findReferences + getImplementationAtPosition) | **Opus** | 동일 |
| Bun 환경에서 `import ts from 'typescript'` 동작 확인 | **Sonnet** | 단순 검증 스크립트 |

### Phase 1 — 기반

| 작업 | 담당 | 근거 |
|------|------|------|
| `src/semantic/types.ts` — 타입 정의 | **Sonnet** | PLAN.md 타입 정의 그대로 옮기기 |
| `src/semantic/tsc-program.ts` — Program + LanguageServiceHost | **Opus** | 핵심 모듈. LanguageServiceHost 구현 |
| `src/semantic/tsc-program.spec.ts` — 생성·해제 테스트 | **Opus** | 복합 테스트 + OVERFLOW/PRUNE 필요 |

### Phase 2 — 수집

| 작업 | 담당 | 근거 |
|------|------|------|
| OVERFLOW/PRUNE (Phase 2 전체) | **Opus** | 분석·판단 작업 |
| `src/semantic/type-collector.ts` | **Opus** | tsc API 연동 핵심 로직 |
| `src/semantic/type-collector.spec.ts` | **Sonnet** | Opus PRUNE 결과 기반 spec 작성 |
| `src/semantic/symbol-graph.ts` | **Opus** | LRU 캐시 + lazy 수집 전략 |
| `src/semantic/symbol-graph.spec.ts` | **Sonnet** | Opus PRUNE 결과 기반 spec 작성 |
| `src/semantic/reference-resolver.ts` | **Opus** | findReferences 연동 |
| `src/semantic/reference-resolver.spec.ts` | **Sonnet** | Opus PRUNE 결과 기반 spec 작성 |
| `src/semantic/implementation-finder.ts` | **Opus** | 가장 복잡 — findImplementations + isTypeAssignableTo |
| `src/semantic/implementation-finder.spec.ts` | **Sonnet** | Opus PRUNE 결과 기반 spec 작성 |
| Store migration — resolved_type 컬럼 추가 | **Sonnet** | SQL migration 기계적 |
| Store repository — resolvedType 쿼리 지원 | **Sonnet** | 기존 repository 패턴 반복 |

### Phase 3 — 통합

| 작업 | 담당 | 근거 |
|------|------|------|
| `src/semantic/index.ts` — SemanticLayer 클래스 | **Opus** | 전체 모듈 통합 로직 |
| `src/gildash.ts` — semantic 옵션 + 신규 API 4개 + 기존 API 확장 2개 | **Opus** | Public API 설계 |
| Watcher 연동 — 파일 변경 시 Program 재생성 + 타입 재수집 | **Opus** | 증분 갱신 핵심 |
| 통합 테스트 (`test/semantic.test.ts`) | **Opus** | end-to-end 복합 테스트 |

### Phase 4 — 마무리

| 작업 | 담당 | 근거 |
|------|------|------|
| README.md / README.ko.md — Semantic Layer 문서화 | **Sonnet** | 문서화 |
| CHANGELOG.md — 변경사항 기록 | **Sonnet** | 문서화 |
| commit + PR | **Opus** | 최종 검수 |

### 요약

| 담당 | 작업 수 | 성격 |
|------|---------|------|
| **Opus** | 15 | 프로토타입, 핵심 로직 6개, OVERFLOW/PRUNE, 통합, Public API, Watcher, 통합 테스트, PR |
| **Sonnet** | 12 | 타입 정의, spec 4개, Store migration/repository, Bun 검증, 문서화 3개 |
