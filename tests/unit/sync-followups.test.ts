import { afterEach, describe, expect, it } from 'vitest';
import { jcsSha256Hex } from '../../src/core/envelope/canonicalHash';
import { getRun } from '../../src/core/storage/runs';
import { STORE } from '../../src/core/storage/schema';
import { acquireSyncLease, getSyncProfile } from '../../src/core/storage/syncProfile';
import { DriveError } from '../../src/core/sync/errors';
import { syncNow } from '../../src/core/sync/engine';
import { discoverAndReconcile } from '../../src/core/sync/reconcile';
import { uploadRun } from '../../src/core/sync/upload';
import { withoutKey } from '../helpers';
import {
  addRun,
  closeAllDatabases,
  makeSyncHarness,
  type SyncHarness,
} from '../support/syncHarness';

afterEach(() => {
  closeAllDatabases();
});

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

const folders = (h: SyncHarness) =>
  [...h.drive.files.values()].filter((f) => f.mimeType === FOLDER_MIME);
const jsonFiles = (h: SyncHarness) =>
  [...h.drive.files.values()].filter((f) => f.mimeType === 'application/json');
const isUploadRequest = (r: { method: string; path: string }): boolean =>
  r.path.startsWith('/upload/');

async function errorOf(promise: Promise<unknown>): Promise<DriveError> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof DriveError) return e;
    throw e;
  }
  throw new Error('expected a DriveError');
}

async function activeFolder(h: SyncHarness): Promise<string | null> {
  return (await getSyncProfile(h.db))?.active_folder_id ?? null;
}

describe('fake Drive fidelity: uploads into an unusable parent are rejected', () => {
  const upload = (h: SyncHarness, parent: string) =>
    h.client.uploadFileResumable({
      id: 'file-under-test',
      name: 'run-x.json',
      parents: [parent],
      appProperties: {},
      bytes: new TextEncoder().encode('{}'),
      sessionKey: 'k',
    });

  it('a missing parent is a 404 not_found', async () => {
    const h = await makeSyncHarness();
    expect((await errorOf(upload(h, 'no-such-folder'))).kind).toBe('not_found');
    expect(h.drive.files.size).toBe(0);
  });

  it('a trashed parent is rejected', async () => {
    const h = await makeSyncHarness();
    const folder = h.drive.addFile({ name: 'f', mimeType: FOLDER_MIME });
    h.drive.trash(folder.id);
    expect((await errorOf(upload(h, folder.id))).kind).toBe('not_found');
  });

  it('an inaccessible parent is rejected as forbidden', async () => {
    const h = await makeSyncHarness();
    const folder = h.drive.addFile({ name: 'f', mimeType: FOLDER_MIME });
    h.drive.inaccessibleIds.add(folder.id);
    expect((await errorOf(upload(h, folder.id))).kind).toBe('forbidden');
  });

  it('a parent that is not a folder is rejected', async () => {
    const h = await makeSyncHarness();
    const notFolder = h.drive.addFile({ name: 'plain.txt' });
    expect((await errorOf(upload(h, notFolder.id))).kind).toBe('bad_request');
  });

  it('a parent deleted after the session began fails the final PUT and creates no file', async () => {
    const h = await makeSyncHarness();
    const folder = h.drive.addFile({ name: 'f', mimeType: FOLDER_MIME });
    h.drive.fail({
      when: (r) => {
        if (isUploadRequest(r) && r.method === 'PUT') h.drive.deletePermanently(folder.id);
        return false;
      },
      times: 99,
    });
    expect((await errorOf(upload(h, folder.id))).kind).toBe('not_found');
    expect(jsonFiles(h)).toHaveLength(0);
  });

  it('a valid parent still works', async () => {
    const h = await makeSyncHarness();
    const folder = h.drive.addFile({ name: 'f', mimeType: FOLDER_MIME });
    const file = await upload(h, folder.id);
    expect(file.id).toBe('file-under-test');
  });
});

