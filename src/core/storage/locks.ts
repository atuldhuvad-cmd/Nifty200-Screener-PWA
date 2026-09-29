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
  request<T>(
    name: string,
    options: { mode?: 'shared' | 'exclusive' },
    callback: () => Promise<T> | T,
  ): Promise<T>;
}

/**
 * The single origin-wide lock that guards every operation a service-worker update must never
 * interrupt (Step 8). One name, so nothing ever needs to hold two locks at once (no nesting):
 *  - imports hold it SHARED (several may run at once);
 *  - schema migrations and backup restores hold it EXCLUSIVE;
 *  - a user-accepted update takes it EXCLUSIVE, and only while holding it asks the waiting
 *    worker to activate — so the check for running operations and the activation are one atomic
 *    step, across every open tab, with no check-then-activate race.
 */
export const ACTIVITY_LOCK_NAME = 'n200-activity';

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

/**
 * Runs an operation (an import commit) while holding the activity lock in shared mode, so an
 * update accepted in any tab waits for it. If Web Locks are unavailable the operation still runs
 * (imports remain allowed, DECISIONS §15): updates cannot then be coordinated, so the updater
 * fails closed instead (`activateWaitingWorker`).
 */
export async function withActivity<T>(fn: () => Promise<T>): Promise<T> {
  const locks = getWebLocks();
  if (locks === null) return fn();
  return locks.request(ACTIVITY_LOCK_NAME, { mode: 'shared' }, () => fn());
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

/**
 * Runs `fn` holding an origin-scoped exclusive Web Lock and — unlike `withMigrationLock` —
 * refuses to run at all when Web Locks are unavailable (fail closed: `WebLocksUnavailableError`
 * is thrown before `fn` is ever called). For multi-step entry points such as backup restoration
 * (brief, "Cross-tab concurrency"). The lock only serializes tabs: it does not make `fn` atomic,
 * and any per-step transactions inside `fn` remain the sole atomicity guarantee. Never call this
 * from inside another held lock (no nested locks).
 */
export async function withRequiredLock<T>(lockName: string, fn: () => Promise<T>): Promise<T> {
  const locks = getWebLocks();
  if (locks === null) {
    throw new WebLocksUnavailableError(
      `"${lockName}" needs cross-tab coordination but Web Locks are unavailable. Use a single tab in a browser that supports Web Locks.`,
    );
  }
  return locks.request(lockName, () => fn());
}
