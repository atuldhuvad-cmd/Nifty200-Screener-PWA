import { afterEach, describe, expect, it } from 'vitest';
import { jcsSha256Hex } from '../../src/core/envelope/canonicalHash';
import { ensureDriveFileId } from '../../src/core/storage/driveMetadata';
import { md5Hex } from '../../src/core/sync/md5';
import { withoutKey } from '../helpers';
import { serializeEnvelope, restoreToDrive, uploadRun } from '../../src/core/sync/upload';
import { getSyncProfile } from '../../src/core/storage/syncProfile';
import { applyTransition, getRun } from '../../src/core/storage/runs';
import { STORE } from '../../src/core/storage/schema';
import { addRun, closeAllDatabases, makeSyncHarness } from '../support/syncHarness';

afterEach(() => {
  closeAllDatabases();
});

const RUN = '11111111-1111-4111-8111-111111111111';
const isPut = (r: { method: string; path: string }): boolean =>
  r.method === 'PUT' && r.path.startsWith('/upload/');
const isInitiate = (r: { method: string; path: string }): boolean =>
  r.method === 'POST' && r.path === '/upload/drive/v3/files';
const isFolderCreate = (r: { method: string; path: string }): boolean =>
  r.method === 'POST' && r.path === '/drive/v3/files';
const isGenerateIds = (r: { path: string }): boolean => r.path === '/drive/v3/files/generateIds';

async function storedEnvelopeBytes(
  h: Awaited<ReturnType<typeof makeSyncHarness>>,
): Promise<Uint8Array> {
  const run = await getRun(h.db, RUN);
  if (!run) throw new Error('no run');
  return serializeEnvelope(run.envelope);
}

describe('uploadRun: the happy path', () => {
  it('creates the tagged folder and file, verifies them, and records Drive metadata', async () => {
    const h = await makeSyncHarness();
    await addRun(h.db, RUN);
    const result = await uploadRun(h.ctx, RUN);
    expect(result.status).toBe('uploaded');

    const files = [...h.drive.files.values()];
    const folder = files.find((f) => f.mimeType === 'application/vnd.google-apps.folder');
    const file = files.find((f) => f.mimeType === 'application/json');
    expect(files).toHaveLength(2);
    expect(folder?.appProperties).toMatchObject({ n200_app: 'n200-screener', n200_kind: 'folder' });
    expect(file?.parents).toEqual([folder?.id]);
    expect(file?.appProperties).toMatchObject({
      n200_app: 'n200-screener',
      n200_kind: 'run',
      n200_run: RUN,
    });
    // The bytes on Drive are exactly the stored envelope's serialization.
    const bytes = await storedEnvelopeBytes(h);
    expect(Array.from(file?.content ?? [])).toEqual(Array.from(bytes));
    // The Drive filename comes from the run id, never from the original CSV filename.
    expect(file?.name).toBe(`run-${RUN}.json`);

    const run = await getRun(h.db, RUN);
    expect(run?.sync.state).toBe('synced');
    expect(run?.sync.diagnostics.has_verified_remote_copy).toBe(true);
    expect(run?.sync.drive).toEqual({
      file_id: file?.id,
      folder_id: folder?.id,
      version: String(file?.version),
      md5_checksum: md5Hex(bytes),
    });
  });
});

