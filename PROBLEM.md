# PROBLEM.md — TST-ISOLATION 잔여 위반 현황 및 결정 필요사항

> **Status**: 2026-02-19  
> **Context**: PLAN.md Phase 1-2 구현 완료 후 리뷰에서 식별된 TST-ISOLATION 위반 항목  
> **Current state**: 363 pass, 0 fail, 507 expect(), 커버리지 99.68%

---

## 1. 현재 상태 요약

모든 extractor `*.spec.ts` 파일(유닛 테스트)이 SUT의 외부 의존성을 실제 실행하고 있음.

**TST-ISOLATION 규칙:**
> SUT = single export (function / class).
> External dependencies — **ALL** replaced with test doubles — no exceptions.
> Module-level imports → Use `mock.module()` when DI is not available.

**TST-MOCK-STRATEGY 우선순위:**
> 1. DI injection → 2. `mock.module()` → 3. DI refactoring proposal

현재 extractor SUT들은 모두 모듈 레벨 import (DI 없음) → `mock.module()` 적용 대상.

---

## 2. 파일별 위반 현황

### 2.1 Tier 1 — 단순 mock 가능 (합성 함수)

| 파일 | SUT | it 수 | 외부 의존성 | mock 대상 모듈 |
|------|-----|-------|------------|---------------|
| `src/extractor/relation-extractor.spec.ts` | `extractRelations` | 8 | `buildImportMap`, `extractImports`, `extractCalls`, `extractHeritage` | `./extractor-utils`, `./imports-extractor`, `./calls-extractor`, `./heritage-extractor` |

**난이도: 낮음**

- SUT는 순수 orchestrator: 4개 하위 extractor 호출 → 결과 배열 합산
- 각 하위 extractor를 `mock.module()`로 대체 → 가짜 배열 반환 → merge 로직만 검증
- 기존 assertion 대부분 유지 가능 (결과 배열에 특정 type 포함 여부 확인)
- **Refactor-Only Checkpoint 가능** (it count 동일, 시나리오 불변)

**mock 설계:**
```typescript
// relation-extractor.spec.ts
import { mock } from 'bun:test';

const mockBuildImportMap = mock(() => new Map());
const mockExtractImports = mock(() => []);
const mockExtractCalls = mock(() => []);
const mockExtractHeritage = mock(() => []);

mock.module('./extractor-utils', () => ({ buildImportMap: mockBuildImportMap }));
mock.module('./imports-extractor', () => ({ extractImports: mockExtractImports }));
mock.module('./calls-extractor', () => ({ extractCalls: mockExtractCalls }));
mock.module('./heritage-extractor', () => ({ extractHeritage: mockExtractHeritage }));
```

**필요 작업량:** 약 1시간. 기존 8개 it의 assertion을 mock 반환값 기반으로 조정.

---

### 2.2 Tier 2 — assertion 전면 재작성 필요 (순수 AST 유틸리티)

#### 2.2.1 `calls-extractor.spec.ts`

| 항목 | 값 |
|------|-----|
| SUT | `extractCalls` |
| it 수 | 14 |
| 외부 의존성 | `getQualifiedName` (from `../parser/ast-utils`) |
| mock 대상 모듈 | `../parser/ast-utils` |

**문제 상세:**
- SUT가 AST를 직접 순회하면서 `CallExpression`/`NewExpression` 노드를 찾음 (visit 사용 안 함, 자체 재귀)
- 각 callee 노드에 대해 `getQualifiedName(node.callee)`를 호출 → `{ root, parts, full }` 반환
- 반환된 qualified name의 `root`로 importMap 조회 → dstFilePath/dstSymbolName 결정
- **현재 테스트**: 실제 소스 코드 → 실제 AST → 실제 getQualifiedName → 실제 결과 검증
- **mock 후**: getQualifiedName이 무엇을 반환할지 테스트가 직접 제어해야 함
- 14개 테스트 모두에서 mockImplementation을 per-test로 설정해야 하며, 일부 테스트는 여러 번 호출되는 getQualifiedName에 대해 순서별 다른 반환값 필요

**mock 시 assertion 영향:**
```
// 현재: 실제 AST에서 callee 이름이 실제로 추출됨
expect(rel.dstSymbolName).toBe('foo');

// mock 후: getQualifiedName mock 반환값을 테스트가 제어
mockGetQualifiedName.mockReturnValue({ root: 'foo', parts: [], full: 'foo' });
// → 모든 CallExpression에 동일 이름 반환 → 기존 테스트 로직 붕괴
// → mockImplementation에서 node.callee 타입별 분기 필요? → mock 복잡도 폭발
```

