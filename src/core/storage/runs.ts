import { mapColumns } from '../csv/headers';
import { buildStockIdentity } from '../csv/identifiers';
import type { RunEnvelopeV1 } from '../envelope/types';
import { rebuildComparisonIndexTx } from './comparisonIndex';
import { RUNS_BY_ORIGINAL_FILE_SHA256, STORE, type N200Database } from './schema';
import { transition, type SyncEvent } from './syncState';
import { initialSyncRecord, type RunRecord, type SyncState } from './types';

/**
 * Aborts `tx` if it is still active, and observes its `.done` rejection either way — so an
 * intentional abort never surfaces as an unhandled promise rejection. Safe to call on a
 * transaction IndexedDB has already auto-aborted itself (a failed request does this).
 */
function safeAbort(tx: { abort(): void; done: Promise<void> }): void {
  try {
    tx.abort();
  } catch {
    // Already inactive/aborted.
  }
  tx.done.catch(() => {
    // Expected: aborting rejects `.done`.
  });
}

export type CommitNewRunResult =
  | { ok: true; run_id: string }
  /** `run_id` collision against the unique keyPath constraint — astronomically unlikely with
   * `crypto.randomUUID()`, but surfaced (rather than silently overwritten) so a caller can
   * regenerate and retry, per the brief ("generate another before committing"). */
  | { ok: false; reason: 'run_id_collision' };

/**
 * Atomic import (Engineering Standards, "Atomic import transaction"): the envelope, the
 * rebuilt comparison-identity index, and the initial `pending` sync state commit in one
 * IndexedDB transaction. If any write fails, the whole transaction aborts and no partial run
 * is left behind — this is native IndexedDB transaction behaviour, not something layered on
 * top. Duplicate-hash detection (`findRunsByOriginalFileHash`) is a separate, non-blocking
 * check the caller makes before calling this; committing a duplicate is always allowed.
 */
export async function commitNewRun(
  db: N200Database,
  envelope: RunEnvelopeV1,
): Promise<CommitNewRunResult> {
  const tx = db.transaction([STORE.runs, STORE.comparisonIdentity], 'readwrite');
  const record: RunRecord = {
    run_id: envelope.run_id,
    envelope,
    sync: initialSyncRecord('pending'),
  };

  try {
    await tx.objectStore(STORE.runs).add(record);
    await rebuildComparisonIndexTx(
      tx.objectStore(STORE.comparisonIdentity),
      envelope.run_id,
      envelope,
    );
    await tx.done;
    return { ok: true, run_id: envelope.run_id };
  } catch (e) {
    // A failed request (e.g. the ConstraintError below) already auto-aborts the native
    // transaction per spec; a JS error *between* requests would not, so this is best-effort.
    safeAbort(tx);
    if (isConstraintError(e)) return { ok: false, reason: 'run_id_collision' };
    throw e;
  }
}

function isConstraintError(e: unknown): boolean {
  return e instanceof Error && e.name === 'ConstraintError';
}

/** Non-blocking duplicate-hash check (brief: "Warn the user ... never auto-block or merge"). */
export async function findRunsByOriginalFileHash(
  db: N200Database,
  sha256: string,
): Promise<string[]> {
  const records = await db.getAllFromIndex(STORE.runs, RUNS_BY_ORIGINAL_FILE_SHA256, sha256);
  return records.map((r) => r.run_id);
}

export async function getRun(db: N200Database, runId: string): Promise<RunRecord | undefined> {
  return db.get(STORE.runs, runId);
}

export async function getAllRuns(db: N200Database): Promise<RunRecord[]> {
  return db.getAll(STORE.runs);
}

export type ApplyTransitionResult =
  | { ok: true; state: SyncState }
  | { ok: false; reason: 'run_not_found' }
  | { ok: false; reason: 'invalid_transition'; from: SyncState; event: SyncEvent['type'] };

/**
 * The only way any run's `sync` field is ever written after commit — reads, applies
 * `transition()`, and writes back inside one transaction, so concurrent callers can never
 * race past each other's stale reads.
 */
export async function applyTransition(
  db: N200Database,
  runId: string,
  event: SyncEvent,
): Promise<ApplyTransitionResult> {
  const tx = db.transaction(STORE.runs, 'readwrite');
  const store = tx.objectStore(STORE.runs);
  const record = await store.get(runId);
  if (!record) {
    safeAbort(tx);
    return { ok: false, reason: 'run_not_found' };
  }

  const result = transition(record.sync, event);
  if (!result.ok) {
    safeAbort(tx);
    return result;
  }

  await store.put({ ...record, sync: result.record });
  await tx.done;
  return { ok: true, state: result.record.state };
}

/**
 * Rebuilds the run's comparison-identity index rows without changing the envelope or sync
 * state — used to recompute the derived index for a run already in `runs` (e.g. after an
 * app upgrade changes identity-normalization rules). Re-derives identity from the raw cells
 * exactly as `analyzeCsvBytes` does; identity is never read back out of a stored envelope.
 */
export async function rebuildComparisonIndexForRun(db: N200Database, runId: string): Promise<void> {
  const record = await db.get(STORE.runs, runId);
  if (!record || record.envelope.schema_version !== '1') return;
  const tx = db.transaction(STORE.comparisonIdentity, 'readwrite');
  await rebuildComparisonIndexTx(
    tx.objectStore(STORE.comparisonIdentity),
    runId,
    record.envelope as RunEnvelopeV1,
  );
  await tx.done;
}

// Re-exported so ingest.ts can build identity rows without importing csv internals directly.
export { mapColumns, buildStockIdentity };