describe('uploadRun: idempotent identity and resumable sessions', () => {
  it('persists the pre-generated file ID before the first attempt and reuses it on retry', async () => {
    const h = await makeSyncHarness({ maxAttempts: 1 });
    await addRun(h.db, RUN);
    // The very first upload request fails (offline), after the ID has been generated.
    h.drive.fail({ when: isInitiate, network: true });
    const first = await uploadRun(h.ctx, RUN);
    expect(first.status).toBe('interrupted');

    const afterFailure = await getRun(h.db, RUN);
    expect(afterFailure?.sync.state).toBe('pending');
    const persistedId = afterFailure?.sync.drive?.file_id;
    expect(persistedId).toBeTruthy();

    const second = await uploadRun(h.ctx, RUN);
    expect(second.status).toBe('uploaded');
    const uploaded = [...h.drive.files.values()].filter((f) => f.mimeType === 'application/json');
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]?.id).toBe(persistedId);
    // One ID for the folder and one for the file, not one per attempt:
    expect(h.drive.requestsMatching(isGenerateIds)).toHaveLength(2);
  });

  it('resumes an interrupted transfer through the in-memory session without re-initiating', async () => {
    const h = await makeSyncHarness();
    await addRun(h.db, RUN);
    h.drive.fail({ when: isPut, partialBytes: 40 });
    const result = await uploadRun(h.ctx, RUN);
    expect(result.status).toBe('uploaded');
    expect(h.drive.requestsMatching(isInitiate)).toHaveLength(1);
    const statusQueries = h.drive.requestsMatching(
      (r) => isPut(r) && (r.headers['content-range'] ?? '').startsWith('bytes */'),
    );
    expect(statusQueries).toHaveLength(1);
    const uploaded = [...h.drive.files.values()].filter((f) => f.mimeType === 'application/json');
    expect(uploaded).toHaveLength(1);
    expect(Array.from(uploaded[0]?.content ?? [])).toEqual(
      Array.from(await storedEnvelopeBytes(h)),
    );
    expect(h.client.hasSession(`run:${RUN}`)).toBe(false);
  });

  it('after losing the in-memory session (page reload) it falls back to the persisted ID and starts a fresh session under it', async () => {
    const h = await makeSyncHarness({ maxAttempts: 1 });
    await addRun(h.db, RUN);
    h.drive.fail({ when: isPut, times: 99, network: true });
    h.drive.fail({
      when: (r) => isPut(r) && (r.headers['content-range'] ?? '').startsWith('bytes */'),
      times: 99,
      network: true,
    });
    expect((await uploadRun(h.ctx, RUN)).status).toBe('interrupted');
    const persistedId = (await getRun(h.db, RUN))?.sync.drive?.file_id;

    // "Reload": a brand-new client has no session URL at all, and the old session is gone.
    h.drive.expireSessions();
    h.drive.clearFaults();
    const fresh = h.newClient();
    expect(fresh.hasSession(`run:${RUN}`)).toBe(false);
    const again = await uploadRun({ db: h.db, client: fresh }, RUN);
    expect(again.status).toBe('uploaded');
    const uploaded = [...h.drive.files.values()].filter((f) => f.mimeType === 'application/json');
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]?.id).toBe(persistedId);
    expect(h.drive.requestsMatching(isInitiate)).toHaveLength(2);
  });

  it('a 409 on an ID that already holds our identical content is retrieved and verified, never re-uploaded', async () => {
    const h = await makeSyncHarness();
    await addRun(h.db, RUN);
    // The PUT completes on the server but its response is lost, and the session then expires
    // before the client can ask about it: the next initiation is answered 409.
    h.drive.fail({ when: isPut, dropResponse: true });
    h.drive.fail({
      when: (r) => {
        if (isPut(r) && (r.headers['content-range'] ?? '').startsWith('bytes */')) {
          h.drive.expireSessions();
        }
        return false;
      },
      times: 99,
    });
    const result = await uploadRun(h.ctx, RUN);
    expect(result.status).toBe('uploaded');
    const uploaded = [...h.drive.files.values()].filter((f) => f.mimeType === 'application/json');
    expect(uploaded).toHaveLength(1);
    // Exactly one transfer of the file's bytes ever happened.
    const bodies = h.drive.requestsMatching(
      (r) => isPut(r) && !(r.headers['content-range'] ?? '').startsWith('bytes */'),
    );
    expect(bodies).toHaveLength(1);
    expect((await getRun(h.db, RUN))?.sync.state).toBe('synced');
  });

  it('a 409 on an ID holding a DIVERGENT copy of the run preserves it as a remote variant and marks a conflict; nothing is overwritten', async () => {
    const h = await makeSyncHarness();
    await addRun(h.db, RUN);
    const local = await getRun(h.db, RUN);
    if (!local) throw new Error('no run');
    const edited: Record<string, unknown> = {
      ...(local.envelope as Record<string, unknown>),
      query_text: 'edited elsewhere',
    };
    const rest = withoutKey(edited, 'envelope_sha256');
    const divergent = { ...rest, envelope_sha256: await jcsSha256Hex(rest) };
    // The run already has its pre-generated ID, and someone else wrote a different version of
    // the same run at that ID.
    const fileId = await ensureDriveFileId(h.db, RUN, () => Promise.resolve('preassigned-1'));
    const remote = h.drive.addFile({
      id: fileId,
      name: 'run-elsewhere.json',
      content: JSON.stringify(divergent),
    });
    const remoteBefore = Array.from(remote.content);

    const result = await uploadRun(h.ctx, RUN);
    expect(result.status).toBe('conflict');
    expect(Array.from(h.drive.files.get(fileId)?.content ?? [])).toEqual(remoteBefore);
    const after = await getRun(h.db, RUN);
    expect(after?.sync.state).toBe('conflict');
    expect(after?.envelope).toEqual(local.envelope);
    const variants = await h.db.getAll(STORE.runVariants);
    expect(variants).toHaveLength(1);
    expect(variants[0]?.source).toBe('remote');
  });

  it('a 409 on an ID holding an unrelated file leaves nothing in syncing and is a non-retryable error', async () => {
    const h = await makeSyncHarness();
    await addRun(h.db, RUN);
    const fileId = await ensureDriveFileId(h.db, RUN, () => Promise.resolve('preassigned-2'));
    h.drive.addFile({ id: fileId, name: 'notes.txt', content: 'not an envelope at all' });
    const result = await uploadRun(h.ctx, RUN);
    expect(result).toMatchObject({ status: 'failed', code: 'DRIVE_ID_OCCUPIED', retryable: false });
    expect((await getRun(h.db, RUN))?.sync.state).toBe('error');
  });

  it('a timed-out folder create is retried under the same pre-generated folder ID (one folder, ID reused)', async () => {
    const h = await makeSyncHarness({ maxAttempts: 1 });
    await addRun(h.db, RUN);
    // The server creates the folder, but the response is lost: a timeout from the client's view.
    h.drive.fail({ when: isFolderCreate, dropResponse: true });
    expect((await uploadRun(h.ctx, RUN)).status).toBe('interrupted');
    const pending = (await getSyncProfile(h.db))?.pending_folder_id;
    expect(pending).toBeTruthy();

    const second = await uploadRun(h.ctx, RUN);
    expect(second.status).toBe('uploaded');
    const folders = [...h.drive.files.values()].filter(
      (f) => f.mimeType === 'application/vnd.google-apps.folder',
    );
    expect(folders).toHaveLength(1);
    expect(folders[0]?.id).toBe(pending);
    const profile = await getSyncProfile(h.db);
    expect(profile?.active_folder_id).toBe(pending);
    expect(profile?.pending_folder_id).toBeNull();
    expect(h.drive.requestsMatching(isGenerateIds).length).toBe(2); // one folder id + one file id
  });
});

