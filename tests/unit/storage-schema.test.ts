import { describe, expect, it } from 'vitest';
import {
  COMPARISON_BY_IDENTITY_KEY,
  COMPARISON_BY_NORMALIZED_NSE_CODE,
  COMPARISON_BY_RUN_ID,
  DB_VERSION,
  openDatabase,
  RUNS_BY_ORIGINAL_FILE_SHA256,
  STORE,
} from '../../src/core/storage/schema';
import { withMigrationLock } from '../../src/core/storage/locks';
import { freshDbName } from '../storage-helpers';

describe('openDatabase: schema creation', () => {
  it('creates all five stores with the expected key paths and indexes', async () => {
    const { db } = await openDatabase({ name: freshDbName() });
    try {
      expect(Array.from(db.objectStoreNames).sort()).toEqual(
        [
          STORE.runs,
          STORE.runVariants,
          STORE.quarantineItems,
          STORE.comparisonIdentity,
          STORE.syncProfile,
        ].sort(),
      );
      expect(db.version).toBe(DB_VERSION);

      const tx = db.transaction(
        [STORE.runs, STORE.runVariants, STORE.quarantineItems, STORE.comparisonIdentity],
        'readonly',
      );
      expect(tx.objectStore(STORE.runs).keyPath).toBe('run_id');
      expect(tx.objectStore(STORE.runs).autoIncrement).toBe(false);
      expect(Array.from(tx.objectStore(STORE.runs).indexNames)).toEqual([
        RUNS_BY_ORIGINAL_FILE_SHA256,
      ]);

      expect(tx.objectStore(STORE.runVariants).keyPath).toEqual(['run_id', 'envelope_sha256']);

      expect(tx.objectStore(STORE.quarantineItems).keyPath).toBe('quarantine_id');

      expect(tx.objectStore(STORE.comparisonIdentity).keyPath).toBe('id');
      expect(tx.objectStore(STORE.comparisonIdentity).autoIncrement).toBe(true);
      expect(Array.from(tx.objectStore(STORE.comparisonIdentity).indexNames).sort()).toEqual(
        [
          COMPARISON_BY_RUN_ID,
          COMPARISON_BY_IDENTITY_KEY,
          COMPARISON_BY_NORMALIZED_NSE_CODE,
        ].sort(),
      );
      await tx.done;
    } finally {
      db.close();
    }
  });

  it('is idempotent: opening the same name/version twice reuses the existing schema without error', async () => {
    const name = freshDbName();
    const { db: db1 } = await openDatabase({ name });
    db1.close();
    const { db: db2 } = await openDatabase({ name });
    try {
      expect(Array.from(db2.objectStoreNames)).toHaveLength(5);
    } finally {
      db2.close();
    }
  });
});

describe('openDatabase: versionchange / blocked handling', () => {
  it('an open connection closes itself and signals reload when another tab requests a newer version ("blocking")', async () => {
    const name = freshDbName();
    let reloadSignalled = false;
    const { db: first } = await openDatabase({
      name,
      onReloadNeeded: () => (reloadSignalled = true),
    });

    // Simulate "another tab" opening a newer version while `first` is still open.
    const { openDB } = await import('idb');
    const second = await openDB(name, DB_VERSION + 1, {
      upgrade(db) {
        // Minimal no-op upgrade; the point is only to trigger `blocking` on `first`.
        void db;
      },
    });

    // idb's `blocking` callback fires asynchronously; give it a tick.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(reloadSignalled).toBe(true);
    // The old connection must actually be closed — a request against it should fail/hang;
    // we instead assert indirectly via db.close() not throwing (idempotent) and the new
    // connection being fully usable.
    expect(() => first.close()).not.toThrow();
    expect(second.version).toBe(DB_VERSION + 1);
    second.close();
  });

  it('a blocked open attempt reports onBlocked (an older connection, not using our blocking-aware wrapper, is still open elsewhere)', async () => {
    const name = freshDbName();
    const { openDB } = await import('idb');
    // Deliberately opened via raw `openDB` with no `blocking` handler — e.g. a stale connection
    // from before a reload-prompt flow existed. A connection opened through our own
    // `openDatabase` (which always installs `blocking`) closes itself promptly on
    // versionchange, so `blocked` correctly never needs to fire for it — see the "blocking"
    // test above. `onBlocked` exists for exactly this other case.
    const older = await openDB(name, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore(STORE.runs, { keyPath: 'run_id' });
        db.createObjectStore(STORE.runVariants, { keyPath: ['run_id', 'envelope_sha256'] });
        db.createObjectStore(STORE.quarantineItems, { keyPath: 'quarantine_id' });
        db.createObjectStore(STORE.comparisonIdentity, { keyPath: 'id', autoIncrement: true });
      },
    });

    let blockedCalled = false;
    const upgradePromise = openDB(name, DB_VERSION + 1, {
      blocked() {
        blockedCalled = true;
        older.close();
      },
    });

    const newer = await upgradePromise;
    expect(blockedCalled).toBe(true);
    newer.close();
  });
});

