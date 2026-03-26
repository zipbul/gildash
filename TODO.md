# TODO

gildash의 인프라 개선 및 소비자 지원 강화를 위한 작업 목록.
완료된 항목은 삭제한다.

---

## 검토 완료 — 현시점에서 도입하지 않는 것

### `oxc-resolver`

`extractor-utils.ts`의 `resolveImport()` 72줄을 `oxc-resolver`로 교체 검토 완료.

도입하지 않는 이유:
- gildash는 "후보 목록 반환 + knownFiles 교차 검증" 패턴. oxc-resolver는 "파일 시스템 직접 접근 + 단일 경로 반환". 인터페이스가 근본적으로 다름
- workspace 패키지(@zipbul/*) resolve 시 exports 필드 문제 발생 확인
- native 의존성 추가 대비 이점 부족

### `ScopeTracker` (oxc-walker)

calls-extractor의 수동 스코프 스택을 ScopeTracker로 교체 검토 완료.

도입하지 않는 이유:
- ScopeTracker.getCurrentScope()는 스코프 인덱스 문자열을 반환. 함수/클래스 이름을 제공하지 않음
- calls-extractor가 필요한 건 "이 호출이 어떤 함수 안에서 발생했는가"의 이름(srcSymbolName). ScopeTracker는 이 정보를 제공하지 않음
- walk()는 이미 도입 완료. ScopeTracker만 해당 없음

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
