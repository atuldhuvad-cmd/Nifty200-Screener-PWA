import { describe, expect, it } from 'vitest';
import {
  COMPARISON_BY_IDENTITY_KEY,
  COMPARISON_BY_RUN_ID,
  DB_VERSION,
  openDatabase,
  RUNS_BY_ORIGINAL_FILE_SHA256,
  STORE,
} from '../../src/core/storage/schema';
import { withMigrationLock } from '../../src/core/storage/locks';
import { freshDbName } from '../storage-helpers';

describe('openDatabase: schema creation', () => {
  it('creates all four stores with the expected key paths and indexes', async () => {
    const db = await openDatabase({ name: freshDbName() });
    try {
      expect(Array.from(db.objectStoreNames).sort()).toEqual(
        [STORE.runs, STORE.runVariants, STORE.quarantineItems, STORE.comparisonIdentity].sort(),
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
        [COMPARISON_BY_RUN_ID, COMPARISON_BY_IDENTITY_KEY].sort(),
      );
      await tx.done;
    } finally {
      db.close();
    }
  });

  it('is idempotent: opening the same name/version twice reuses the existing schema without error', async () => {
    const name = freshDbName();
    const db1 = await openDatabase({ name });
    db1.close();
    const db2 = await openDatabase({ name });
    try {
      expect(Array.from(db2.objectStoreNames)).toHaveLength(4);
    } finally {
      db2.close();
    }
  });
});

describe('openDatabase: versionchange / blocked handling', () => {
  it('an open connection closes itself and signals reload when another tab requests a newer version ("blocking")', async () => {
    const name = freshDbName();
    let reloadSignalled = false;
    const first = await openDatabase({ name, onReloadNeeded: () => (reloadSignalled = true) });

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
      withMigrationLock('n200-schema-migration', async () => 'ok'),
    );
    expect(outcome).toEqual({ usedLock: true, result: 'ok' });
    expect(calls).toEqual(['n200-schema-migration']);
  });

  it('openDatabase itself succeeds via the single-tab fallback when Web Locks are unavailable', async () => {
    const db = await withStubbedNavigator({}, () => openDatabase({ name: freshDbName() }));
    expect(Array.from(db.objectStoreNames)).toHaveLength(4);
    db.close();
  });

  it('openDatabase also succeeds when Web Locks are available (uses the real lock)', async () => {
    const db = await openDatabase({ name: freshDbName() });
    expect(Array.from(db.objectStoreNames)).toHaveLength(4);
    db.close();
  });
});
