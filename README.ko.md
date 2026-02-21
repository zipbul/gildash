# @zipbul/codeledger

Bun 런타임 전용 TypeScript 코드 인덱서.
소스 코드 심볼 추출, 파일 간 관계 분석, 의존성 그래프 구축을 하나의 로컬 SQLite DB로 제공합니다.

## 주요 기능

- **심볼 추출** — 함수, 클래스, 변수, 타입, 인터페이스, 열거형, 프로퍼티를 AST 수준에서 추출
- **관계 분석** — import, 함수 호출(calls), 상속(extends), 구현(implements) 관계 추적
- **전문 검색** — SQLite FTS5 기반 심볼 이름 전문 검색
- **의존성 그래프** — 파일 간 import 관계로 방향 그래프 구축, 순환 감지, 영향도 분석
- **증분 인덱싱** — @parcel/watcher 기반 파일 변경 감지, 변경된 파일만 재인덱싱
- **멀티 프로세스 안전** — owner/reader 역할 분리로 단일 writer 보장

## 요구사항

- **Bun** v1.3 이상
- 지원 확장자: `.ts`, `.mts`, `.cts`

## 설치

```bash
bun add @zipbul/codeledger
```

## 빠른 시작

```ts
import { Codeledger } from '@zipbul/codeledger';

// 인덱서 열기 — 최초 실행 시 전체 인덱싱 자동 수행
const ledger = await Codeledger.open({
  projectRoot: '/absolute/path/to/project',
});

// 심볼 검색
const symbols = ledger.searchSymbols({ text: 'UserService' });

// 특정 파일의 의존성 조회
const deps = ledger.getDependencies('src/app.ts');

// 종료
await ledger.close();
```

## API 레퍼런스

### `Codeledger.open(options)`

인덱서 인스턴스를 생성합니다. 최초 실행 시 전체 인덱싱을 수행하고, 이후 파일 변경을 감시합니다.

```ts
const ledger = await Codeledger.open({
  projectRoot: '/absolute/path',     // 필수. 절대 경로
  extensions: ['.ts', '.mts', '.cts'], // 선택. 인덱싱 대상 확장자
  ignorePatterns: ['dist', 'vendor'], // 선택. 무시할 디렉토리/패턴
  parseCacheCapacity: 500,            // 선택. 파싱 캐시 크기
});
```

| 옵션 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `projectRoot` | `string` | — | 프로젝트 루트 절대 경로 (필수) |
| `extensions` | `string[]` | `['.ts', '.mts', '.cts']` | 인덱싱 대상 파일 확장자 |
| `ignorePatterns` | `string[]` | `[]` | 무시할 경로 패턴 |
| `parseCacheCapacity` | `number` | `500` | LRU 파싱 캐시 최대 크기 |

**반환**: `Promise<Codeledger>`

---

### `ledger.close()`

인덱서를 종료합니다. watcher 중지, DB 연결 해제, 시그널 핸들러 제거를 수행합니다.

```ts
await ledger.close();
```

**반환**: `Promise<void>`

---

### `ledger.searchSymbols(query)`

심볼을 검색합니다. FTS5 전문 검색과 필터를 조합할 수 있습니다.

```ts
// 이름으로 검색
const results = ledger.searchSymbols({ text: 'handleClick' });

// 종류 + export 여부 필터
const classes = ledger.searchSymbols({
  kind: 'class',
  isExported: true,
  limit: 50,
});

// 파일 경로 필터
const inFile = ledger.searchSymbols({
  filePath: 'src/services/user.ts',
});
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `text` | `string?` | FTS5 전문 검색 쿼리 |
| `kind` | `SymbolKind?` | `'function'` \| `'method'` \| `'class'` \| `'variable'` \| `'type'` \| `'interface'` \| `'enum'` \| `'property'` |
| `filePath` | `string?` | 특정 파일 경로 필터 |
| `isExported` | `boolean?` | export 여부 필터 |
| `project` | `string?` | 프로젝트 이름 (모노레포 지원) |
| `limit` | `number?` | 최대 결과 수 |

**반환**: `SymbolSearchResult[]`

```ts
interface SymbolSearchResult {
  id: number;
  filePath: string;
  kind: SymbolKind;
  name: string;
  span: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  isExported: boolean;
  signature: string | null;
  fingerprint: string | null;
  detail: Record<string, unknown>;
}
```

---

### `ledger.searchRelations(query)`

파일/심볼 간 관계를 검색합니다.

```ts
// 특정 파일이 import하는 관계
const imports = ledger.searchRelations({
  srcFilePath: 'src/app.ts',
  type: 'imports',
});

// 특정 심볼을 호출하는 관계
const callers = ledger.searchRelations({
  dstSymbolName: 'processOrder',
  type: 'calls',
});
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `srcFilePath` | `string?` | 출발 파일 경로 |
| `srcSymbolName` | `string?` | 출발 심볼 이름 |
| `dstFilePath` | `string?` | 도착 파일 경로 |
| `dstSymbolName` | `string?` | 도착 심볼 이름 |
| `type` | `'imports'` \| `'calls'` \| `'extends'` \| `'implements'`? | 관계 유형 |
| `project` | `string?` | 프로젝트 이름 |
| `limit` | `number?` | 최대 결과 수 |

