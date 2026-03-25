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
    const { program, errors, comments } = parseSyncFn(filePath, sourceText, mergedOptions);
    return { filePath, program: program as ParsedFile['program'], errors, comments, sourceText };
  } catch (e) {
    return err(new GildashError('parse', `Failed to parse file: ${filePath}`, { cause: e }));
  }
}
