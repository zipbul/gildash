# TODO

gildash의 인프라 개선 및 소비자 지원 강화를 위한 작업 목록.
완료된 항목은 삭제한다.

---

## 1. oxc 생태계 극대화

### 1-1. oxc-parser 0.115.0 → 0.121.0 업데이트

JS API 동일 (diff 0건). Rust 파서 내부 버그 수정만 적용. 안전한 업데이트.

### 1-2. `preserveParens: false` 적용

`parseSource`에서 `{ preserveParens: false }` 설정.
gildash extractor는 `ParenthesizedExpression`을 사용하지 않음.
AST 노드 ~25% 감소, 모든 순회 경로에서 불필요 노드 제거.

변경: `src/parser/parse-source.ts` 1줄.

### 1-3. `ParseResult.module` 도입

현재 `parseSource`가 destructuring 시 `module` 프로퍼티를 버림.
`ParsedFile`에 `module: EcmaScriptModule` 포함.

효과:
- `imports-extractor.ts` body 수동 순회 ~80줄 → `module.staticImports`/`staticExports`/`dynamicImports` 기반 ~30줄
- `extractor-utils.ts` `buildImportMap` body 순회 ~30줄 → `module.staticImports` 기반 ~15줄
- `symbol-extractor.ts` `deferredExportNames` post-pass → `module.staticExports`로 대체
- `export { name }` 같은 버그 재발 방지 (oxc가 이미 파싱한 데이터 사용)

### 1-4. `@oxc-project/types` 도입

현재 `symbol-extractor.ts`가 자체 타입 70줄 선언 (`OxcNode`, `OxcMember`, `OxcParam` 등)
+ `as unknown as Record<string, unknown>` 캐스팅 8곳.

`@oxc-project/types`에서 `FunctionDeclaration`, `ClassDeclaration` 등 250개 타입 직접 import.
자체 타입 70줄 삭제, 캐스팅 8곳 제거.
oxc-parser 버전 업 시 AST 구조 변경을 typecheck에서 즉시 감지.

현재 이 문제가 firebat에 전파되어 firebat도 자체 타입 가드 260줄(`oxc-ast-utils.ts`) 중 70줄을 구현하고 있음.
gildash가 해결하면 소비자 중복 코드도 해소.

### 1-5. `Visitor` 클래스 + `visitorKeys` 도입

oxc-parser 내장 auto-generated walker (2,455줄, 166개 노드별 전용 함수).
수동 순회 대비 2.82x 빠름 (단일 파일 벤치), 실제 프로젝트에서 1.12x.

대체 대상:
- `ast-utils.ts`의 `visit()`, `collectNodes()` → Visitor 콜백
- `ast-utils.ts`의 `SKIP_KEYS` 하드코딩 → `visitorKeys` (oxc-parser 제공, 노드별 자식 키 목록)
- `heritage-extractor.ts`의 `visit()` → `new Visitor({ ClassDeclaration, TSInterfaceDeclaration })`

### 1-6. `oxc-walker` + `ScopeTracker` 도입

`calls-extractor.ts`가 수동 스코프 스택 관리 + import map 대조를 하고 있음.
`oxc-walker`의 `ScopeTracker.getDeclaration(name)`이 import 원본까지 역추적 제공.
수동 스코프 코드 ~60줄 → ~30줄.

주간 52만 다운로드, Nuxt/i18n에서 사용 중.
`magic-regexp` 의존성 1개 추가.

### 1-7. `oxc-resolver` 도입 검토

현재 `extractor-utils.ts`의 `resolveImport()` 72줄이 모듈 해석을 자체 구현
(tsconfig paths, 확장자 후보 생성).
`oxc-resolver`가 동일 기능을 Rust-native로 제공 (더 정확, 더 빠름).

검토 필요:
- gildash의 `resolveImport`이 "후보 목록 반환" 패턴 (`string[]`)인데, `oxc-resolver`의 API와 호환되는지
- `knownFiles` Set과의 교차 검증 로직이 유지되는지
- 성능 이득이 의미 있는 규모인지

---

## 2. tsc semantic layer 극대화

현재 tsc API 19개 사용 중. 검증된 gap 3개.

### 2-1. `checker.getBaseTypes()` 도입 — 상속 체인 역추적

현재 ImplementationFinder가 정방향(인터페이스 → 구현체)만 지원.
역방향(클래스 → 부모 클래스/인터페이스 체인)이 없음.
`getHeritageChain()`이 AST 텍스트 기반으로 heritage를 추적하지만,
tsc `getBaseTypes(type)`를 사용하면 tsc가 실제 해석한 부모 타입을 얻어 더 정확.

