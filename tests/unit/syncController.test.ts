import { afterEach, describe, expect, it } from 'vitest';
import { createSyncController } from '../../src/lib/syncController';
import { applyTransition, getRun } from '../../src/core/storage/runs';
import { getSyncProfile } from '../../src/core/storage/syncProfile';
import type {
  ConnectResult,
  DisconnectResult,
  GisTokenProvider,
} from '../../src/core/sync/gisTokenProvider';
import { FAKE_EMAIL } from '../support/fakeDrive';
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

function fakeProvider(h: SyncHarness, connectResult: ConnectResult = { status: 'connected' }) {
  const calls = { connect: 0, disconnect: 0 };
  const provider: GisTokenProvider = {
    connect() {
      calls.connect += 1;
      if (connectResult.status === 'connected') {
        h.tokens.setToken(h.token);
        h.auth.set('connected');
      }
      return Promise.resolve(connectResult);
    },
    disconnect(): Promise<DisconnectResult> {
      calls.disconnect += 1;
      h.tokens.setToken(null);
      h.auth.set('disconnected');
      return Promise.resolve({ status: 'revoked' });
    },
    getAccessToken: () => h.tokens.getAccessToken(),
    hasToken: () => h.tokens.getAccessToken() !== null,
  };
  return { provider, calls };
}

async function setup(
  options: { configured?: boolean; locks?: boolean; connect?: ConnectResult } = {},
) {
  const h = await makeSyncHarness({ maxAttempts: 2 });
  h.auth.set('disconnected');
  h.tokens.setToken(null);
  const { provider, calls } = fakeProvider(h, options.connect);
  const controller = createSyncController({
    db: h.db,
    provider,
    client: h.client,
    auth: h.auth,
    configured: options.configured ?? true,
    locksAvailable: () => options.locks ?? true,
  });
  return { h, controller, calls };
}

describe('initial state', () => {
  it('mirrors the account state, is idle, and has touched nothing', async () => {
    const { h, controller, calls } = await setup();
    const state = controller.getState();
    expect(state).toMatchObject({
      configured: true,
      oauth: 'disconnected',
      busy: 'idle',
      locksAvailable: true,
      summary: null,
      outcome: null,
      folders: [],
      missingRuns: [],
      message: null,
    });
    expect(calls.connect).toBe(0);
    expect(h.drive.requests).toHaveLength(0);
  });
});

describe('connect and disconnect', () => {
  it('connects, reporting it, and does not sync by itself', async () => {
    const { h, controller } = await setup();
    await addRun(h.db, A);
    await controller.connect();
    expect(controller.getState().oauth).toBe('connected');
    expect(controller.getState().message).toEqual({ kind: 'info', code: 'CONNECTED' });
    expect(h.drive.requests).toHaveLength(0);
  });

  it.each([
    [{ status: 'cancelled' }, 'CONNECT_CANCELLED'],
    [{ status: 'popup_blocked' }, 'POPUP_BLOCKED'],
    [{ status: 'denied' }, 'ACCESS_DENIED'],
    [{ status: 'scope_missing' }, 'SCOPE_MISSING'],
    [{ status: 'script_failed' }, 'SCRIPT_FAILED'],
    [{ status: 'error', code: 'x' }, 'CONNECT_ERROR'],
  ] as [ConnectResult, string][])(
    '%j is reported as %s and stays disconnected',
    async (result, code) => {
      const { controller } = await setup({ connect: result });
      await controller.connect();
      expect(controller.getState().message).toEqual({ kind: 'error', code });
      expect(controller.getState().oauth).toBe('disconnected');
      expect(controller.getState().busy).toBe('idle');
    },
  );

  it('refuses to connect when no client ID is configured, without touching the provider', async () => {
    const { controller, calls } = await setup({ configured: false });
    await controller.connect();
    expect(calls.connect).toBe(0);
    expect(controller.getState().message).toEqual({ kind: 'error', code: 'NOT_CONFIGURED' });
  });

  it('disconnect revokes, clears results, and sync is refused afterwards', async () => {
    const { h, controller, calls } = await setup();
    await addRun(h.db, A);
    await controller.connect();
    await controller.syncNow();
    expect(controller.getState().summary).not.toBeNull();
    await controller.disconnect();
    expect(calls.disconnect).toBe(1);
    expect(controller.getState()).toMatchObject({
      oauth: 'disconnected',
      summary: null,
      outcome: null,
    });
    const before = h.drive.requests.length;
    await controller.syncNow();
    expect(h.drive.requests.length).toBe(before);
    expect(controller.getState().message).toEqual({ kind: 'error', code: 'NOT_CONNECTED' });
  });
});