---

#### 2.2.2 `heritage-extractor.spec.ts`

| 항목 | 값 |
|------|-----|
| SUT | `extractHeritage` |
| it 수 | 9 |
| 외부 의존성 | `visit`, `getQualifiedName` (from `../parser/ast-utils`) |
| mock 대상 모듈 | `../parser/ast-utils` |

**문제 상세:**
- SUT가 **`visit()`으로 AST 전체를 순회**함 (`heritage-extractor.ts#L21`)
- `visit`은 범용 pre-order 트리 순회 함수 — mock하면 **SUT가 AST 노드를 하나도 방문하지 못함**
- `visit`을 mock하려면: mock 내부에서 callback에 적절한 ClassDeclaration 노드를 직접 전달해야 함
- 이는 "AST fixture를 수동 구성"하는 것과 동일 → 현재보다 더 복잡한 테스트 코드

**visit mock의 실현 가능성:**
```typescript
// visit을 mock하면 이런 코드가 필요:
mockVisit.mockImplementation((ast, callback) => {
  // ClassDeclaration 노드를 수동 생성하여 callback에 전달
  callback({
    type: 'ClassDeclaration',
    id: { name: 'Dog' },
    superClass: { type: 'Identifier', name: 'Animal' },
    implements: null,
    body: { body: [] },
  });
});
```
→ 테스트가 AST 구조를 수동으로 재현 → parseSync fixture 대비 유지보수 비용 급증

---

#### 2.2.3 `imports-extractor.spec.ts`

| 항목 | 값 |
|------|-----|
| SUT | `extractImports` |
| it 수 | 13 |
| 외부 의존성 | `resolveImport` (from `./extractor-utils`), `visit`, `getStringLiteralValue` (from `../parser/ast-utils`) |
| mock 대상 모듈 | `./extractor-utils`, `../parser/ast-utils` |

**문제 상세:**
- Pass 1 (top-level): `node.source?.value`로 직접 접근 + `resolveImport()` 호출 → resolveImport mock은 가능
- Pass 2 (dynamic import): `visit()` + `getStringLiteralValue()` 사용 → visit mock 시 heritage와 동일 문제
- `resolveImport` mock은 단순: `mockResolveImport.mockReturnValue('/resolved/path.ts')`
- `visit` mock은 2.2.2와 동일한 구조적 문제
- `getStringLiteralValue` mock은 단순하나, visit mock 없이는 의미 없음

---

#### 2.2.4 `symbol-extractor.spec.ts`

| 항목 | 값 |
|------|-----|
| SUT | `extractSymbols` |
| it 수 | 64 |
| 외부 의존성 | `buildLineOffsets` (from `../parser/source-position`), `getLineColumn` (from `../parser/source-position`), `parseJsDoc` (from `../parser/jsdoc-parser`) |
| mock 대상 모듈 | `../parser/source-position`, `../parser/jsdoc-parser` |

**문제 상세:**
- `buildLineOffsets(sourceText)` → `number[]` (줄 오프셋 배열). SUT 내부에서 한 번 호출.
- `getLineColumn(offsets, offset)` → `{ line, column }`. 각 심볼의 span.start/end에 사용.
- `parseJsDoc(commentText)` → `JsDocBlock | undefined`. JSDoc 파싱.
- **mock은 기술적으로 가능**: 세 함수 모두 단순 입력→출력 관계
- **assertion 영향**: 64개 테스트 중 span 관련 assertion이 있는 것들은 mock 반환값으로 변경 필요

**mock 설계 (가능):**
```typescript
const mockBuildLineOffsets = mock(() => [0]);
const mockGetLineColumn = mock(() => ({ line: 1, column: 0 }));
const mockParseJsDoc = mock(() => undefined);

mock.module('../parser/source-position', () => ({
  buildLineOffsets: mockBuildLineOffsets,
  getLineColumn: mockGetLineColumn,
}));
mock.module('../parser/jsdoc-parser', () => ({
  parseJsDoc: mockParseJsDoc,
}));
```

**Tier 2 중 유일하게 실현 가능성 높음:**
- SUT가 `visit()`을 사용하지 않음 (자체 AST 순회)
- mock 대상 3개 함수가 SUT의 로직 흐름에 "결과만 주입"하는 역할
- per-test mockImplementation이 필요한 경우: JSDoc 테스트 7개 (parseJsDoc 반환값 변경)
- span 관련 assertion만 고정 mock값으로 수정하면 됨
- **Refactor-Only 가능할 수 있음** (시나리오 자체는 불변, assertion 값만 변경)

