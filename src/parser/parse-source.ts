import { err, type Result } from '@zipbul/result';
import { parseSync as defaultParseSync } from 'oxc-parser';
import type { ParserOptions } from 'oxc-parser';
import type { ParsedFile } from './types';
import { GildashError } from '../errors';

export function parseSource(
  filePath: string,
  sourceText: string,
  options?: ParserOptions,
  parseSyncFn: typeof defaultParseSync = defaultParseSync,
): Result<ParsedFile, GildashError> {
  try {
    const mergedOptions = { preserveParens: false, ...options };
    const result = parseSyncFn(filePath, sourceText, mergedOptions);
    return { filePath, program: result.program as ParsedFile['program'], errors: result.errors, comments: result.comments, sourceText, module: result.module };
  } catch (e) {
    return err(new GildashError('parse', `Failed to parse file: ${filePath}`, { cause: e }));
  }
}