describe('sync now', () => {
  it('is refused, with no network, when not connected', async () => {
    const { h, controller } = await setup();
    await addRun(h.db, A);
    await controller.syncNow();
    expect(h.drive.requests).toHaveLength(0);
    expect(controller.getState().message).toEqual({ kind: 'error', code: 'NOT_CONNECTED' });
  });

  it('is refused, with no network, when Web Locks are unavailable (single-tab warning state)', async () => {
    const { h, controller } = await setup({ locks: false });
    await controller.connect();
    await controller.syncNow();
    expect(h.drive.requests).toHaveLength(0);
    expect(controller.getState()).toMatchObject({
      locksAvailable: false,
      outcome: 'locks_unavailable',
    });
  });

  it('uploads pending runs and summarizes the pass in plain counts', async () => {
    const { h, controller } = await setup();
    await addRun(h.db, A);
    await addRun(h.db, B, 'SYNTHETIC_non_ascii_names.csv');
    await controller.connect();
    await controller.syncNow();
    const state = controller.getState();
    expect(state.outcome).toBe('ok');
    expect(state.summary).toEqual({
      uploaded: 2,
      restored: 0,
      conflicts: 0,
      quarantined: 0,
      missing: 0,
      blocked: 0,
      failed: 0,
      checked: 0,
      unchanged: 0,
      refreshed: 0,
      alreadyPresent: 0,
      unsupported: 0,
      duplicate: 0,
      tooLarge: 0,
      trashedListed: 0,
      unverified: 0,
    });
    expect((await getRun(h.db, A))?.sync.state).toBe('synced');
    expect(state.busy).toBe('idle');
  });

  it('runs one sync at a time: a second request while one is running does nothing', async () => {
    const { h, controller } = await setup();
    await addRun(h.db, A);
    await controller.connect();
    const first = controller.syncNow();
    const second = controller.syncNow();
    await Promise.all([first, second]);
    expect(h.drive.files.size).toBe(2); // one folder + one file, not doubled
    expect(
      h.drive.requestsMatching((r) => r.method === 'POST' && r.path === '/upload/drive/v3/files'),
    ).toHaveLength(1);
  });

  it('reports a different Google account as blocked, and changes nothing', async () => {
    const { h, controller } = await setup();
    await addRun(h.db, A);
    await controller.connect();
    await controller.syncNow();
    await addRun(h.db, B, 'SYNTHETIC_non_ascii_names.csv');
    h.drive.permissionId = 'some-other-account';
    await controller.syncNow();
    expect(controller.getState().outcome).toBe('blocked_account');
    expect((await getRun(h.db, B))?.sync.state).toBe('pending');
  });

  it('a 401 becomes reconnect_required at account level and leaves run states alone', async () => {
    const { h, controller } = await setup();
    await addRun(h.db, A);
    await controller.connect();
    h.drive.revokeToken(h.token);
    await controller.syncNow();
    expect(controller.getState()).toMatchObject({
      oauth: 'reconnect_required',
      outcome: 'reconnect_required',
    });
    expect((await getRun(h.db, A))?.sync.state).toBe('pending');
  });
});

describe('folder conflict', () => {
  it('lists the tagged folders without choosing; choosing one lets uploads proceed into it', async () => {
    const { h, controller } = await setup();
    const tags = { n200_app: 'n200-screener', n200_kind: 'folder' };
    const one = h.drive.addFile({ name: 'Folder One', mimeType: FOLDER_MIME, appProperties: tags });
    h.drive.addFile({ name: 'Folder Two', mimeType: FOLDER_MIME, appProperties: tags });
    await addRun(h.db, A);
    await controller.connect();
    await controller.syncNow();
    expect(
      controller
        .getState()
        .folders.map((f) => f.name)
        .sort(),
    ).toEqual(['Folder One', 'Folder Two']);
    expect((await getSyncProfile(h.db))?.active_folder_id).toBeNull();
    expect(controller.getState().summary?.blocked).toBe(1);

    await controller.chooseFolder(one.id);
    expect(controller.getState().folders).toEqual([]);
    await controller.syncNow();
    expect((await getRun(h.db, A))?.sync.state).toBe('synced');
    const uploaded = [...h.drive.files.values()].find((f) => f.name === `run-${A}.json`);
    expect(uploaded?.parents).toEqual([one.id]);
  });
});

