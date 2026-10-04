import { mapColumns } from '../csv/headers';
import { buildStockIdentity } from '../csv/identifiers';
import type { RunEnvelopeV1, RunEnvelopeV2 } from '../envelope/types';
import { rebuildComparisonIndexTx } from './comparisonIndex';
import { RUNS_BY_ORIGINAL_FILE_SHA256, STORE, type N200Database } from './schema';
import { transition, type SyncEvent } from './syncState';
import { initialSyncRecord, type RunRecord, type SyncState } from './types';
import { safeAbort } from './txUtils';

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
  envelope: RunEnvelopeV1 | RunEnvelopeV2,
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
    // A failed request already auto-aborts the native transaction per spec; a JS error
    // *between* requests would not, so this is best-effort. Only report a run-ID collision
    // when that run key is actually present; other IndexedDB constraint failures should surface
    // as ordinary save failures instead of a misleading random-ID message.
    safeAbort(tx);
    if (isConstraintError(e)) {
      const existing = await db.get(STORE.runs, envelope.run_id);
      if (existing !== undefined) return { ok: false, reason: 'run_id_collision' };
    }
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

function isV1(envelope: RunRecord['envelope']): envelope is RunEnvelopeV1 {
  return envelope.schema_version === '1';
}

function isV2(envelope: RunRecord['envelope']): envelope is RunEnvelopeV2 {
  return envelope.schema_version === '2';
}

/** Every source-file hash a run was built from: a v1 run's single `original_file_sha256`, or
 * a v2 run's `source_files[].original_file_sha256`, in source order. */
function sourceHashesOf(envelope: RunRecord['envelope']): string[] {
  if (isV1(envelope)) return [envelope.original_file_sha256];
  if (isV2(envelope)) return envelope.source_files.map((sf) => sf.original_file_sha256);
  return [];
}

/**
 * Non-blocking duplicate check for a multipart import (Step 4A): does this hash belong to any
 * previously-imported file, whether that file was committed as a single-file v1 run or as one
 * part of a multipart v2 run? No index backs this (the dataset is small and local-first; see
 * DECISIONS.md) — it is a full scan, same performance posture as the rest of this app's
 * "no server, no scale" design.
 */
export async function findRunsBySourceFileHash(
  db: N200Database,
  sha256: string,
): Promise<string[]> {
  const all = await getAllRuns(db);
  return all.filter((r) => sourceHashesOf(r.envelope).includes(sha256)).map((r) => r.run_id);
}

/**
 * The stronger multipart duplicate signal (Step 4A): does any existing run's *complete, ordered*
 * set of source-file hashes exactly equal this candidate set? A match means this exact
 * combination of files (in this exact order) was already imported as one run.
 */
export async function findRunsByExactSourceHashSet(
  db: N200Database,
  orderedSha256: string[],
): Promise<string[]> {
  const all = await getAllRuns(db);
  return all
    .filter((r) => {
      const hashes = sourceHashesOf(r.envelope);
      return (
        hashes.length === orderedSha256.length && hashes.every((h, i) => h === orderedSha256[i])
      );
    })
    .map((r) => r.run_id);
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
  if (!record) return;
  const { schema_version } = record.envelope;
  if (schema_version !== '1' && schema_version !== '2') return;
  const tx = db.transaction(STORE.comparisonIdentity, 'readwrite');
  await rebuildComparisonIndexTx(
    tx.objectStore(STORE.comparisonIdentity),
    runId,
    record.envelope as RunEnvelopeV1 | RunEnvelopeV2,
  );
  await tx.done;
}

// Re-exported so ingest.ts can build identity rows without importing csv internals directly.
export { mapColumns, buildStockIdentity };
