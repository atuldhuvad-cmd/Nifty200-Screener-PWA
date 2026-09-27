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

/** Count of `pending` runs — the ones storage-eviction risk actually applies to (already
 * `synced` runs are recoverable from Drive even if local storage is cleared). */
export async function countPendingRuns(db: N200Database): Promise<number> {
  const runs = await getAllRuns(db);
  return runs.filter((r) => r.sync.state === 'pending').length;
}
