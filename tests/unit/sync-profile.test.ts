import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildBackupFile } from '../../src/core/backup/manifest';
import {
  ensureDriveFileId,
  replaceDriveFileId,
  setDriveMetadata,
} from '../../src/core/storage/driveMetadata';
import { commitNewRun, getRun } from '../../src/core/storage/runs';
import { openDatabase, STORE, type N200Database } from '../../src/core/storage/schema';
import {
  acquireSyncLease,
  bindPermission,
  ensureSyncProfile,
  getSyncProfile,
  releaseSyncLease,
  renewSyncLease,
  updateSyncProfile,
} from '../../src/core/storage/syncProfile';
import { buildTestEnvelope, freshDbName } from '../storage-helpers';

let db: N200Database;
beforeEach(async () => {
  ({ db } = await openDatabase({ name: freshDbName() }));
});
afterEach(() => {
  db.close();
});

const RUN = '11111111-1111-4111-8111-111111111111';

describe('sync profile and account binding', () => {
  it('starts unbound with an explicit, minimal shape (no email, no token)', async () => {
    const profile = await ensureSyncProfile(db);
    expect(profile).toMatchObject({
      profile_id: 'default',
      bound_permission_id: null,
      active_folder_id: null,
      known_folder_ids: [],
      pending_folder_id: null,
      lease: null,
    });
    expect(Object.keys(profile).sort()).toEqual(
      [
        'active_folder_id',
        'bound_permission_id',
        'created_at',
        'known_folder_ids',
        'lease',
        'pending_folder_id',
        'profile_id',
        'updated_at',
      ].sort(),
    );
  });

  it('binds the first opaque permissionId, accepts the same one, and blocks a different one without changing the profile', async () => {
    expect(await bindPermission(db, 'perm-A')).toEqual({ status: 'bound' });
    expect(await bindPermission(db, 'perm-A')).toEqual({ status: 'verified' });
    const before = await getSyncProfile(db);
    expect(await bindPermission(db, 'perm-B')).toEqual({ status: 'mismatch' });
    expect(await getSyncProfile(db)).toEqual(before);
    expect((await getSyncProfile(db))?.bound_permission_id).toBe('perm-A');
  });

  it('concurrent first binds with different accounts bind exactly one', async () => {
    const results = await Promise.all([
      bindPermission(db, 'perm-A'),
      bindPermission(db, 'perm-B'),
      bindPermission(db, 'perm-C'),
    ]);
    expect(results.filter((r) => r.status === 'bound')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'mismatch')).toHaveLength(2);
  });

  it('updateSyncProfile applies a transactional mutation', async () => {
    await updateSyncProfile(db, (p) => ({ ...p, known_folder_ids: ['f1', 'f2'] }));
    expect((await getSyncProfile(db))?.known_folder_ids).toEqual(['f1', 'f2']);
  });
});

