/**
 * Runs `fn` holding an origin-scoped exclusive Web Lock, so a schema migration never races
 * across tabs. "If Web Locks are unavailable in a supported browser, disable concurrent sync
 * entirely and show a single-active-tab warning rather than risking a race" — reflected here
 * as `usedLock: false` in the result, for the caller to surface that warning.
 */
export interface LockOutcome<T> {
  usedLock: boolean;
  result: T;
}

interface WebLocksLike {
  request<T>(name: string, callback: () => Promise<T> | T): Promise<T>;
}

function getWebLocks(): WebLocksLike | null {
  const nav: unknown = typeof navigator === 'undefined' ? undefined : navigator;
  if (nav === undefined || nav === null || typeof nav !== 'object') return null;
  const locks = (nav as { locks?: unknown }).locks;
  if (!locks || typeof (locks as WebLocksLike).request !== 'function') return null;
  return locks as WebLocksLike;
}

export async function withMigrationLock<T>(
  lockName: string,
  fn: () => Promise<T>,
): Promise<LockOutcome<T>> {
  const locks = getWebLocks();
  if (locks === null) {
    // Single-tab fallback: no cross-tab coordination is possible, so we simply run directly.
    return { usedLock: false, result: await fn() };
  }
  const result = await locks.request(lockName, () => fn());
  return { usedLock: true, result };
}

export function isWebLocksAvailable(): boolean {
  return getWebLocks() !== null;
}

export const WEB_LOCKS_UNAVAILABLE_CODE = 'WEB_LOCKS_UNAVAILABLE';

/**
 * Fail closed (security review P2-A): a guarded write/migration/sync entry point must refuse
 * to run rather than execute uncoordinated when Web Locks are unavailable — silently allowing
 * it (the old single-tab "fallback" behaviour) risks a real cross-tab race with no way to
 * detect it. Reads are unaffected; callers only guard the specific operations that need
 * cross-tab exclusivity.
 */
export class WebLocksUnavailableError extends Error {
  readonly code = WEB_LOCKS_UNAVAILABLE_CODE;
  constructor(message: string) {
    super(message);
    this.name = 'WebLocksUnavailableError';
  }
}