// This Node runtime happens to implement real navigator.locks (a recent Node addition), so
// "Web Locks unavailable" cannot be asserted from the ambient environment — both the
// available and unavailable cases are exercised explicitly by stubbing `globalThis.navigator`.
async function withStubbedNavigator<T>(value: unknown, fn: () => Promise<T>): Promise<T> {
  const original: unknown = (globalThis as { navigator?: unknown }).navigator;
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true });
  try {
    return await fn();
  } finally {
    Object.defineProperty(globalThis, 'navigator', { value: original, configurable: true });
  }
}

describe('withMigrationLock: single-tab fallback when Web Locks are unavailable', () => {
  it('runs the function directly and reports usedLock: false when navigator.locks is absent', async () => {
    const outcome = await withStubbedNavigator({}, () =>
      withMigrationLock('test-lock', async () => 42),
    );
    expect(outcome).toEqual({ usedLock: false, result: 42 });
  });

  it('also falls back when navigator itself is undefined', async () => {
    const outcome = await withStubbedNavigator(undefined, () =>
      withMigrationLock('test-lock', async () => 42),
    );
    expect(outcome).toEqual({ usedLock: false, result: 42 });
  });

  it("propagates the wrapped function's result and errors correctly in the fallback path", async () => {
    await expect(
      withStubbedNavigator({}, () =>
        withMigrationLock('test-lock', async () => {
          throw new Error('boom');
        }),
      ),
    ).rejects.toThrow('boom');
  });

  it('uses navigator.locks.request when Web Locks are available (simulated)', async () => {
    const calls: string[] = [];
    const fakeLocks = {
      request: async <T>(name: string, cb: () => Promise<T> | T) => {
        calls.push(name);
        return cb();
      },
    };
    const outcome = await withStubbedNavigator({ locks: fakeLocks }, () =>
      withMigrationLock('n200-activity', async () => 'ok'),
    );
    expect(outcome).toEqual({ usedLock: true, result: 'ok' });
    expect(calls).toEqual(['n200-activity']);
  });
});

describe('Bugbot P2-1: openDatabase surfaces usedLock and a single-active-tab warning', () => {
  it('reports usedLock: true, singleTabWarning: false, and never fires onSingleTabFallback when Web Locks are available', async () => {
    let fallbackFired = false;
    const { db, usedLock, singleTabWarning } = await openDatabase({
      name: freshDbName(),
      onSingleTabFallback: () => (fallbackFired = true),
    });
    try {
      expect(usedLock).toBe(true);
      expect(singleTabWarning).toBe(false);
      expect(fallbackFired).toBe(false);
    } finally {
      db.close();
    }
  });

  it('reports usedLock: false, singleTabWarning: true, and fires onSingleTabFallback when Web Locks are unavailable — never silently (re-opening an already-current-version database, which needs no migration; see security review P2-A for the fresh-install/migration case, which now fails closed instead)', async () => {
    const name = freshDbName();
    const { db: first } = await openDatabase({ name });
    first.close();

    let fallbackFired = false;
    const { db, usedLock, singleTabWarning } = await withStubbedNavigator({}, () =>
      openDatabase({ name, onSingleTabFallback: () => (fallbackFired = true) }),
    );
    try {
      expect(usedLock).toBe(false);
      expect(singleTabWarning).toBe(true);
      expect(fallbackFired).toBe(true);
    } finally {
      db.close();
    }
  });

  it('the single-tab fallback still opens a fully usable already-current-version database — only the warning/lock status differs', async () => {
    const name = freshDbName();
    const { db: first } = await openDatabase({ name });
    first.close();

    const { db, singleTabWarning } = await withStubbedNavigator({}, () => openDatabase({ name }));
    try {
      expect(singleTabWarning).toBe(true);
      expect(Array.from(db.objectStoreNames)).toHaveLength(5);
    } finally {
      db.close();
    }
  });
});

