import { GildashError, type GildashErrorType } from '../errors';
import type { GildashContext } from './context';

/**
 * Shared open-state precondition for every facade operation.
 * Throws `GildashError('closed')` if the instance has been closed.
 *
 * Use this directly for operations that have no failure mode to wrap
 * (e.g. callback subscriptions); use {@link guard} / {@link guardAsync}
 * when the operation can throw and its errors must be normalized.
 */
export function assertOpen(ctx: GildashContext): void {
  if (ctx.closed) {
    throw new GildashError('closed', 'Gildash: instance is closed');
  }
}

/**
 * Run a synchronous facade operation under the uniform guard:
 * reject use after close, pass any {@link GildashError} through untouched,
 * and wrap every other thrown error as a `GildashError` of `errorType`
 * with the message `Gildash: <op> failed`.
 *
 * This is the single definition of the facade's closed-check + error-wrap
 * contract — individual API functions must not re-implement it by hand.
 */
export function guard<T>(
  ctx: GildashContext,
  errorType: GildashErrorType,
  op: string,
  fn: () => T,
): T {
  assertOpen(ctx);
  try {
    return fn();
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError(errorType, `Gildash: ${op} failed`, { cause: e });
  }
}

/** Async counterpart of {@link guard}. Awaits `fn` so rejections are normalized too. */
export async function guardAsync<T>(
  ctx: GildashContext,
  errorType: GildashErrorType,
  op: string,
  fn: () => Promise<T>,
): Promise<T> {
  assertOpen(ctx);
  try {
    return await fn();
  } catch (e) {
    if (e instanceof GildashError) throw e;
    throw new GildashError(errorType, `Gildash: ${op} failed`, { cause: e });
  }
}
