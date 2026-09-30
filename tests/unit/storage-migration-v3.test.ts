import { openDB } from 'idb';
import { describe, expect, it } from 'vitest';
import { countAtRiskRuns } from '../../src/core/storage/persistence';
import { applyTransition, commitNewRun } from '../../src/core/storage/runs';
import {
  COMPARISON_BY_IDENTITY_KEY,
  COMPARISON_BY_NORMALIZED_NSE_CODE,
  COMPARISON_BY_RUN_ID,
  DB_VERSION,
  openDatabase,
  RUNS_BY_ORIGINAL_FILE_SHA256,
  STORE,
  type N200Database,
} from '../../src/core/storage/schema';
import { buildTestEnvelope, freshDbName } from '../storage-helpers';

/** A genuinely v2-shaped database, built by hand exactly as the shipped v2 schema created it. */
async function buildV2Database(name: string): Promise<N200Database> {
  const raw = await openDB(name, 2, {
    upgrade(db) {
      const runs = db.createObjectStore('runs', { keyPath: 'run_id' });
      runs.createIndex(RUNS_BY_ORIGINAL_FILE_SHA256, 'envelope.original_file_sha256');
      db.createObjectStore('run_variants', { keyPath: ['run_id', 'envelope_sha256'] });
      db.createObjectStore('quarantine_items', { keyPath: 'quarantine_id' });
      const comparison = db.createObjectStore('comparison_identity', {
        keyPath: 'id',
        autoIncrement: true,
      });
      comparison.createIndex(COMPARISON_BY_RUN_ID, 'run_id');
      comparison.createIndex(COMPARISON_BY_IDENTITY_KEY, 'identity_key');
      comparison.createIndex(COMPARISON_BY_NORMALIZED_NSE_CODE, 'normalized_nse_code');
    },
  });
  return raw as unknown as N200Database;
}

async function dumpStores(db: N200Database): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const name of [
    STORE.runs,
    STORE.runVariants,
    STORE.quarantineItems,
    STORE.comparisonIdentity,
  ]) {
    out[name] = await db.getAll(name);
  }
  return out;
}

describe('DB_VERSION 2 -> 3 migration (sync_profile store, Drive metadata on runs)', () => {
  it('is version 3', () => {
    expect(DB_VERSION).toBe(3);
  });

  it('upgrades a hand-built v2 database, preserving every run, index row and at-risk result', async () => {
    const name = freshDbName();
    const v2 = await buildV2Database(name);
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ] as const;
    await commitNewRun(v2, await buildTestEnvelope({ runId: ids[0] }));
    await commitNewRun(
      v2,
      await buildTestEnvelope({ runId: ids[1], fixture: 'SYNTHETIC_non_ascii_names.csv' }),
    );
    await commitNewRun(
      v2,
      await buildTestEnvelope({ runId: ids[2], fixture: 'SYNTHETIC_5b_symbol_history_run1.csv' }),
    );
    await applyTransition(v2, ids[0], { type: 'START_SYNC' });
    await applyTransition(v2, ids[0], { type: 'SYNC_SUCCEEDED' });
    await applyTransition(v2, ids[1], { type: 'START_SYNC' });
    await applyTransition(v2, ids[1], { type: 'SYNC_FAILED', errorCode: 'X', retryable: true });

    const before = await dumpStores(v2);
    const atRiskBefore = await countAtRiskRuns(v2);
    const indexNamesBefore = Array.from(
      v2.transaction(STORE.comparisonIdentity).objectStore(STORE.comparisonIdentity).indexNames,
    ).sort();
    expect(v2.version).toBe(2);
    expect(Array.from(v2.objectStoreNames)).not.toContain('sync_profile');
    v2.close();

    const { db } = await openDatabase({ name });
    try {
      expect(db.version).toBe(3);
      expect(Array.from(db.objectStoreNames).sort()).toEqual(
        [
          STORE.runs,
          STORE.runVariants,
          STORE.quarantineItems,
          STORE.comparisonIdentity,
          STORE.syncProfile,
        ].sort(),
      );
      const profileStore = db.transaction(STORE.syncProfile).objectStore(STORE.syncProfile);
      expect(profileStore.keyPath).toBe('profile_id');
      expect(await profileStore.getAll()).toEqual([]);

      // Every existing record is byte-for-byte what it was: nothing is rewritten by the upgrade.
      expect(await dumpStores(db)).toEqual(before);
      expect(
        Array.from(
          db.transaction(STORE.comparisonIdentity).objectStore(STORE.comparisonIdentity).indexNames,
        ).sort(),
      ).toEqual(indexNamesBefore);
      expect(Array.from(db.transaction(STORE.runs).objectStore(STORE.runs).indexNames)).toEqual([
        RUNS_BY_ORIGINAL_FILE_SHA256,
      ]);

      // The at-risk logic is unchanged, and no run gained Drive metadata.
      expect(await countAtRiskRuns(db)).toBe(atRiskBefore);
      for (const run of await db.getAll(STORE.runs)) expect(run.sync.drive).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it('a fresh install creates the sync_profile store directly, and reopening is a no-op', async () => {
    const name = freshDbName();
    const first = await openDatabase({ name });
    expect(first.db.version).toBe(3);
    expect(Array.from(first.db.objectStoreNames)).toContain(STORE.syncProfile);
    first.db.close();
    const second = await openDatabase({ name });
    expect(Array.from(second.db.objectStoreNames)).toHaveLength(5);
    second.db.close();
  });
});