describe('Security review P1-B: oldVersion-aware migration from a v1-shaped database', () => {
  it('upgrading a v1 database creates the new index, rebuilds comparison rows with normalized fields, and conservatively initializes has_verified_remote_copy', async () => {
    const name = freshDbName();
    const { openDB } = await import('idb');

    // Build a genuinely v1-shaped database by hand: the ORIGINAL Step 3 schema, before the
    // Bugbot/security fixes — comparison_identity has only the two original indexes, its rows
    // lack normalized_isin/normalized_nse_code, and sync diagnostics lack has_verified_remote_copy.
    const v1 = await openDB(name, 1, {
      upgrade(db) {
        const runs = db.createObjectStore(STORE.runs, { keyPath: 'run_id' });
        runs.createIndex(RUNS_BY_ORIGINAL_FILE_SHA256, 'envelope.original_file_sha256');
        db.createObjectStore(STORE.runVariants, { keyPath: ['run_id', 'envelope_sha256'] });
        db.createObjectStore(STORE.quarantineItems, { keyPath: 'quarantine_id' });
        const comparison = db.createObjectStore(STORE.comparisonIdentity, {
          keyPath: 'id',
          autoIncrement: true,
        });
        comparison.createIndex(COMPARISON_BY_RUN_ID, 'run_id');
        comparison.createIndex(COMPARISON_BY_IDENTITY_KEY, 'identity_key');
      },
    });

    const { buildTestEnvelope } = await import('../storage-helpers');
    const syncedEnvelope = await buildTestEnvelope({
      runId: '11111111-1111-4111-8111-111111111111',
    });
    const errorEnvelope = await buildTestEnvelope({
      runId: '22222222-2222-4222-8222-222222222222',
    });

    // A v1-shaped sync record: no has_verified_remote_copy field at all.
    await v1.add(STORE.runs, {
      run_id: syncedEnvelope.run_id,
      envelope: syncedEnvelope,
      sync: {
        state: 'synced',
        prior_stable_state: null,
        diagnostics: {
          last_attempt_at: '2026-09-01T00:00:00.000Z',
          last_success_at: '2026-09-01T00:00:00.000Z',
          attempt_count: 1,
          error_code: null,
          retryable: null,
        },
      },
    });
    await v1.add(STORE.runs, {
      run_id: errorEnvelope.run_id,
      envelope: errorEnvelope,
      sync: {
        state: 'error',
        prior_stable_state: null,
        diagnostics: {
          last_attempt_at: '2026-09-01T00:00:00.000Z',
          last_success_at: null,
          attempt_count: 1,
          error_code: 'NETWORK',
          retryable: true,
        },
      },
    });
    // v1-shaped comparison rows: no normalized_isin/normalized_nse_code.
    await v1.add(STORE.comparisonIdentity, {
      run_id: syncedEnvelope.run_id,
      row_index: 0,
      match_method: 'isin',
      identity_key: 'isin:ZZSYNTH00015',
    });
    v1.close();

    // Now open with the real app code, which requests the current (>= 2) DB_VERSION.
    const { db } = await openDatabase({ name });
    try {
      expect(db.version).toBeGreaterThanOrEqual(2);

      // 1. The new index exists.
      const tx = db.transaction(STORE.comparisonIdentity, 'readonly');
      expect(Array.from(tx.store.indexNames)).toEqual(
        expect.arrayContaining([COMPARISON_BY_NORMALIZED_NSE_CODE]),
      );
      await tx.done;

      // 2. Comparison rows were rebuilt from the validated envelope — normalized fields are
      // now populated, not left as stale/absent v1-shaped data.
      const rows = await db.getAllFromIndex(
        STORE.comparisonIdentity,
        COMPARISON_BY_RUN_ID,
        syncedEnvelope.run_id,
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.normalized_isin === null || typeof row.normalized_isin === 'string').toBe(true);
        expect(
          row.normalized_nse_code === null || typeof row.normalized_nse_code === 'string',
        ).toBe(true);
      }
      const isinRow = rows.find((r) => r.match_method === 'isin');
      expect(isinRow?.normalized_isin).toBe('ZZSYNTH00015');

      // 3. has_verified_remote_copy initialized conservatively: true only for the run that was
      // actually `synced` under the old model; false for the `error` run, even though old data
      // alone (e.g. a stale last_attempt_at) can't prove a copy currently exists.
      const syncedRecord = await db.get(STORE.runs, syncedEnvelope.run_id);
      const errorRecord = await db.get(STORE.runs, errorEnvelope.run_id);
      expect(syncedRecord?.sync.diagnostics.has_verified_remote_copy).toBe(true);
      expect(errorRecord?.sync.diagnostics.has_verified_remote_copy).toBe(false);
    } finally {
      db.close();
    }
  });

  it('a fresh (brand-new) database skips straight to the full current schema without a migration step', async () => {
    const { db } = await openDatabase({ name: freshDbName() });
    try {
      const tx = db.transaction(STORE.comparisonIdentity, 'readonly');
      expect(Array.from(tx.store.indexNames).sort()).toEqual(
        [
          COMPARISON_BY_RUN_ID,
          COMPARISON_BY_IDENTITY_KEY,
          COMPARISON_BY_NORMALIZED_NSE_CODE,
        ].sort(),
      );
      await tx.done;
    } finally {
      db.close();
    }
  });
});