---

### 2.3 Tier 3 — mock이 테스트 의미를 소멸시킴

| 파일 | SUT | it 수 | 외부 의존성 | mock 대상 모듈 |
|------|-----|-------|------------|---------------|
| `src/extractor/extractor-utils.spec.ts` | `resolveImport`, `buildImportMap` | 21 | `resolve`, `dirname`, `extname` (from `node:path`) | `node:path` |

**문제 상세:**

`resolveImport` 함수의 핵심 로직:
```typescript
// extractor-utils.ts#L1
import { resolve, dirname, extname } from 'node:path';

// resolveImport 내부:
const resolved = resolve(dirname(currentFile), specifier);
// + extname 체크 → .ts 확장자 추가 로직
```

- `resolveImport`의 존재 의미 = **path 연산을 올바르게 조합**하는 것
- `node:path`를 mock하면 → "resolve가 호출되었다", "dirname이 호출되었다"만 검증
- **실제 경로 해석이 올바른지** 검증 불가 → 테스트의 핵심 목적 상실

**구체적 예시:**
```typescript
// 현재 테스트 (의미 있음):
const result = resolveImport('/project/src/index.ts', './utils.ts');
expect(result).toBe('/project/src/utils.ts');
// → resolve(dirname('/project/src/index.ts'), './utils.ts') → '/project/src/utils.ts' 검증

// mock 후 (의미 없음):
mockResolve.mockReturnValue('/mocked/path');
const result = resolveImport('/project/src/index.ts', './utils.ts');
expect(result).toBe('/mocked/path.ts'); // ← 그냥 mock 반환값 확인
expect(mockDirname).toHaveBeenCalledWith('/project/src/index.ts');
expect(mockResolve).toHaveBeenCalledWith('/project/src', './utils.ts');
// → "올바른 인자로 호출했다"만 검증, 실제 경로 연산 정확도 미검증
```

**`buildImportMap`의 경우:**
- AST에서 ImportDeclaration 추출 → `resolveImport` 호출 → Map 구축
- `resolveImport`이 같은 모듈 내 함수 → mock 대상인가?
  - SUT boundary: `buildImportMap`이 SUT이면 같은 파일의 `resolveImport`은 내부
  - 하지만 `resolveImport`도 exported function → 별도 SUT?
  - **결정 필요**: 같은 파일의 다른 export 함수를 "외부 의존성"으로 볼 것인가?

---

## 3. 결정 필요 사항

### 3.1 [결정-1] Tier 2에서 `visit()` 함수의 취급

**배경:**
- `visit()`은 `../parser/ast-utils`에서 import된 범용 AST 순회 함수
- `heritage-extractor`, `imports-extractor`의 SUT가 `visit()`에 의존
- `visit()`을 mock하면 SUT가 AST 노드를 방문하지 못하므로, mock 내부에서 callback에 적절한 노드를 수동 전달해야 함
- 이는 "AST fixture를 parseSync로 생성"하는 현재 방식보다 복잡하고 취약함

**선택지:**

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| **A** | `visit()` mock + 수동 노드 전달 | TST-ISOLATION 완전 준수 | mock 복잡도 폭발, 유지보수 비용 급증, 테스트가 AST 구조에 하드코딩 의존 |
| **B** | `visit()`을 "범용 순회 유틸리티"로 취급하여 mock 면제 선언 | 테스트 유지보수 용이, 현재 동작 보존 | TST-ISOLATION 예외 필요 |
| **C** | SUT에 DI 도입 (visit을 파라미터로 주입) | 규칙 준수 + 테스트 유연성 | SUT 시그니처 변경, 공개 API 영향, DI 과잉 설계 우려 |

---

### 3.2 [결정-2] Tier 2에서 `getQualifiedName` / `getStringLiteralValue`의 취급

**배경:**
- 순수 함수 (side-effect 없음, I/O 없음, 상태 없음)
- AST 노드(DTO)를 받아 문자열/구조체를 반환하는 "DTO 프로퍼티 접근자" 성격
- mock하면 per-test mockImplementation이 필요하고 mock 로직이 복잡해짐

**선택지:**

| 옵션 | 설명 |
|------|------|
| **A** | 전부 mock — per-test mockImplementation 설정 |
| **B** | 순수 함수를 "DTO 접근 유틸리티"로 취급하여 mock 면제 |
| **C** | SUT에 DI 도입 |

---

### 3.3 [결정-3] Tier 3의 `node:path` 취급

