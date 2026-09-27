import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analyzeCsvBytes } from '../../src/core/csv/analyze';
import { buildEnvelope } from '../../src/core/envelope/build';
import {
  applyTransition,
  commitNewRun,
  findRunsByOriginalFileHash,
  getAllRuns,
  getRun,
  rebuildComparisonIndexForRun,
} from '../../src/core/storage/runs';
import {
  COMPARISON_BY_RUN_ID,
  openDatabase,
  STORE,
  type N200Database,
} from '../../src/core/storage/schema';
import { initialSyncRecord } from '../../src/core/storage/types';
import { buildCsv, SYNTHETIC_HEADER } from '../helpers';
import { buildTestEnvelope, freshDbName } from '../storage-helpers';

let db: N200Database;

beforeEach(async () => {
  ({ db } = await openDatabase({ name: freshDbName() }));
});

afterEach(() => {
  db.close();
});

describe('commitNewRun', () => {
  it('commits a new run with initial sync state pending and a rebuilt comparison index', async () => {
    const envelope = await buildTestEnvelope();
    const result = await commitNewRun(db, envelope);
    expect(result).toEqual({ ok: true, run_id: envelope.run_id });

    const stored = await getRun(db, envelope.run_id);
    expect(stored?.envelope).toEqual(envelope);
    expect(stored?.sync.state).toBe('pending');
    expect(stored?.sync.diagnostics.attempt_count).toBe(0);

    const compRows = await db.getAllFromIndex(
      STORE.comparisonIdentity,
      COMPARISON_BY_RUN_ID,
      envelope.run_id,
    );
    expect(compRows.length).toBeGreaterThan(0);
  });

  it('enforces run_id uniqueness: a second commit with the same run_id is rejected, not overwritten', async () => {
    const envelope = await buildTestEnvelope({ runId: '11111111-1111-4111-8111-111111111111' });
    const first = await commitNewRun(db, envelope);
    expect(first.ok).toBe(true);

    const differentContent = await buildTestEnvelope({
      runId: '11111111-1111-4111-8111-111111111111',
      fixture: 'SYNTHETIC_non_ascii_names.csv',
    });
    const second = await commitNewRun(db, differentContent);
    expect(second).toEqual({ ok: false, reason: 'run_id_collision' });

    // The original is untouched — never silently overwritten.
    const stored = await getRun(db, envelope.run_id);
    expect(stored?.envelope).toEqual(envelope);
    const all = await getAllRuns(db);
    expect(all).toHaveLength(1);
  });

  it('allows a second, independent run to commit even when its original_file_sha256 duplicates an existing run (warning is informational only)', async () => {
    const envelope = await buildTestEnvelope();
    await commitNewRun(db, envelope);

    // Same bytes, different run_id (as a fresh import of the identical file would produce).
    const duplicate = await buildTestEnvelope({ runId: '22222222-2222-4222-8222-222222222222' });
    expect(duplicate.original_file_sha256).toBe(envelope.original_file_sha256);

    const dupResult = await commitNewRun(db, duplicate);
    expect(dupResult).toEqual({ ok: true, run_id: duplicate.run_id });

    const matches = await findRunsByOriginalFileHash(db, envelope.original_file_sha256);
    expect(matches.sort()).toEqual([envelope.run_id, duplicate.run_id].sort());
  });

  it('findRunsByOriginalFileHash returns empty for a hash no run has', async () => {
    await commitNewRun(db, await buildTestEnvelope());
    expect(await findRunsByOriginalFileHash(db, 'f'.repeat(64))).toEqual([]);
  });

  it('the empty-run case (§9 amendment) commits cleanly with stock_count 0 and an empty comparison index', async () => {
    const bytes = buildCsv([SYNTHETIC_HEADER]);
    const analysis = analyzeCsvBytes(bytes);
    if (!analysis.ok || !analysis.canConfirm) throw new Error('unexpected analysis failure');
    const built = await buildEnvelope({
      originalBytes: bytes,
      analysis,
      originalFilename: 'empty.csv',
      originalFileMimeType: 'text/csv',
      effectiveDate: '2026-09-27',
    });
    if (!built.ok) throw new Error('unexpected build failure');

    const result = await commitNewRun(db, built.envelope);
    expect(result).toEqual({ ok: true, run_id: built.envelope.run_id });

    const stored = await getRun(db, built.envelope.run_id);
    expect(stored?.envelope.rows).toEqual([]);
    const compRows = await db.getAllFromIndex(
      STORE.comparisonIdentity,
      COMPARISON_BY_RUN_ID,
      built.envelope.run_id,
    );
    expect(compRows).toEqual([]);
  });
});