describe('uploadRun: failures map to the exact run state, never stranding a run in syncing', () => {
  async function setup(maxAttempts = 2) {
    const h = await makeSyncHarness({ maxAttempts });
    await addRun(h.db, RUN);
    return h;
  }

  it('timeout / offline: an unsynced run returns to pending with a retryable SYNC_TIMEOUT diagnostic', async () => {
    const h = await setup(1);
    h.drive.fail({ when: isInitiate, network: true });
    expect((await uploadRun(h.ctx, RUN)).status).toBe('interrupted');
    const sync = (await getRun(h.db, RUN))?.sync;
    expect(sync?.state).toBe('pending');
    expect(sync?.diagnostics).toMatchObject({ error_code: 'SYNC_TIMEOUT', retryable: true });
  });

  it('user cancellation returns to the prior state with no error recorded', async () => {
    const h = await setup();
    const controller = new AbortController();
    h.drive.fail({
      when: isInitiate,
      delayMs: 500,
    });
    const pending = uploadRun({ ...h.ctx, signal: controller.signal }, RUN);
    setTimeout(() => {
      controller.abort();
    }, 30);
    expect((await pending).status).toBe('cancelled');
    const sync = (await getRun(h.db, RUN))?.sync;
    expect(sync?.state).toBe('pending');
    expect(sync?.diagnostics.error_code).toBeNull();
  });

  it('401: reconnect_required at account level; the run goes back to pending untouched', async () => {
    const h = await setup();
    h.drive.revokeToken(h.token);
    const result = await uploadRun(h.ctx, RUN);
    expect(result.status).toBe('reconnect_required');
    expect(h.auth.get()).toBe('reconnect_required');
    const sync = (await getRun(h.db, RUN))?.sync;
    expect(sync?.state).toBe('pending');
    expect(sync?.diagnostics.error_code).toBeNull();
  });

  it.each([
    ['503 after retries', { status: 503, reason: 'backendError' }, true],
    ['429 after retries', { status: 429, reason: 'rateLimitExceeded' }, true],
    ['403 rate limit after retries', { status: 403, reason: 'rateLimitExceeded' }, true],
    ['403 permission', { status: 403, reason: 'insufficientFilePermissions' }, false],
    ['403 storage quota exhausted', { status: 403, reason: 'storageQuotaExceeded' }, false],
    ['400', { status: 400, reason: 'badRequest' }, false],
  ])('%s → error (retryable: %s)', async (_name, fault, retryable) => {
    const h = await setup(2);
    h.drive.fail({ when: isInitiate, times: 99, ...fault });
    const result = await uploadRun(h.ctx, RUN);
    expect(result.status).toBe('failed');
    const sync = (await getRun(h.db, RUN))?.sync;
    expect(sync?.state).toBe('error');
    expect(sync?.diagnostics.retryable).toBe(retryable);
    expect(sync?.diagnostics.error_code).toMatch(/^DRIVE_/);
  });

  it('a corrupted transfer (md5 mismatch) is an error, never marked synced', async () => {
    const h = await setup();
    h.drive.corruptNextUploads = 1;
    const result = await uploadRun(h.ctx, RUN);
    expect(result.status).toBe('failed');
    const sync = (await getRun(h.db, RUN))?.sync;
    expect(sync?.state).toBe('error');
    expect(sync?.diagnostics.error_code).toBe('UPLOAD_VERIFY_FAILED');
    expect(sync?.diagnostics.has_verified_remote_copy).toBe(false);
  });
});

