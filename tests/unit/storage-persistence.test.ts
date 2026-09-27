import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { countAtRiskRuns, requestPersistentStorage } from '../../src/core/storage/persistence';
import { applyTransition, commitNewRun } from '../../src/core/storage/runs';
import { openDatabase, type N200Database } from '../../src/core/storage/schema';
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
