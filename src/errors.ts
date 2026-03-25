/**
 * Discriminated union type representing all possible error categories in Gildash.
 */
export type GildashErrorType =
  | 'watcher'
  | 'parse'
  | 'extract'
  | 'index'
  | 'store'
  | 'search'
  | 'closed'
  | 'validation'
  | 'close'
  | 'semantic';

/**
 * Error class used throughout Gildash.
 * Extends `Error` so that `instanceof Error` checks work and stack traces are captured.
 */
export class GildashError extends Error {
  constructor(
    public readonly type: GildashErrorType,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'GildashError';
  }
}


