import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commitBackupImport } from '../../src/core/backup/commit';
import { buildBackupFile } from '../../src/core/backup/manifest';
import { WebLocksUnavailableError } from '../../src/core/storage/locks';
import { openDatabase, STORE, type N200Database } from '../../src/core/storage/schema';
import { initialSyncRecord } from '../../src/core/storage/types';
import { buildTestEnvelope, freshDbName } from '../storage-helpers';

let db: N200Database;

beforeEach(async () => {
  ({ db } = await openDatabase({ name: freshDbName() }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  db.close();
});

async function makeFile() {
  const e = await buildTestEnvelope({ runId: '11111111-1111-4111-8111-111111111111' });
  return buildBackupFile([{ run_id: e.run_id, envelope: e, sync: initialSyncRecord('pending') }]);
}

describe('commitBackupImport Web Lock', () => {
  it('fails closed with a stable code and writes nothing when Web Locks are unavailable', async () => {
    const f = await makeFile();
    vi.stubGlobal('navigator', {});
    await expect(commitBackupImport(db, f)).rejects.toBeInstanceOf(WebLocksUnavailableError);
    await expect(commitBackupImport(db, f)).rejects.toMatchObject({
      code: 'WEB_LOCKS_UNAVAILABLE',
    });
    expect(await db.getAll(STORE.runs)).toHaveLength(0);
    expect(await db.getAll(STORE.quarantineItems)).toHaveLength(0);
  });

  it('runs the whole restore under one exclusive named lock, serializing concurrent restores', async () => {
    const f = await makeFile();
    const names: string[] = [];
    let active = 0;
    let maxActive = 0;
    let chain: Promise<unknown> = Promise.resolve();
    vi.stubGlobal('navigator', {
      locks: {
        request: <T>(name: string, cb: () => Promise<T> | T): Promise<T> => {
          names.push(name);
          const run = chain.then(async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            try {
              return await cb();
            } finally {
              active -= 1;
            }
          });
          chain = run.catch(() => undefined);
          return run;
        },
      },
    });
    const [a, b] = await Promise.all([commitBackupImport(db, f), commitBackupImport(db, f)]);
    expect(names).toEqual(['n200-backup-restore', 'n200-backup-restore']);
    expect(maxActive).toBe(1);
    expect([a[0]?.outcome.kind, b[0]?.outcome.kind].sort()).toEqual([
      'already_present',
      'committed',
    ]);
    expect(await db.getAll(STORE.runs)).toHaveLength(1);
  });
});