SymbolGraph 또는 별도 InheritanceResolver에 추가.
semantic layer가 opt-in이므로 기존 AST 기반과 병행 가능.

소비자 활용:
- firebat error-flow: 상속 체인 정확도 향상
- zipbul: DI 스코프 위반 감지 정확도 향상

### 2-2. `checker.getAliasedSymbol()` 도입 — 타입 별칭/re-export 역참조

현재 SymbolGraph가 alias를 그대로 반환.
`export { Foo } from './bar'`의 `Foo`가 원본 심볼로 해석되지 않음.

`checker.getAliasedSymbol(symbol)`로 canonical 심볼 해석.
4-4(re-export 패턴 B/C 인식)과 직결 — semantic layer에서 alias를 해석하면
re-export 추적 정확도가 올라감.

### 2-3. `checker.getExportsOfModule()` 도입 — 시맨틱 모듈 인터페이스

현재 `getSemanticModuleInterface()`가 `forEachChild`로 AST를 순회하며 export를 찾음 (index.ts:230-256).
간접 export, re-export, `export =` 패턴을 놓칠 수 있음.

`checker.getExportsOfModule(moduleSymbol)`로 tsc가 해석한 실제 export 목록 사용.
AST 순회 없이 정확한 모듈 인터페이스 구축.

### 2-4. `checker.getPropertiesOfType()` 도입 — 타입 멤버 열거

현재 ResolvedType이 union/intersection 분해 + typeArguments까지 하지만,
객체 타입의 프로퍼티/메서드 목록은 포함하지 않음.

`checker.getPropertiesOfType(type)`로 타입 shape 조회 가능.
"이 타입에 어떤 멤버가 있는가" 쿼리를 지원.
구조적 타이핑 검증, 타입 멤버 완전성 검사에 활용.

ResolvedType에 `properties?: Array<{ name: string; type: ResolvedType }>` 추가.
MAX_TYPE_DEPTH 내에서만 재귀 전개.

---

## 3. 소비자 지원 강화

### 3-1. 내부 유틸 public export

firebat이 gildash 내부 유틸을 접근 못해서 중복 구현 중:

| gildash 내부 | firebat 중복 | 조치 |
|---|---|---|
| `src/parser/source-position.ts` (`buildLineOffsets`, `getLineColumn`) | `src/engine/source-position.ts` 30줄 | public export 추가 |
| `src/parser/ast-utils.ts` (`visit`, `collectNodes`, `getNodeHeader` 등) | `src/engine/ast/oxc-ast-utils.ts` 중 70줄 | 1-5에서 Visitor 도입 시 자연 해소. 과도기에는 export |
| `src/extractor/symbol-extractor.ts` (`extractSymbols`) | `src/engine/symbol-extractor-oxc.ts` ~100줄 | 이미 export됨 — firebat이 gildash 것을 안 쓰는 이유 확인 필요 |

### 3-2. `ParsedFile` 타입 호환성 해소

firebat이 gildash `batchParse` 결과를 받아서 `as unknown as ParsedFile[]`로 강제 캐스팅 중.
원인: firebat이 자체 `ParsedFile` 타입을 선언하고 있고, gildash의 `ParsedFile`과 구조는 동일하지만 타입 시스템상 별개.

```typescript
// firebat/src/shared/ts-program.ts
return Array.from(parsed.values()) as unknown as ParsedFile[];  // 강제 캐스팅
```

조치:
- gildash의 `ParsedFile`을 소비자가 그대로 사용할 수 있도록 타입 export 보장 (현재 export됨)
- 1-4에서 `@oxc-project/types` 도입 시 `ParsedFile.program`이 fully typed되면 firebat이 자체 타입 삭제하고 gildash 것을 직접 사용 가능
- firebat 자체 `ParsedFile`(6줄)은 gildash 것과 구조 동일 — 타입 통합으로 `as unknown as` 제거

### 3-3. oxc-parser 타입 re-export

firebat 소스 38개 파일이 `import type { Node } from 'oxc-parser'`로 직접 import.
gildash가 `@oxc-project/types`를 사용하지만 public API로 re-export하지 않음.

조치: `src/index.ts`에서 소비자가 필요한 oxc 타입 re-export:

```typescript
export type { Program, Node, Comment, OxcError } from 'oxc-parser';
export { Visitor, visitorKeys } from 'oxc-parser';
export type { VisitorObject } from 'oxc-parser';
```

