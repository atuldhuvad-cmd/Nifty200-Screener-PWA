import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { countAtRiskRuns, requestPersistentStorage } from '../../src/core/storage/persistence';
import { applyTransition, commitNewRun } from '../../src/core/storage/runs';
import { openDatabase, STORE, type N200Database } from '../../src/core/storage/schema';
import { buildTestEnvelope, freshDbName } from '../storage-helpers';

let db: N200Database;

beforeEach(async () => {
  ({ db } = await openDatabase({ name: freshDbName() }));
});

afterEach(() => {
  db.close();
});

describe('requestPersistentStorage', () => {
  it('reports supported: false when navigator.storage.persist is unavailable', async () => {
    const original: unknown = (globalThis as { navigator?: unknown }).navigator;
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
    try {
      expect(await requestPersistentStorage()).toEqual({ supported: false });
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: original, configurable: true });
    }
  });

  it('reports the granted result when navigator.storage.persist is available (simulated)', async () => {
    const original: unknown = (globalThis as { navigator?: unknown }).navigator;
    Object.defineProperty(globalThis, 'navigator', {
      value: { storage: { persist: async () => true } },
      configurable: true,
    });
    try {
      expect(await requestPersistentStorage()).toEqual({ supported: true, granted: true });
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: original, configurable: true });
    }
  });

  it('reports granted: false when the browser denies persistence', async () => {
    const original: unknown = (globalThis as { navigator?: unknown }).navigator;
    Object.defineProperty(globalThis, 'navigator', {
      value: { storage: { persist: async () => false } },
      configurable: true,
    });
    try {
      expect(await requestPersistentStorage()).toEqual({ supported: true, granted: false });
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: original, configurable: true });
    }
  });
});

describe('countAtRiskRuns (§9 review item 4: no verified Drive copy right now)', () => {
  it('counts pending, local_only, and remote_missing unconditionally', async () => {
    const pending = await buildTestEnvelope({ runId: '11111111-1111-4111-8111-111111111111' });
    const localOnly = await buildTestEnvelope({ runId: '22222222-2222-4222-8222-222222222222' });
    const remoteMissing = await buildTestEnvelope({
      runId: '33333333-3333-4333-8333-333333333333',
    });
    const synced = await buildTestEnvelope({ runId: '44444444-4444-4444-8444-444444444444' });

    await commitNewRun(db, pending);
    await commitNewRun(db, localOnly);
    await commitNewRun(db, remoteMissing);
    await commitNewRun(db, synced);

    // local_only, reached via remote_missing (a run that previously synced, per the brief).
    await applyTransition(db, localOnly.run_id, { type: 'START_SYNC' });
    await applyTransition(db, localOnly.run_id, { type: 'SYNC_SUCCEEDED' });
    await applyTransition(db, localOnly.run_id, { type: 'REMOTE_MISSING_DETECTED' });
    await applyTransition(db, localOnly.run_id, { type: 'KEEP_LOCAL_ONLY' });

    await applyTransition(db, remoteMissing.run_id, { type: 'START_SYNC' });
    await applyTransition(db, remoteMissing.run_id, { type: 'SYNC_SUCCEEDED' });
    await applyTransition(db, remoteMissing.run_id, { type: 'REMOTE_MISSING_DETECTED' });

    await applyTransition(db, synced.run_id, { type: 'START_SYNC' });
    await applyTransition(db, synced.run_id, { type: 'SYNC_SUCCEEDED' });

    // pending stays pending: 4 runs total, only `synced` is excluded.
    expect(await countAtRiskRuns(db)).toBe(3);
  });

  it('counts an error run only if it has never successfully synced', async () => {
    const neverSynced = await buildTestEnvelope({ runId: '55555555-5555-4555-8555-555555555555' });
    const previouslySynced = await buildTestEnvelope({
      runId: '66666666-6666-4666-8666-666666666666',
    });
    await commitNewRun(db, neverSynced);
    await commitNewRun(db, previouslySynced);

    // neverSynced: pending -> syncing -> error, with no prior success.
    await applyTransition(db, neverSynced.run_id, { type: 'START_SYNC' });
    await applyTransition(db, neverSynced.run_id, {
      type: 'SYNC_FAILED',
      errorCode: 'NETWORK',
      retryable: true,
    });

    // previouslySynced: synced once, then a later re-sync attempt fails.
    await applyTransition(db, previouslySynced.run_id, { type: 'START_SYNC' });
    await applyTransition(db, previouslySynced.run_id, { type: 'SYNC_SUCCEEDED' });
    await applyTransition(db, previouslySynced.run_id, { type: 'START_SYNC' });
    await applyTransition(db, previouslySynced.run_id, {
      type: 'SYNC_FAILED',
      errorCode: 'NETWORK',
      retryable: true,
    });

    expect(await countAtRiskRuns(db)).toBe(1);
  });

  it('excludes synced runs, and is 0 for an empty database', async () => {
    expect(await countAtRiskRuns(db)).toBe(0);
    const synced = await buildTestEnvelope();
    await commitNewRun(db, synced);
    await applyTransition(db, synced.run_id, { type: 'START_SYNC' });
    await applyTransition(db, synced.run_id, { type: 'SYNC_SUCCEEDED' });
    expect(await countAtRiskRuns(db)).toBe(0);
  });
});