describe('restoreToDrive (a recovery operation for remote_missing runs)', () => {
  async function syncedThenMissing() {
    const h = await makeSyncHarness();
    await addRun(h.db, RUN);
    expect((await uploadRun(h.ctx, RUN)).status).toBe('uploaded');
    const run = await getRun(h.db, RUN);
    const fileId = run?.sync.drive?.file_id ?? '';
    return { h, fileId };
  }

  it('a trashed file is untrashed and re-verified, reusing the same Drive file ID', async () => {
    const { h, fileId } = await syncedThenMissing();
    h.drive.trash(fileId);
    await applyTransition(h.db, RUN, { type: 'REMOTE_MISSING_DETECTED' });
    const result = await restoreToDrive(h.ctx, RUN);
    expect(result.status).toBe('uploaded');
    expect(h.drive.files.get(fileId)?.trashed).toBe(false);
    const run = await getRun(h.db, RUN);
    expect(run?.sync.state).toBe('synced');
    expect(run?.sync.drive?.file_id).toBe(fileId);
    expect(
      [...h.drive.files.values()].filter((f) => f.mimeType === 'application/json'),
    ).toHaveLength(1);
  });

  it('a permanently deleted file is recovered under a NEW pre-generated ID; run_id and envelope are unchanged', async () => {
    const { h, fileId } = await syncedThenMissing();
    const envelopeBefore = (await getRun(h.db, RUN))?.envelope;
    h.drive.deletePermanently(fileId);
    await applyTransition(h.db, RUN, { type: 'REMOTE_MISSING_DETECTED' });
    const result = await restoreToDrive(h.ctx, RUN);
    expect(result.status).toBe('uploaded');
    const run = await getRun(h.db, RUN);
    expect(run?.sync.state).toBe('synced');
    expect(run?.sync.drive?.file_id).not.toBe(fileId);
    expect(run?.envelope).toEqual(envelopeBefore);
    expect(run?.run_id).toBe(RUN);
    expect(
      [...h.drive.files.values()].filter((f) => f.mimeType === 'application/json'),
    ).toHaveLength(1);
  });

  it('refuses to restore a run that is not remote_missing', async () => {
    const h = await makeSyncHarness();
    await addRun(h.db, RUN);
    expect((await restoreToDrive(h.ctx, RUN)).status).toBe('skipped');
  });
});