효과: 소비자가 `oxc-parser`를 별도 의존성으로 추가할 필요 없음. gildash 버전과 oxc-parser 버전 불일치 방지.

### 3-4. 대량 쿼리 API 개선

firebat이 `limit: 100_000`으로 전체 데이터를 가져오는 패턴 7곳 반복:

```typescript
gildash.searchSymbols({ isExported: true, limit: 100_000 });
gildash.searchRelations({ type: 'imports', limit: 100_000 });
```

`limit: 100_000`은 "전부 가져오기"의 workaround. 검토 필요:
- `limit` 생략 시 전체 반환 옵션 (또는 `limit: Infinity` 지원)
- 또는 전용 bulk API (`getAllExportedSymbols`, `getAllRelationsByType`)
- 현재 기본값 100은 대량 분석에 부적합

### 3-5. emberdeck API 런타임 체크 제거

emberdeck이 gildash API 존재 여부를 런타임에서 체크:

```typescript
if (typeof ctx.gildash.getSymbolChanges !== 'function') return null;
if (typeof (ctx.gildash as any).getDependencies !== 'function') { ... }
const gildash = ctx.gildash as any;
```

원인: gildash 버전 간 API 차이. emberdeck이 0.10.0에 머물면서 이후 추가된 API를 방어적으로 접근.

조치:
- gildash 타입에 API 가용성이 정확히 반영되도록 semver 준수
- `as any` 캐스팅 없이 타입으로 API 존재 보장

### 3-6. 조회 API 에러 처리 방식 검토

firebat 13곳에서 동일한 try-catch 보일러플레이트:

```typescript
try {
  result = gildash.searchRelations(...)
} catch (e) {
  if (e instanceof GildashError) return fallback;
  throw e;
}
```

현재 CLAUDE.md 원칙: "facade는 throw". 하지만 조회 API(`searchSymbols`, `searchRelations`,
`getImportGraph`, `getCyclePaths`)는 데이터가 없으면 빈 배열을 반환하는 것이 자연스러움.
조회가 throw하면 소비자가 매번 방어해야 함.

검토: 조회 API가 시스템 에러(DB 접근 불가 등)만 throw하고,
데이터 관련 에러는 빈 결과로 처리하는 방향. 또는 현행 유지하되 문서에 명확히 기술.

---

## 4. 인덱싱 완전성

현재 gildash는 resolve 실패한 import을 조용히 버린다.
인덱싱 엔진이 데이터를 유실하는 것은 정체성에 반한다.

### 4-1. bare specifier(외부 패키지) import 보존

현재 `imports-extractor.ts:23-24`:
```typescript
const candidates = resolveImportFn(filePath, sourcePath, tsconfigPaths);
if (candidates.length === 0) continue;  // 외부 패키지 import 소실
```

`import { merge } from 'lodash'` — resolve 실패 → relation 생성 안 함.
외부 패키지 import이 gildash 인덱스에서 완전히 소실됨.

변경:
- resolve 실패해도 relation 생성, raw specifier 보존
- `dstFilePath: null` (resolve 불가), `specifier: 'lodash/merge'` 원문 저장
- 스키마: `relations.dstFilePath` nullable로 변경 또는 specifier 컬럼 추가 필요
- FK constraint (`dstFilePath → files.filePath`) 조정 필요

소비자 활용:
- firebat: `searchRelations({ type: 'imports' })`에서 외부 패키지 필터 → unused/unlisted dependency 탐지
- emberdeck: 외부 의존성 변경 시 drift detection

### 4-2. unresolved import 기록

현재 상대/절대 경로 import인데 파일이 없는 경우 조용히 skip.
어떤 import이 깨졌는지 알 방법 없음.

변경:
- resolve 실패한 내부 import을 relation으로 기록
- `dstFilePath: null`, 원본 specifier 보존, unresolved 표시
- bare specifier(4-1)와 구별: 상대/절대 경로인데 파일 없음 vs 패키지명

소비자 활용:
- firebat: 깨진 import 조기 발견 (`DEP_UNRESOLVED_IMPORT` finding)
- emberdeck: drift detection에서 깨진 import 감지

### 4-3. require() / require.resolve() 추적

현재 `ImportDeclaration` + `ImportExpression`(dynamic import)만 relation 생성.
`require('pkg')`, `require.resolve('pkg')`는 `CallExpression`이라 무시됨.

변경:
- `require()`, `require.resolve()` CallExpression도 import relation으로 생성
- meta에 `{ isRequire: true }` 또는 `{ isRequireResolve: true }` 구분
- bare specifier(4-1), unresolved(4-2) 로직과 동일하게 적용