describe('single-leader IndexedDB lease (no nested Web Locks)', () => {
  it('grants one holder at a time and reports who holds it', async () => {
    expect(await acquireSyncLease(db, { holderId: 'A', nowMs: 1000, ttlMs: 5000 })).toEqual({
      ok: true,
    });
    expect(await acquireSyncLease(db, { holderId: 'B', nowMs: 2000, ttlMs: 5000 })).toEqual({
      ok: false,
      heldBy: 'A',
      expiresAtMs: 6000,
    });
    // The same holder may re-acquire (idempotent).
    expect(await acquireSyncLease(db, { holderId: 'A', nowMs: 2500, ttlMs: 5000 })).toEqual({
      ok: true,
    });
  });

  it('lets a new holder take over an expired lease (a crashed leader never blocks sync forever)', async () => {
    await acquireSyncLease(db, { holderId: 'A', nowMs: 1000, ttlMs: 5000 });
    expect(await acquireSyncLease(db, { holderId: 'B', nowMs: 6001, ttlMs: 5000 })).toEqual({
      ok: true,
    });
    expect((await getSyncProfile(db))?.lease?.holder_id).toBe('B');
  });

  it('renew extends only the holder; release frees only the holder', async () => {
    await acquireSyncLease(db, { holderId: 'A', nowMs: 1000, ttlMs: 5000 });
    expect(await renewSyncLease(db, { holderId: 'B', nowMs: 1500, ttlMs: 5000 })).toBe(false);
    expect(await renewSyncLease(db, { holderId: 'A', nowMs: 1500, ttlMs: 9000 })).toBe(true);
    expect((await getSyncProfile(db))?.lease?.expires_at_ms).toBe(10_500);
    await releaseSyncLease(db, 'B');
    expect((await getSyncProfile(db))?.lease?.holder_id).toBe('A');
    await releaseSyncLease(db, 'A');
    expect((await getSyncProfile(db))?.lease).toBeNull();
  });

  it('concurrent acquisitions by many contenders grant exactly one', async () => {
    const results = await Promise.all(
      ['A', 'B', 'C', 'D', 'E'].map((holderId) =>
        acquireSyncLease(db, { holderId, nowMs: 1000, ttlMs: 5000 }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });
});

describe('Drive metadata on runs', () => {
  it('persists a pre-generated file ID before returning it, and reuses it thereafter', async () => {
    await commitNewRun(db, await buildTestEnvelope({ runId: RUN }));
    let generated = 0;
    const generate = (): Promise<string> => {
      generated += 1;
      return Promise.resolve(`pre-${String(generated)}`);
    };
    const first = await ensureDriveFileId(db, RUN, generate);
    // Already durable the moment it is returned:
    expect((await getRun(db, RUN))?.sync.drive?.file_id).toBe(first);
    expect(await ensureDriveFileId(db, RUN, generate)).toBe(first);
    expect(generated).toBe(1);
  });

  it('two concurrent callers end up with one shared ID', async () => {
    await commitNewRun(db, await buildTestEnvelope({ runId: RUN }));
    const [a, b] = await Promise.all([
      ensureDriveFileId(db, RUN, () => Promise.resolve('id-a')),
      ensureDriveFileId(db, RUN, () => Promise.resolve('id-b')),
    ]);
    expect(a).toBe(b);
    expect((await getRun(db, RUN))?.sync.drive?.file_id).toBe(a);
  });

  it('metadata writes never change sync state or diagnostics (state moves only via transition)', async () => {
    await commitNewRun(db, await buildTestEnvelope({ runId: RUN }));
    const before = (await getRun(db, RUN))?.sync;
    await ensureDriveFileId(db, RUN, () => Promise.resolve('file-1'));
    expect(
      await setDriveMetadata(db, RUN, { version: '3', md5_checksum: 'abc', folder_id: 'fold' }),
    ).toBe(true);
    const after = (await getRun(db, RUN))?.sync;
    expect(after?.state).toBe(before?.state);
    expect(after?.diagnostics).toEqual(before?.diagnostics);
    expect(after?.drive).toMatchObject({ file_id: 'file-1', version: '3', md5_checksum: 'abc' });
    expect(await setDriveMetadata(db, 'no-such-run', { version: '1' })).toBe(false);
  });

  it('replaceDriveFileId records a new identity and clears the stale version and checksum', async () => {
    await commitNewRun(db, await buildTestEnvelope({ runId: RUN }));
    await ensureDriveFileId(db, RUN, () => Promise.resolve('old-id'));
    await setDriveMetadata(db, RUN, { version: '9', md5_checksum: 'old' });
    await replaceDriveFileId(db, RUN, 'new-id');
    expect((await getRun(db, RUN))?.sync.drive).toMatchObject({
      file_id: 'new-id',
      version: null,
      md5_checksum: null,
    });
  });

  it('backup export never includes Drive metadata (device-specific)', async () => {
    await commitNewRun(db, await buildTestEnvelope({ runId: RUN }));
    await ensureDriveFileId(db, RUN, () => Promise.resolve('secret-looking-drive-id'));
    const record = await getRun(db, RUN);
    if (!record) throw new Error('missing run');
    const json = JSON.stringify(buildBackupFile([record]));
    expect(json).not.toContain('secret-looking-drive-id');
    expect(json).not.toContain('"drive"');
    expect(await db.getAll(STORE.syncProfile)).toEqual([]);
  });
});