describe('atomic import: rollback on a simulated mid-transaction failure', () => {
  it('a write failure partway through the transaction (runs.add rejects on a pre-existing key) leaves zero partial data: the comparison-identity write queued right after it never lands either', async () => {
    const envelope = await buildTestEnvelope();

    // Pre-seed a run under the same run_id, so the transaction's first write (runs.add) is
    // the one that fails with a real IndexedDB ConstraintError. commitNewRun queues the
    // comparison-identity writes immediately after that in the same transaction; IndexedDB
    // aborts the whole transaction on the failed request, so this proves those writes never
    // land either — not just that the code "didn't get around to" issuing them.
    await db.add(STORE.runs, {
      run_id: envelope.run_id,
      envelope,
      sync: initialSyncRecord('pending'),
    });

    const result = await commitNewRun(db, envelope);
    expect(result).toEqual({ ok: false, reason: 'run_id_collision' });

    // No comparison-identity rows were left behind by the aborted commit attempt.
    const compRows = await db.getAllFromIndex(
      STORE.comparisonIdentity,
      COMPARISON_BY_RUN_ID,
      envelope.run_id,
    );
    expect(compRows).toEqual([]);
    // Exactly one run record exists (the pre-seeded one) — the transaction did not partially apply.
    expect(await getAllRuns(db)).toHaveLength(1);
  });
});

describe('applyTransition', () => {
  it('reads, transitions, and writes back the sync record for an existing run', async () => {
    const envelope = await buildTestEnvelope();
    await commitNewRun(db, envelope);

    const started = await applyTransition(db, envelope.run_id, { type: 'START_SYNC' });
    expect(started).toEqual({ ok: true, state: 'syncing' });

    const succeeded = await applyTransition(db, envelope.run_id, { type: 'SYNC_SUCCEEDED' });
    expect(succeeded).toEqual({ ok: true, state: 'synced' });

    const stored = await getRun(db, envelope.run_id);
    expect(stored?.sync.state).toBe('synced');
    expect(stored?.sync.diagnostics.attempt_count).toBe(1);
  });

  it('reports run_not_found for an unknown run_id, without throwing', async () => {
    const result = await applyTransition(db, 'does-not-exist', { type: 'START_SYNC' });
    expect(result).toEqual({ ok: false, reason: 'run_not_found' });
  });

  it('rejects a disallowed transition and leaves the stored state unchanged', async () => {
    const envelope = await buildTestEnvelope();
    await commitNewRun(db, envelope);

    const result = await applyTransition(db, envelope.run_id, { type: 'SYNC_SUCCEEDED' });
    expect(result).toEqual({
      ok: false,
      reason: 'invalid_transition',
      from: 'pending',
      event: 'SYNC_SUCCEEDED',
    });
    const stored = await getRun(db, envelope.run_id);
    expect(stored?.sync.state).toBe('pending');
  });
});

describe('rebuildComparisonIndexForRun', () => {
  it('rebuilding replaces existing rows rather than duplicating them', async () => {
    const envelope = await buildTestEnvelope();
    await commitNewRun(db, envelope);
    const before = await db.getAllFromIndex(
      STORE.comparisonIdentity,
      COMPARISON_BY_RUN_ID,
      envelope.run_id,
    );

    await rebuildComparisonIndexForRun(db, envelope.run_id);
    await rebuildComparisonIndexForRun(db, envelope.run_id);

    const after = await db.getAllFromIndex(
      STORE.comparisonIdentity,
      COMPARISON_BY_RUN_ID,
      envelope.run_id,
    );
    expect(after).toHaveLength(before.length);
  });

  it('is a no-op for an unknown run_id', async () => {
    await expect(rebuildComparisonIndexForRun(db, 'does-not-exist')).resolves.toBeUndefined();
  });
});
