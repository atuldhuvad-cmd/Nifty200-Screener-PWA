import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACTIVITY_LOCK_NAME, withActivity, withMigrationLock } from '../../src/core/storage/locks';
import { openDatabase } from '../../src/core/storage/schema';
import { freshDbName } from '../storage-helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

interface Call {
  name: string;
  mode: string | undefined;
}

function stubLocks(calls: Call[]): void {
  vi.stubGlobal('navigator', {
    locks: {
      request: <T>(name: string, a: unknown, b?: unknown): Promise<T> => {
        const options = typeof a === 'function' ? undefined : (a as { mode?: string });
        const callback = (typeof a === 'function' ? a : b) as () => Promise<T> | T;
        calls.push({ name, mode: options?.mode });
        return Promise.resolve(callback());
      },
    },
  });
}

describe('activity lock', () => {
  it('has one stable name shared by imports, restores, migrations and the updater', () => {
    expect(ACTIVITY_LOCK_NAME).toBe('n200-activity');
  });

  it('withActivity holds the lock in shared mode for the whole operation', async () => {
    const calls: Call[] = [];
    stubLocks(calls);
    const result = await withActivity(() => Promise.resolve('done'));
    expect(result).toBe('done');
    expect(calls).toEqual([{ name: ACTIVITY_LOCK_NAME, mode: 'shared' }]);
  });

  it('withActivity still runs the operation when Web Locks are unavailable (imports stay allowed)', async () => {
    vi.stubGlobal('navigator', {});
    expect(await withActivity(() => Promise.resolve('ran'))).toBe('ran');
  });

  it('a schema migration takes the same activity lock, not in shared mode', async () => {
    const calls: Call[] = [];
    stubLocks(calls);
    const { db } = await openDatabase({ name: freshDbName() });
    db.close();
    expect(calls.map((c) => c.name)).toEqual([ACTIVITY_LOCK_NAME]);
    expect(calls[0]?.mode).not.toBe('shared');
  });

  it('opening an already-current database takes no lock, so a held activity lock cannot block it', async () => {
    const name = freshDbName();
    const calls: Call[] = [];
    stubLocks(calls);
    (await openDatabase({ name })).db.close(); // fresh install: the migration takes the lock
    expect(calls).toHaveLength(1);

    // Any later request for the activity lock would now hang forever: another tab holds it
    // (a long restore). A plain open must not even ask for it.
    vi.stubGlobal('navigator', {
      locks: {
        request: () => {
          calls.push({ name: ACTIVITY_LOCK_NAME, mode: 'requested-while-held' });
          return new Promise<never>(() => undefined);
        },
      },
    });
    const reopened = await openDatabase({ name });
    reopened.db.close();
    expect(calls).toHaveLength(1);
    expect(reopened.usedLock).toBe(true);
    expect(reopened.singleTabWarning).toBe(false);
  });

  it('withMigrationLock is still generic over the lock name', async () => {
    const calls: Call[] = [];
    stubLocks(calls);
    await withMigrationLock('custom', () => Promise.resolve(1));
    expect(calls[0]?.name).toBe('custom');
  });
});