describe('active folder recovery', () => {
  async function firstSyncThen(mutate: (h: SyncHarness, folderId: string) => void) {
    const h = await makeSyncHarness({ maxAttempts: 2 });
    await addRun(h.db, A);
    expect((await syncNow(h.ctx)).status).toBe('ok');
    const folderId = (await activeFolder(h)) ?? '';
    expect(folderId).toBeTruthy();
    mutate(h, folderId);
    return { h, folderId };
  }

  it.each([
    ['permanently deleted', (h: SyncHarness, id: string) => h.drive.deletePermanently(id)],
    ['trashed', (h: SyncHarness, id: string) => h.drive.trash(id)],
    ['no longer accessible', (h: SyncHarness, id: string) => h.drive.inaccessibleIds.add(id)],
  ])('an active folder that is %s is detected by discovery and cleared', async (_n, mutate) => {
    const { h, folderId } = await firstSyncThen(mutate);
    const report = await discoverAndReconcile(h.ctx);
    expect(report.activeFolderAction).toBe('cleared');
    const profile = await getSyncProfile(h.db);
    expect(profile?.active_folder_id).toBeNull();
    expect(profile?.known_folder_ids).not.toContain(folderId);
  });

  it('the next sync after a cleared folder creates a fresh tagged folder and uploads into it (no permanent DRIVE_NOT_FOUND)', async () => {
    const { h, folderId } = await firstSyncThen((d, id) => d.drive.deletePermanently(id));
    await addRun(h.db, B, 'SYNTHETIC_non_ascii_names.csv');
    const report = await syncNow(h.ctx);
    expect(report.status).toBe('ok');
    const run = await getRun(h.db, B);
    expect(run?.sync.state).toBe('synced');
    const newFolder = await activeFolder(h);
    expect(newFolder).not.toBeNull();
    expect(newFolder).not.toBe(folderId);
    expect(folders(h).map((f) => f.id)).toEqual([newFolder]);
    expect(run?.sync.drive?.folder_id).toBe(newFolder);
    // A later pass is quiet: nothing to clear, nothing to re-create.
    const again = await syncNow(h.ctx);
    expect(again.status === 'ok' && again.discovery.activeFolderAction).toBe('none');
  });

  it('adopts the single remaining tagged folder when the active one is gone', async () => {
    const { h, folderId } = await firstSyncThen((d, id) => {
      d.drive.deletePermanently(id);
    });
    const other = h.drive.addFile({
      name: 'made on another device',
      mimeType: FOLDER_MIME,
      appProperties: { n200_app: 'n200-screener', n200_kind: 'folder' },
    });
    const report = await discoverAndReconcile(h.ctx);
    expect(report.activeFolderAction).toBe('cleared');
    expect(await activeFolder(h)).toBe(other.id);
    expect(await activeFolder(h)).not.toBe(folderId);
  });

  it('surfaces a folder conflict (and chooses nothing) when several tagged folders remain', async () => {
    const { h } = await firstSyncThen((d, id) => {
      d.drive.deletePermanently(id);
    });
    for (const name of ['one', 'two']) {
      h.drive.addFile({
        name,
        mimeType: FOLDER_MIME,
        appProperties: { n200_app: 'n200-screener', n200_kind: 'folder' },
      });
    }
    const report = await discoverAndReconcile(h.ctx);
    expect(report.folderConflict).toBe(true);
    expect(await activeFolder(h)).toBeNull();
  });

  it('keeps an active folder that still exists but lost its tags, and does not clear it', async () => {
    const { h, folderId } = await firstSyncThen((d, id) => {
      const folder = d.drive.files.get(id);
      if (folder) folder.appProperties = {};
    });
    const report = await discoverAndReconcile(h.ctx);
    expect(report.activeFolderAction).toBe('readopted');
    expect(await activeFolder(h)).toBe(folderId);
    expect((await getSyncProfile(h.db))?.known_folder_ids).toContain(folderId);
  });

  it('a direct upload heals itself: a vanished folder is cleared and replaced within the same attempt', async () => {
    const { h, folderId } = await firstSyncThen((d, id) => d.drive.deletePermanently(id));
    await addRun(h.db, B, 'SYNTHETIC_non_ascii_names.csv');
    const result = await uploadRun(h.ctx, B);
    expect(result.status).toBe('uploaded');
    expect(await activeFolder(h)).not.toBe(folderId);
    expect((await getRun(h.db, B))?.sync.state).toBe('synced');
    expect(folders(h)).toHaveLength(1);
  });

  it('a folder failure that is not about the folder does not clear it', async () => {
    const { h, folderId } = await firstSyncThen(() => undefined);
    await addRun(h.db, B, 'SYNTHETIC_non_ascii_names.csv');
    h.drive.fail({
      when: (r) => r.method === 'POST' && isUploadRequest(r),
      times: 99,
      status: 503,
    });
    const result = await uploadRun(h.ctx, B);
    expect(result.status).toBe('failed');
    expect(await activeFolder(h)).toBe(folderId);
  });
});

