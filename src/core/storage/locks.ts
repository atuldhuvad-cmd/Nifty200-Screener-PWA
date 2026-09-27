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