소비자 활용:
- firebat: CJS/ESM 혼용 프로젝트에서 unused dependency 탐지 정확도 향상
- require()로만 참조되는 패키지가 false positive로 잡히는 것 방지

### 4-4. re-export 패턴 B/C 인식

현재 gildash가 re-export로 인식하는 것은 패턴 A만:

```
패턴 A: export { X } from './other'              → re-exports ✓
패턴 B: import { X } from './other'; export { X } → imports만 기록, re-export 미인식 ✗
패턴 C: import X from './other'; export default X  → imports만 기록, re-export 미인식 ✗
```

재현 확인 완료. 패턴 B/C는 `type: 'imports'` relation만 생성되고 `type: 're-exports'`가 안 잡힘.

변경:
- `export { X }`의 `X`가 같은 파일 내 import된 이름과 일치하면 re-export relation 추가 생성
- `export default X`의 `X`가 import된 이름이면 동일하게 처리
- `module.staticExports` + `module.staticImports`를 교차 대조하면 구현 가능 (1-3 ParseResult.module 도입 후)

소비자 활용:
- firebat barrel/analyzer.ts의 이중 AST 순회(89줄) 제거 가능

### 4-5. 반환 경로 forward slash 정규화

firebat 11개 파일에 동일한 `value.replaceAll('\\', '/')` 정규화가 산재.
3개 파일에서 각각 `normalizePath` 함수를 별도 선언.

gildash가 반환하는 모든 경로(`filePath`, `srcFilePath`, `dstFilePath`)를
forward slash로 정규화해서 반환하면 소비자 보일러플레이트 제거.

---

## 5. TypeScript 극대화

### 5-1. extractor 레이어 strict 타입 복원

현재 `symbol-extractor.ts`, `imports-extractor.ts`, `calls-extractor.ts`에서
`as unknown as` 캐스팅으로 TypeScript strict 모드가 사실상 무력화.
1-4 (`@oxc-project/types`) 완료 후 strict가 실질적으로 작동.

### 5-2. `SymbolSearchResult` 타입 확장

`detail: Record<string, unknown>` → 구체 타입으로 개선.
현재 소비자가 `detail.parameters as string`, `detail.jsDoc as string` 등 수동 캐스팅.
`FullSymbol` 타입이 이미 구체화되어 있으나 `SymbolSearchResult.detail`은 여전히 generic.

---

## 6. 성능 및 모니터링

### 6-1. SQLite 인덱스 최적화 검증

현재 인덱스:
- `idx_symbols_project_file`, `idx_symbols_project_kind`, `idx_symbols_project_name`, `idx_symbols_fingerprint`
- `idx_relations_src`, `idx_relations_dst`, `idx_relations_type`, `idx_relations_project_type_src`

검증 필요:
- firebat의 실제 쿼리 패턴(`searchRelations({ type: 'imports', limit: 100_000 })`)에 최적인지
- `EXPLAIN QUERY PLAN`으로 full table scan 발생 여부 확인
- relation 조회 시 복합 인덱스 활용도 검증

### 6-2. CI 벤치마크 도입

parse + extract 파이프라인 성능 회귀를 CI에서 자동 감지.
현재 벤치마크 없음 — 성능 저하가 릴리스 후에야 발견됨.

도입:
- `bun test`와 별도로 벤치마크 스크립트 (parse, extract, search 단계별 측정)
- CI에서 이전 릴리스 대비 성능 비교
- threshold 초과 시 경고

### 6-3. 메모리 프로파일링

대규모 프로젝트(1000+ 파일) 인덱싱 시 메모리 사용량 미확인.
ParseCache LRU, AST 크기, SQLite 메모리, tsc LanguageService 메모리가 합산됨.

검증 필요:
- full index 시 피크 메모리 측정
- incremental index 시 메모리 누수 여부
- ParseCache 크기 대비 메모리 효율

---

## Blocked (외부 의존)

### Bun 4GiB ArrayBuffer → oxc-parser Raw Transfer

oxc-parser의 `rawTransferSupported()` — Rust→JS zero-copy AST 전달.
6GiB ArrayBuffer 필요하나 Bun(JavaScriptCore)은 4GiB 한계.
Bun이 하드코딩으로 차단됨 (`isBun → return false`).

해제 조건:
- WebKit/JSC가 typed array length를 `uint32_t` 이상으로 확장
- 또는 oxc-parser가 buffer 요구량을 4GiB 이하로 줄임

상세: `FUTURE.md` 참조.
