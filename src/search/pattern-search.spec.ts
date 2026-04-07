import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockFindInFiles = mock(async (_lang: any, _config: any, _callback: any) => 0);

mock.module('@ast-grep/napi', () => ({
  Lang: { TypeScript: 'TypeScript' },
  findInFiles: mockFindInFiles,
}));

import { patternSearch } from './pattern-search';

beforeEach(() => {
  mock.module('@ast-grep/napi', () => ({
    Lang: { TypeScript: 'TypeScript' },
    findInFiles: mockFindInFiles,
  }));
  mockFindInFiles.mockClear();
  mockFindInFiles.mockImplementation(async (_lang, _config, callback) => {
    callback(null, []);
    return 0;
  });
});

describe('patternSearch', () => {
  // 1. [HP] filePaths 비어있으면 즉시 빈 배열 반환
  it('should return empty array immediately when filePaths is empty', async () => {
    const result = await patternSearch({ pattern: 'foo()', filePaths: [] });

    expect(result).toEqual([]);
    expect(mockFindInFiles).not.toHaveBeenCalled();
  });

  // 2. [HP] findInFiles 호출 시 pattern과 paths 전달
  it('should call findInFiles with correct pattern and paths', async () => {
    await patternSearch({ pattern: 'console.log($$$)', filePaths: ['/src/a.ts'] });

    expect(mockFindInFiles).toHaveBeenCalledWith(
      'TypeScript',
      expect.objectContaining({
        paths: ['/src/a.ts'],
        matcher: { rule: { pattern: 'console.log($$$)' } },
      }),
      expect.any(Function),
    );
  });

  // 3. [HP] 콜백 결과를 PatternMatch 배열로 변환
  it('should map SgNode results to PatternMatch with 1-based line numbers', async () => {
    const fakeNode = {
      range: () => ({ start: { line: 4, column: 0, index: 40 }, end: { line: 4, column: 15, index: 55 } }),
      text: () => 'console.log("hi")',
      getRoot: () => ({ filename: () => '/src/a.ts' }),
      getMatch: () => null,
      getMultipleMatches: () => [],
    };
    mockFindInFiles.mockImplementation(async (_lang, _config, callback) => {
      callback(null, [fakeNode]);
      return 1;
    });

    const result = await patternSearch({ pattern: 'console.log($$$)', filePaths: ['/src/a.ts'] });

    expect(result).toEqual([{
      filePath: '/src/a.ts',
      startLine: 5, // 0-based 4 → 1-based 5
      endLine: 5,
      startColumn: 0,
      endColumn: 15,
      startOffset: 40,
      endOffset: 55,
      matchedText: 'console.log("hi")',
    }]);
  });

  // 4. [HP] 매칭 없음 → 빈 배열
  it('should return empty array when findInFiles calls callback with empty nodes', async () => {
    mockFindInFiles.mockImplementation(async (_lang, _config, callback) => {
      callback(null, []);
      return 0;
    });

    const result = await patternSearch({ pattern: 'nonExistent()', filePaths: ['/src/a.ts'] });

    expect(result).toEqual([]);
  });

  // 5. [EP] 콜백 err 있을 때 → 해당 배치 무시 (결과 없음)
  it('should skip nodes when callback receives an error', async () => {
    mockFindInFiles.mockImplementation(async (_lang, _config, callback) => {
      callback(new Error('parse error'), []);
      return 0;
    });

    const result = await patternSearch({ pattern: 'foo()', filePaths: ['/src/a.ts'] });

    expect(result).toEqual([]);
  });

  // 6. [HP] 여러 노드 → 모두 수집
  it('should collect all nodes from multiple callback results', async () => {
    const makeNode = (line: number, file: string) => ({
      range: () => ({ start: { line, column: 0, index: line * 10 }, end: { line, column: 5, index: line * 10 + 5 } }),
      text: () => `node-${line}`,
      getRoot: () => ({ filename: () => file }),
      getMatch: () => null,
      getMultipleMatches: () => [],
    });
    mockFindInFiles.mockImplementation(async (_lang, _config, callback) => {
      callback(null, [makeNode(0, '/src/a.ts'), makeNode(2, '/src/b.ts')]);
      return 2;
    });

    const result = await patternSearch({ pattern: 'foo()', filePaths: ['/src/a.ts', '/src/b.ts'] });

    expect(result.length).toBe(2);
    expect(result[0]!.filePath).toBe('/src/a.ts');
    expect(result[1]!.filePath).toBe('/src/b.ts');
  });

  // ─── Captures ────────────────────────────────────────────────────────

  // 7. [HP] 패턴에 메타변수가 없으면 captures 미포함
  it('should not include captures when pattern has no metavariables', async () => {
    const fakeNode = {
      range: () => ({ start: { line: 0, column: 0, index: 0 }, end: { line: 0, column: 5, index: 5 } }),
      text: () => 'foo()',
      getRoot: () => ({ filename: () => '/a.ts' }),
      getMatch: () => null,
      getMultipleMatches: () => [],
    };
    mockFindInFiles.mockImplementation(async (_lang, _config, callback) => {
      callback(null, [fakeNode]);
      return 1;
    });

    const result = await patternSearch({ pattern: 'foo()', filePaths: ['/a.ts'] });
    expect(result[0]!.captures).toBeUndefined();
  });

  // 8. [HP] 단일 메타변수 캡처 ($NAME)
  it('should populate captures for single metavariable match', async () => {
    const capturedNode = {
      text: () => 'getBody',
      range: () => ({ start: { line: 2, column: 4, index: 24 }, end: { line: 2, column: 11, index: 31 } }),
    };
    const fakeNode = {
      range: () => ({ start: { line: 2, column: 0, index: 20 }, end: { line: 2, column: 13, index: 33 } }),
      text: () => 'ctx.getBody()',
      getRoot: () => ({ filename: () => '/a.ts' }),
      getMatch: (name: string) => name === '$METHOD' ? capturedNode : null,
      getMultipleMatches: () => [],
    };
    mockFindInFiles.mockImplementation(async (_lang, _config, callback) => {
      callback(null, [fakeNode]);
      return 1;
    });

    const result = await patternSearch({ pattern: 'ctx.$METHOD()', filePaths: ['/a.ts'] });
    expect(result[0]!.captures).toBeDefined();
    expect(result[0]!.captures!['$METHOD']).toEqual({
      text: 'getBody',
      startLine: 3,
      endLine: 3,
      startColumn: 4,
      endColumn: 11,
      startOffset: 24,
      endOffset: 31,
    });
  });

  // 9. [HP] 여러 메타변수 동시 캡처
  it('should populate captures for multiple metavariables', async () => {
    const methodNode = {
      text: () => 'getBody',
      range: () => ({ start: { line: 1, column: 4, index: 14 }, end: { line: 1, column: 11, index: 21 } }),
    };
    const typeNode = {
      text: () => 'UserDto',
      range: () => ({ start: { line: 1, column: 12, index: 22 }, end: { line: 1, column: 19, index: 29 } }),
    };
    const fakeNode = {
      range: () => ({ start: { line: 1, column: 0, index: 10 }, end: { line: 1, column: 22, index: 32 } }),
      text: () => 'ctx.getBody<UserDto>()',
      getRoot: () => ({ filename: () => '/a.ts' }),
      getMatch: (name: string) => {
        if (name === '$METHOD') return methodNode;
        if (name === '$TYPE') return typeNode;
        return null;
      },
      getMultipleMatches: () => [],
    };
    mockFindInFiles.mockImplementation(async (_lang, _config, callback) => {
      callback(null, [fakeNode]);
      return 1;
    });

    const result = await patternSearch({ pattern: 'ctx.$METHOD<$TYPE>()', filePaths: ['/a.ts'] });
    expect(result[0]!.captures!['$METHOD']).toBeDefined();
    expect(result[0]!.captures!['$TYPE']).toBeDefined();
    expect(result[0]!.captures!['$METHOD']!.text).toBe('getBody');
    expect(result[0]!.captures!['$METHOD']!.startOffset).toBe(14);
    expect(result[0]!.captures!['$TYPE']!.text).toBe('UserDto');
  });

  // 10. [HP] variadic 메타변수 ($$$ARGS) 캡처
  it('should populate captures for variadic metavariable using getMultipleMatches', async () => {
    const argNodes = [
      { text: () => "'a'", range: () => ({ start: { line: 3, column: 3, index: 33 }, end: { line: 3, column: 6, index: 36 } }) },
      { text: () => "'b'", range: () => ({ start: { line: 3, column: 8, index: 38 }, end: { line: 3, column: 11, index: 41 } }) },
    ];
    const fakeNode = {
      range: () => ({ start: { line: 3, column: 0, index: 30 }, end: { line: 3, column: 12, index: 42 } }),
      text: () => "fn('a', 'b')",
      getRoot: () => ({ filename: () => '/a.ts' }),
      getMatch: () => null,
      getMultipleMatches: (name: string) => name === '$$$ARGS' ? argNodes : [],
    };
    mockFindInFiles.mockImplementation(async (_lang, _config, callback) => {
      callback(null, [fakeNode]);
      return 1;
    });

    const result = await patternSearch({ pattern: 'fn($$$ARGS)', filePaths: ['/a.ts'] });
    expect(result[0]!.captures!['$$$ARGS']).toBeDefined();
    expect(result[0]!.captures!['$$$ARGS']!.text).toBe("'a', 'b'");
    expect(result[0]!.captures!['$$$ARGS']!.startOffset).toBe(33);
    expect(result[0]!.captures!['$$$ARGS']!.endOffset).toBe(41);
  });

  // 11. [EP] 메타변수가 매칭되지 않으면 captures에서 제외
  it('should omit unmatched metavariables from captures', async () => {
    const fakeNode = {
      range: () => ({ start: { line: 0, column: 0, index: 0 }, end: { line: 0, column: 5, index: 5 } }),
      text: () => 'x.y()',
      getRoot: () => ({ filename: () => '/a.ts' }),
      getMatch: () => null,
      getMultipleMatches: () => [],
    };
    mockFindInFiles.mockImplementation(async (_lang, _config, callback) => {
      callback(null, [fakeNode]);
      return 1;
    });

    const result = await patternSearch({ pattern: '$OBJ.$METHOD()', filePaths: ['/a.ts'] });
    // Both metavariables unmatched → captures undefined
    expect(result[0]!.captures).toBeUndefined();
  });
});