**배경:**
- `node:path`는 Node.js/Bun 런타임 내장 모듈
- `resolve`, `dirname`, `extname`은 순수 문자열 연산 (I/O 없음)
- `resolveImport`의 존재 이유 = path 연산 조합의 정확성 보장
- mock하면 테스트가 "올바른 인자로 호출했다"만 검증 → 정확성 미검증

**선택지:**

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| **A** | `node:path` mock | TST-ISOLATION 완전 준수 | 테스트 검증력 소실, "resolve를 호출했다" 수준의 tautological test |
| **B** | `node:path`를 런타임 기본 제공으로 mock 면제 선언 | 테스트 검증력 유지 | TST-ISOLATION 예외 필요 |
| **C** | `resolveImport`에 path 함수를 DI로 주입 | 규칙 준수 + 테스트 유연성 | 과잉 설계, SUT 시그니처 복잡화 |

---

### 3.4 [결정-4] 같은 파일 내 다른 export의 SUT boundary

**배경:**
- `extractor-utils.ts`에서 `buildImportMap`이 같은 파일의 `resolveImport`을 호출
- TST-ISOLATION: "SUT = single export (function / class)"
- `buildImportMap` 테스트 시 `resolveImport`은 "외부 의존성"인가 "SUT 내부"인가?

**선택지:**

| 옵션 | 설명 |
|------|------|
| **A** | 같은 파일이라도 다른 export = 외부 → mock 필요 |
| **B** | 같은 파일의 export = SUT 내부 → real 사용 |

---

### 3.5 [결정-5] 작업 범위 및 순서

**배경:**
- 결정 1~4의 결과에 따라 실제 작업 범위가 달라짐

**선택지:**

| 옵션 | 범위 | 예상 영향 |
|------|------|----------|
| **A-Full** | 6개 파일 전부 mock (결정 1~4 모두 "A" 선택 시) | 130개 it 전면 재작성, 새 OVERFLOW/PRUNE 사이클 필수 |
| **B-Tier1+Symbols** | Tier 1 (`relation-extractor`) + `symbol-extractor` mock | 72개 it 영향, symbol-extractor는 Refactor-Only 가능 |
| **C-Tier1-Only** | Tier 1만 즉시 실행, 나머지 별도 태스크 | 8개 it 영향, 즉시 실행 가능 |
| **D-Exception** | `visit`/순수함수/`node:path` 면제 규칙 정의 후 Tier 1 + partial Tier 2 | 면제 규칙 문서화 필요 |

---

## 4. 영향 받지 않는 파일 (참고)

아래 spec 파일들은 extractor 외부이며, 현재 TST-ISOLATION을 이미 준수하거나 검토 대상 아님:

| 파일 | 상태 |
|------|------|
| `src/common/*.spec.ts` (5개) | 별도 검토 필요 |
| `src/parser/*.spec.ts` (5개) | 별도 검토 필요 |
| `src/watcher/*.spec.ts` (2개) | 별도 검토 필요 |
| `src/errors.spec.ts` | 별도 검토 필요 |
| `test/foundation.integration.test.ts` | Integration — 다른 규칙 적용 |

---

## 5. 기술 참조

### 5.1 bun:test mock.module() 동작 요약

| 특성 | 동작 |
|------|------|
| Live bindings | ESM live binding 지원 — mock.module() 호출 후 기존 import 자동 갱신 |
| 호출 시점 | import 전후 모두 가능 (이미 import된 모듈도 override 가능) |
| mock.restore() | mock.module()로 설정한 모듈은 **리셋되지 않음** |
| beforeEach 사용 | 가능 — beforeEach에서 mock.module() 재호출로 per-test 설정 가능 |
| Factory 평가 | Lazy — 실제 import/require 시점에 평가 |
| Path resolution | 상대 경로, 절대 경로, 패키지 이름 모두 지원 |

**출처:** bun.sh/docs/test/mocks (2026-02-19 확인)

### 5.2 적용 가능한 mock 패턴

```typescript
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';

// 1. mock 함수 선언
const mockDep = mock(() => defaultReturn);

// 2. 모듈 mock 설정
mock.module('./dep-module', () => ({ depFunction: mockDep }));

// 3. SUT import (mock.module() 이후)
import { sut } from './sut';

// 4. per-test 설정
beforeEach(() => {
  mockDep.mockClear(); // 호출 기록 초기화
});

// 5. 개별 테스트에서 반환값 변경
it('should ...', () => {
  mockDep.mockReturnValue(specificReturn);
  const result = sut(input);
  expect(result).toBe(expected);
  expect(mockDep).toHaveBeenCalledWith(expectedArgs);
});
```