describe('Security review P1-A: has_verified_remote_copy is the sole authoritative durability indicator', () => {
  it('counts a run that was synced, then lost its remote copy, then failed to re-sync (error) — last_success_at alone would wrongly exclude it', async () => {
    const envelope = await buildTestEnvelope();
    await commitNewRun(db, envelope);

    // synced (has_verified_remote_copy -> true, last_success_at set)
    await applyTransition(db, envelope.run_id, { type: 'START_SYNC' });
    await applyTransition(db, envelope.run_id, { type: 'SYNC_SUCCEEDED' });
    expect(await countAtRiskRuns(db)).toBe(0);

    // remote lost (has_verified_remote_copy -> false; last_success_at is UNCHANGED, still set)
    await applyTransition(db, envelope.run_id, { type: 'REMOTE_MISSING_DETECTED' });
    expect(await countAtRiskRuns(db)).toBe(1);

    // a re-sync attempt then fails: state becomes `error`, but crucially last_success_at is
    // still non-null from the earlier success — a last_success_at-based check would wrongly
    // report this run as not at risk. has_verified_remote_copy is correctly still false.
    await applyTransition(db, envelope.run_id, { type: 'START_SYNC' });
    await applyTransition(db, envelope.run_id, {
      type: 'SYNC_FAILED',
      errorCode: 'NETWORK',
      retryable: true,
    });
    const record = await db.get(STORE.runs, envelope.run_id);
    expect(record?.sync.diagnostics.last_success_at).not.toBeNull(); // still set from before
    expect(record?.sync.diagnostics.has_verified_remote_copy).toBe(false); // but no longer verified
    expect(await countAtRiskRuns(db)).toBe(1); // still correctly counted as at-risk
  });

  it('counts a conflict run with no verified remote copy (a brand-new run receiving a divergent variant before ever syncing)', async () => {
    const envelope = await buildTestEnvelope();
    await commitNewRun(db, envelope);
    await applyTransition(db, envelope.run_id, { type: 'INGEST_CONFLICT_VARIANT' });
    const record = await db.get(STORE.runs, envelope.run_id);
    expect(record?.sync.state).toBe('conflict');
    expect(record?.sync.diagnostics.has_verified_remote_copy).toBe(false);
    expect(await countAtRiskRuns(db)).toBe(1);
  });

  it('does NOT count a conflict run that had a verified remote copy before the conflict was discovered', async () => {
    // Per current transition() semantics, entering conflict always clears
    // has_verified_remote_copy to false (a divergent remote means this canonical content is not
    // durably matched on Drive), so a previously-synced run in conflict IS still at risk. This
    // test pins that behaviour down explicitly, since it's the subtler of the two conflict cases.
    const envelope = await buildTestEnvelope();
    await commitNewRun(db, envelope);
    await applyTransition(db, envelope.run_id, { type: 'START_SYNC' });
    await applyTransition(db, envelope.run_id, { type: 'SYNC_SUCCEEDED' });
    await applyTransition(db, envelope.run_id, { type: 'INGEST_CONFLICT_VARIANT' });
    const record = await db.get(STORE.runs, envelope.run_id);
    expect(record?.sync.diagnostics.has_verified_remote_copy).toBe(false);
    expect(await countAtRiskRuns(db)).toBe(1);
  });

  it('excludes quarantined and unsupported_schema runs (out of scope for this warning) even though they have no verified remote copy', async () => {
    const quarantined = await buildTestEnvelope({ runId: '77777777-7777-4777-8777-777777777777' });
    await commitNewRun(db, quarantined);
    await applyTransition(db, quarantined.run_id, { type: 'QUARANTINE' });
    expect(await countAtRiskRuns(db)).toBe(0);
  });
});
