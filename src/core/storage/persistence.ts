import { getAllRuns } from './runs';
import { isRunAtRisk } from './runStatus';
import type { N200Database } from './schema';

export type PersistPromptResult = { supported: false } | { supported: true; granted: boolean };

/** Requests persistent storage (Storage API); reports whether it was granted, for the
 * caller to show "N unsynchronized runs remain vulnerable to storage clearing" if not. */
export async function requestPersistentStorage(): Promise<PersistPromptResult> {
  const nav: unknown = typeof navigator === 'undefined' ? undefined : navigator;
  if (nav === undefined || nav === null || typeof nav !== 'object') return { supported: false };
  const storage = (nav as { storage?: unknown }).storage;
  if (!storage || typeof (storage as { persist?: unknown }).persist !== 'function') {
    return { supported: false };
  }
  const granted = await (storage as { persist: () => Promise<boolean> }).persist();
  return { supported: true, granted };
}

/**
 * Count of runs with no verified Drive copy right now — the ones storage eviction actually
 * puts at risk. `diagnostics.has_verified_remote_copy` is the **sole authoritative** signal
 * (security review P1-A): it is set `true` only by `SYNC_SUCCEEDED` and cleared back to
 * `false` by `REMOTE_MISSING_DETECTED` or by entering `conflict`, so it always reflects
 * whether a verified copy exists *right now* — unlike `last_success_at`, which only records
 * that a sync succeeded *at some point* and stays non-null forever afterward, even once that
 * copy is known to be gone or superseded. Every state counts on this signal alone — including
 * `error` and `conflict` — **except** `quarantined` and `unsupported_schema`, which are
 * out of scope for this warning (an unresolved/uninterpreted run, not itself the kind of
 * "storage eviction risk" this count is about).
 */
export async function countAtRiskRuns(db: N200Database): Promise<number> {
  const runs = await getAllRuns(db);
  return runs.filter(isRunAtRisk).length;
}
