# TODO

gildash의 인프라 개선 및 소비자 지원 강화를 위한 작업 목록.
완료된 항목은 삭제한다.

---

## 1. oxc 생태계

### 1-7. `oxc-resolver` 도입 검토

현재 `extractor-utils.ts`의 `resolveImport()` 72줄이 모듈 해석을 자체 구현
(tsconfig paths, 확장자 후보 생성).
`oxc-resolver`가 동일 기능을 Rust-native로 제공 (더 정확, 더 빠름).

현재 인터페이스 차이:
- gildash `resolveImport`은 후보 목록(`string[]`)을 반환하고 호출자가 `knownFiles`와 교차 검증
- `oxc-resolver.resolveFileSync`는 단일 확정 경로를 반환 (파일 시스템 접근)
- 교체 시 `resolveImport` + 호출자의 후보 검증 로직 전체를 변경해야 함

---

## 2. 소비자 지원

### 2-5. emberdeck API 런타임 체크 제거

emberdeck이 gildash API 존재 여부를 런타임에서 체크:

```typescript
if (typeof ctx.gildash.getSymbolChanges !== 'function') return null;
if (typeof (ctx.gildash as any).getDependencies !== 'function') { ... }
```

gildash 타입에 API 가용성이 정확히 반영되도록 semver 준수.
emberdeck이 gildash 버전을 올리면 자동 해소.

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