**반환**: `CodeRelation[]`

```ts
interface CodeRelation {
  type: 'imports' | 'calls' | 'extends' | 'implements';
  srcFilePath: string;
  srcSymbolName: string | null;  // null = 모듈 레벨
  dstFilePath: string;
  dstSymbolName: string | null;
  metaJson?: string;
}
```

---

### `ledger.getDependencies(filePath, project?)`

특정 파일이 import하는 파일 목록을 반환합니다.

```ts
const deps = ledger.getDependencies('src/app.ts');
// → ['src/utils.ts', 'src/config.ts', ...]
```

**반환**: `string[]`

---

### `ledger.getDependents(filePath, project?)`

특정 파일을 import하는 파일 목록을 반환합니다.

```ts
const dependents = ledger.getDependents('src/utils.ts');
// → ['src/app.ts', 'src/services/user.ts', ...]
```

**반환**: `string[]`

---

### `ledger.getAffected(changedFiles, project?)`

변경된 파일들의 영향을 받는 모든 파일을 전이적(transitive)으로 계산합니다.

```ts
const affected = await ledger.getAffected(['src/utils.ts']);
// → ['src/app.ts', 'src/services/user.ts', 'src/main.ts', ...]
```

**반환**: `Promise<string[]>`

---

### `ledger.hasCycle(project?)`

프로젝트의 import 그래프에 순환 의존성이 있는지 검사합니다.

```ts
const cyclic = await ledger.hasCycle();
if (cyclic) {
  console.warn('순환 의존성이 감지되었습니다');
}
```

**반환**: `Promise<boolean>`

---

### `ledger.reindex()`

수동으로 전체 재인덱싱을 수행합니다. owner 역할에서만 사용 가능합니다.

```ts
const result = await ledger.reindex();
```

**반환**: `Promise<IndexResult>`

---

### `ledger.onIndexed(callback)`

인덱싱 완료 이벤트를 구독합니다.

```ts
const unsubscribe = ledger.onIndexed((result) => {
  console.log(`인덱싱 완료: ${result.indexedFiles}개 파일`);
});

// 구독 해제
unsubscribe();
```

**반환**: `() => void` (구독 해제 함수)

---

### `ledger.projects`

감지된 프로젝트 경계 목록을 반환합니다 (모노레포에서 여러 프로젝트 감지).

```ts
const boundaries = ledger.projects;
// → [{ project: 'my-app', root: '/path/to/project' }, ...]
```

**타입**: `ProjectBoundary[]`

---

### `ledger.getStats(project?)`

심볼 통계를 반환합니다.

```ts
const stats = ledger.getStats();
```

**반환**: `SymbolStats`

---

### `ledger.parseSource(filePath, sourceText)`

파일을 파싱하여 AST를 반환합니다. 결과는 내부 캐시에 저장됩니다.

```ts
const parsed = ledger.parseSource('/path/to/file.ts', sourceCode);
```

**반환**: `ParsedFile`

---

### `ledger.extractSymbols(parsed)`

파싱된 파일에서 심볼을 추출합니다.

```ts
const symbols = ledger.extractSymbols(parsed);
```

**반환**: `ExtractedSymbol[]`

---

### `ledger.extractRelations(parsed)`

파싱된 파일에서 관계를 추출합니다.

```ts
const relations = ledger.extractRelations(parsed);
```

**반환**: `CodeRelation[]`

## 아키텍처

```
Codeledger (파사드)
├── Parser      — oxc-parser 기반 TypeScript AST 파싱
├── Extractor   — 심볼/관계 추출 (imports, calls, heritage)
├── Store       — bun:sqlite + drizzle-orm (files, symbols, relations, FTS5)
├── Indexer     — 변경 감지 → 파싱 → 추출 → 저장 파이프라인
├── Search      — 심볼 검색, 관계 검색, 의존성 그래프
└── Watcher     — @parcel/watcher + owner/reader 역할 관리
```

### Owner/Reader 패턴

동일 SQLite DB를 여러 프로세스가 공유할 때, 단일 writer를 보장합니다.

- **Owner**: watcher 실행, 인덱싱 수행, heartbeat 전송 (30초 간격)
- **Reader**: 읽기 전용 접근, 주기적으로 owner 상태 확인 (60초 간격)
- Owner 프로세스가 stale 상태가 되면 reader 중 하나가 owner로 승격

## 의존성

| 패키지 | 용도 |
|--------|------|
| [oxc-parser](https://oxc.rs) | TypeScript AST 파싱 |
| [drizzle-orm](https://orm.drizzle.team) | SQLite ORM + 마이그레이션 |
| [@parcel/watcher](https://github.com/parcel-bundler/watcher) | 네이티브 파일 변경 감시 |
| [comment-parser](https://github.com/syavorsky/comment-parser) | JSDoc 주석 파싱 |

## 테스트

```bash
# 전체 테스트 실행
bun test

# 커버리지 포함
bun run coverage
```

## 라이선스

[MIT](./LICENSE)