describe('remote_missing recovery', () => {
  async function missingRun() {
    const h = await makeSyncHarness();
    await addRun(h.db, A);
    expect((await syncNow(h.ctx)).status).toBe('ok');
    const run = await getRun(h.db, A);
    const fileId = run?.sync.drive?.file_id ?? '';
    const storedVersion = run?.sync.drive?.version ?? '';
    h.drive.trash(fileId);
    await syncNow(h.ctx);
    expect((await getRun(h.db, A))?.sync.state).toBe('remote_missing');
    return { h, fileId, storedVersion };
  }

  it('when the saved file reappears and validates, the run becomes synced again with refreshed version and checksum', async () => {
    const { h, fileId } = await missingRun();
    const file = h.drive.files.get(fileId);
    if (!file) throw new Error('no file');
    file.trashed = false;
    file.version += 1;
    const uploadsBefore = h.drive.requestsMatching(isUploadRequest).length;

    const report = await syncNow(h.ctx);
    expect(report.status).toBe('ok');
    if (report.status !== 'ok') return;
    expect(report.discovery.files[0]).toMatchObject({ result: 'recovered', runId: A });
    const run = await getRun(h.db, A);
    expect(run?.sync.state).toBe('synced');
    expect(run?.sync.diagnostics.has_verified_remote_copy).toBe(true);
    expect(run?.sync.drive?.version).toBe(String(file.version));
    expect(run?.sync.drive?.file_id).toBe(fileId);
    // Nothing was uploaded again.
    expect(h.drive.requestsMatching(isUploadRequest)).toHaveLength(uploadsBefore);
    expect(jsonFiles(h)).toHaveLength(1);
  });

  it('recovers even when Drive reports the same version and checksum as before (an unchanged-looking file must not stay stranded)', async () => {
    const { h, fileId, storedVersion } = await missingRun();
    const file = h.drive.files.get(fileId);
    if (!file) throw new Error('no file');
    file.trashed = false;
    file.version = Number(storedVersion);
    await syncNow(h.ctx);
    expect((await getRun(h.db, A))?.sync.state).toBe('synced');
  });

  it('a reappearing file whose content diverged becomes a conflict with a remote variant, not synced', async () => {
    const { h, fileId } = await missingRun();
    const file = h.drive.files.get(fileId);
    const run = await getRun(h.db, A);
    if (!file || !run) throw new Error('missing');
    const edited: Record<string, unknown> = {
      ...(run.envelope as Record<string, unknown>),
      query_text: 'edited while in the trash',
    };
    const rest = withoutKey(edited, 'envelope_sha256');
    const divergent = { ...rest, envelope_sha256: await jcsSha256Hex(rest) };
    h.drive.setContent(fileId, JSON.stringify(divergent));
    file.trashed = false;

    await syncNow(h.ctx);
    expect((await getRun(h.db, A))?.sync.state).toBe('conflict');
    const variants = await h.db.getAll(STORE.runVariants);
    expect(variants).toHaveLength(1);
    expect(variants[0]?.source).toBe('remote');
  });

  it('a file that stays gone stays remote_missing across passes, and is never re-uploaded', async () => {
    const { h, fileId } = await missingRun();
    h.drive.deletePermanently(fileId);
    await syncNow(h.ctx);
    await syncNow(h.ctx);
    expect((await getRun(h.db, A))?.sync.state).toBe('remote_missing');
    expect(jsonFiles(h)).toHaveLength(0);
  });
});

describe('leader lease renewal during long uploads', () => {
  it('the lease is renewed before every request of a multi-step resumable upload, so a contender is never granted it mid-upload', async () => {
    const h = await makeSyncHarness();
    await addRun(h.db, A);
    const ttlMs = 1000;
    let clock = 10_000;
    const contenderResults: boolean[] = [];
    // Every Drive request "takes" 600 ms of wall time, and a contender tries to take over the
    // lease at that moment. The upload is interrupted twice, so it needs many requests: far more
    // than one TTL in total, which an un-renewed lease could not survive.
    h.drive.fail({
      when: (r) => {
        clock += 600;
        void r;
        return false;
      },
      times: 9999,
    });
    h.drive.fail({
      when: (r) =>
        isUploadRequest(r) && r.method === 'PUT' && (r.headers['content-range'] ?? '') === '',
      partialBytes: 25,
      times: 1,
    });
    const originalFetch = h.drive.fetch;
    const observed: typeof h.drive.fetch = async (input, init) => {
      // Only once the pass leads (before that the lease does not exist yet).
      const lease = (await getSyncProfile(h.db))?.lease;
      if (lease && lease.holder_id !== 'contender') {
        const outcome = await acquireSyncLease(h.db, {
          holderId: 'contender',
          nowMs: clock,
          ttlMs,
        });
        contenderResults.push(outcome.ok);
      }
      return originalFetch(input, init);
    };
    const client = h.newClient();
    void client;
    // Drive the engine with the observing fetch.
    const { createDriveClient } = await import('../../src/core/sync/driveClient');
    const watched = createDriveClient({
      fetch: observed,
      tokens: h.tokens,
      auth: h.auth,
      timeoutMs: 2000,
      maxAttempts: 3,
      baseDelayMs: 1,
      maxDelayMs: 2,
      random: () => 0.5,
      sleep: () => Promise.resolve(),
    });
    const report = await syncNow({
      db: h.db,
      client: watched,
      now: () => clock,
      leaseTtlMs: ttlMs,
    });
    expect(report.status).toBe('ok');
    expect(contenderResults.length).toBeGreaterThan(6);
    // The contender must never win while the pass is running.
    expect(contenderResults.every((ok) => !ok)).toBe(true);
    expect((await getRun(h.db, A))?.sync.state).toBe('synced');
  });
});