describe('Security review P2-A: fail closed on Web Locks unavailability for guarded migrations', () => {
  it('rejects a fresh-install open (a migration is needed) with a stable error code when Web Locks are unavailable, instead of executing it', async () => {
    const name = freshDbName();
    await expect(withStubbedNavigator({}, () => openDatabase({ name }))).rejects.toMatchObject({
      code: 'WEB_LOCKS_UNAVAILABLE',
    });
  });

  it('two concurrent callers in fallback mode both reject, and neither leaves a partially created database', async () => {
    const name = freshDbName();
    // One shared stub scope for both concurrent calls — two overlapping
    // withStubbedNavigator calls would race on restoring the same global property.
    const [a, b] = await withStubbedNavigator({}, () =>
      Promise.allSettled([openDatabase({ name }), openDatabase({ name })]),
    );
    expect(a.status).toBe('rejected');
    expect(b.status).toBe('rejected');
    if (a.status === 'rejected') expect(a.reason).toMatchObject({ code: 'WEB_LOCKS_UNAVAILABLE' });
    if (b.status === 'rejected') expect(b.reason).toMatchObject({ code: 'WEB_LOCKS_UNAVAILABLE' });

    // Confirm no partial database was left behind: opening for real (locks available)
    // afterward still goes through the normal fresh-install path, not a stale/broken one.
    const { db } = await openDatabase({ name });
    try {
      expect(Array.from(db.objectStoreNames)).toHaveLength(5);
    } finally {
      db.close();
    }
  });

  it('reads on an already-current-version database remain available without Web Locks', async () => {
    const name = freshDbName();
    const { db: first } = await openDatabase({ name }); // locks available: creates it normally
    first.close();

    // Re-opening the SAME (already current-version) database needs no migration, so it must
    // succeed even with Web Locks unavailable.
    const { db, usedLock, singleTabWarning } = await withStubbedNavigator({}, () =>
      openDatabase({ name }),
    );
    try {
      expect(usedLock).toBe(false);
      expect(singleTabWarning).toBe(true);
      expect(Array.from(db.objectStoreNames)).toHaveLength(5);
      await expect(db.getAll(STORE.runs)).resolves.toEqual([]);
    } finally {
      db.close();
    }
  });
});