describe('sync summary counts by category', () => {
  it('counts files checked and unchanged on a repeat sync, so all-zero is not ambiguous', async () => {
    const { h, controller } = await setup();
    await addRun(h.db, A);
    await controller.connect();
    await controller.syncNow();
    await controller.syncNow();
    expect(controller.getState().summary).toMatchObject({
      checked: 1,
      unchanged: 1,
      uploaded: 0,
      restored: 0,
    });
  });

  it('counts unsupported-version files as skipped, with no file names or IDs in the state', async () => {
    const { h, controller } = await setup();
    await addRun(h.db, A);
    await controller.connect();
    await controller.syncNow();
    const file = [...h.drive.files.values()].find((f) => f.name === `run-${A}.json`);
    const tags = file?.appProperties ?? {};
    const future = h.drive.addFile({
      name: 'x.json',
      mimeType: 'application/json',
      appProperties: tags,
      content: new TextEncoder().encode(
        JSON.stringify({ schema_version: 99, run_id: B, envelope_sha256: 'x' }),
      ),
    });
    await controller.syncNow();
    const summary = controller.getState().summary;
    expect(summary?.checked).toBe(2);
    expect((summary?.unsupported ?? 0) + (summary?.quarantined ?? 0)).toBe(1);
    const text = JSON.stringify(controller.getState());
    expect(text).not.toContain(future.id);
    expect(text).not.toContain('x.json');
  });
});

describe('summary invalidation and accounting', () => {
  it('every checked file lands in exactly one category', async () => {
    const { h, controller } = await setup();
    await addRun(h.db, A);
    await controller.connect();
    await controller.syncNow();
    await controller.syncNow();
    const s = controller.getState().summary;
    if (!s) throw new Error('no summary');
    const accounted =
      s.unchanged +
      s.refreshed +
      s.alreadyPresent +
      s.unsupported +
      s.duplicate +
      s.tooLarge +
      s.trashedListed +
      s.restored +
      s.quarantined +
      s.conflicts;
    expect(accounted).toBe(s.checked);
  });

  it('a sync that fails does not leave the previous sync counts under the failure message', async () => {
    const { h, controller } = await setup();
    await addRun(h.db, A);
    await controller.connect();
    await controller.syncNow();
    expect(controller.getState().summary).not.toBeNull();
    h.drive.revokeToken(h.token);
    await controller.syncNow();
    expect(controller.getState().outcome).toBe('reconnect_required');
    expect(controller.getState().summary).toBeNull();
  });

  it('a Restore to Drive that needs a reconnect drops the old counts instead of showing them under it', async () => {
    const s = await setup();
    await addRun(s.h.db, A);
    await s.controller.connect();
    await s.controller.syncNow();
    const fileId = (await getRun(s.h.db, A))?.sync.drive?.file_id ?? '';
    s.h.drive.deletePermanently(fileId);
    await s.controller.syncNow();
    expect(s.controller.getState().summary?.missing).toBe(1);
    s.h.drive.revokeToken(s.h.token);
    await s.controller.restoreRun(A);
    expect(s.controller.getState().outcome).toBe('reconnect_required');
    expect(s.controller.getState().summary).toBeNull();
  });

  it('choosing a folder marks the summary stale', async () => {
    const { h, controller } = await setup();
    const tags = { n200_app: 'n200-screener', n200_kind: 'folder' };
    const one = h.drive.addFile({ name: 'F1', mimeType: FOLDER_MIME, appProperties: tags });
    h.drive.addFile({ name: 'F2', mimeType: FOLDER_MIME, appProperties: tags });
    await addRun(h.db, A);
    await controller.connect();
    await controller.syncNow();
    await controller.chooseFolder(one.id);
    expect(controller.getState().summaryStale).toBe(true);
  });

  it('a failed Restore to Drive leaves the summary marker unchanged', async () => {
    const s = await setup();
    await addRun(s.h.db, A);
    await s.controller.connect();
    await s.controller.syncNow();
    const fileId = (await getRun(s.h.db, A))?.sync.drive?.file_id ?? '';
    s.h.drive.deletePermanently(fileId);
    await s.controller.syncNow();
    s.h.drive.fail({
      when: (r) => r.method === 'POST',
      status: 403,
      reason: 'forbidden',
      times: 20,
    });
    await s.controller.restoreRun(A);
    expect(s.controller.getState().summaryStale).toBe(false);
    expect(s.controller.getState().message).toMatchObject({ kind: 'error' });
  });

  it('a transient probe failure shows as "could not be checked" and the sync still uploads', async () => {
    const { h, controller } = await setup();
    await addRun(h.db, A);
    await controller.connect();
    await controller.syncNow();
    await addRun(h.db, B, 'SYNTHETIC_non_ascii_names.csv');
    const fileId = (await getRun(h.db, A))?.sync.drive?.file_id ?? '';
    h.drive.fail({
      when: (r) =>
        r.method === 'GET' &&
        r.path === `/drive/v3/files/${fileId}` &&
        r.query.get('alt') !== 'media',
      status: 503,
      times: 50,
    });
    await controller.syncNow();
    const state = controller.getState();
    expect(state.outcome).toBe('ok');
    expect(state.summary).toMatchObject({ unverified: 1, uploaded: 1 });
    expect((await getRun(h.db, A))?.sync.state).toBe('synced');
  });
});

