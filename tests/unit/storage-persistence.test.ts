import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { countPendingRuns, requestPersistentStorage } from '../../src/core/storage/persistence';
import { applyTransition, commitNewRun } from '../../src/core/storage/runs';
import { openDatabase, type N200Database } from '../../src/core/storage/schema';
import { buildTestEnvelope, freshDbName } from '../storage-helpers';

let db: N200Database;

beforeEach(async () => {
  db = await openDatabase({ name: freshDbName() });
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

describe('countPendingRuns', () => {
  it('counts only runs in the pending state, not synced/error/etc.', async () => {
    const pending1 = await buildTestEnvelope({ runId: '11111111-1111-4111-8111-111111111111' });
    const pending2 = await buildTestEnvelope({ runId: '22222222-2222-4222-8222-222222222222' });
    const toSync = await buildTestEnvelope({ runId: '33333333-3333-4333-8333-333333333333' });

    await commitNewRun(db, pending1);
    await commitNewRun(db, pending2);
    await commitNewRun(db, toSync);
    await applyTransition(db, toSync.run_id, { type: 'START_SYNC' });
    await applyTransition(db, toSync.run_id, { type: 'SYNC_SUCCEEDED' });

    expect(await countPendingRuns(db)).toBe(2);
  });

  it('is 0 for an empty database', async () => {
    expect(await countPendingRuns(db)).toBe(0);
  });
});
