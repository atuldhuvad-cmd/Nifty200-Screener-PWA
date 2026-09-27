import { getAllRuns } from './runs';
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
 * puts at risk (§9 review, item 4): `pending`, `local_only`, and `remote_missing`
 * unconditionally, plus `error` only for a run that has never once synced successfully
 * (`last_success_at === null`) — an `error` run that previously synced still has a verified
 * remote copy from before the failure. Already-`synced` runs are excluded outright.
 */
export async function countAtRiskRuns(db: N200Database): Promise<number> {
  const runs = await getAllRuns(db);
  return runs.filter((r) => {
    const { state, diagnostics } = r.sync;
    if (state === 'pending' || state === 'local_only' || state === 'remote_missing') return true;
    if (state === 'error') return diagnostics.last_success_at === null;
    return false;
  }).length;
}