describe('remote_missing actions', () => {
  async function missing() {
    const s = await setup();
    await addRun(s.h.db, A);
    await s.controller.connect();
    await s.controller.syncNow();
    const fileId = (await getRun(s.h.db, A))?.sync.drive?.file_id ?? '';
    s.h.drive.deletePermanently(fileId);
    await s.controller.syncNow();
    return { ...s, fileId };
  }

  it('lists runs whose Drive file vanished', async () => {
    const { controller } = await missing();
    expect(controller.getState().summary?.missing).toBe(1);
    expect(controller.getState().missingRuns.map((r) => r.runId)).toEqual([A]);
  });

  it('Restore to Drive re-uploads under a new ID and the run is synced again', async () => {
    const { h, controller, fileId } = await missing();
    await controller.restoreRun(A);
    const run = await getRun(h.db, A);
    expect(run?.sync.state).toBe('synced');
    expect(run?.sync.drive?.file_id).not.toBe(fileId);
    expect(controller.getState().missingRuns).toEqual([]);
    expect(controller.getState().message).toEqual({ kind: 'info', code: 'RESTORED' });
    expect(controller.getState().summaryStale).toBe(true);
    await controller.syncNow();
    expect(controller.getState().summaryStale).toBe(false);
  });

  it('Keep local only moves the run to local_only and stops prompting', async () => {
    const { h, controller } = await missing();
    await controller.keepLocalOnly(A);
    expect((await getRun(h.db, A))?.sync.state).toBe('local_only');
    expect(controller.getState().missingRuns).toEqual([]);
    expect(controller.getState().summaryStale).toBe(true);
  });

  it('Keep local only is refused for a run that is not remote_missing', async () => {
    const { h, controller } = await setup();
    await addRun(h.db, A);
    await controller.keepLocalOnly(A);
    expect((await getRun(h.db, A))?.sync.state).toBe('pending');
    await applyTransition(h.db, A, { type: 'START_SYNC' });
    await controller.keepLocalOnly(A);
    expect((await getRun(h.db, A))?.sync.state).toBe('syncing');
  });

  it('Restore is refused when not connected', async () => {
    const { h, controller } = await missing();
    await controller.disconnect();
    const before = h.drive.requests.length;
    await controller.restoreRun(A);
    expect(h.drive.requests.length).toBe(before);
    expect((await getRun(h.db, A))?.sync.state).toBe('remote_missing');
  });
});

describe('the view state never holds secrets', () => {
  it('contains no token, session URL or email after connect, sync and restore', async () => {
    const { h, controller } = await setup();
    await addRun(h.db, A);
    await controller.connect();
    await controller.syncNow();
    const text = JSON.stringify(controller.getState());
    for (const secret of [h.token, 'upload_id', FAKE_EMAIL, 'Bearer']) {
      expect(text).not.toContain(secret);
    }
  });
});
