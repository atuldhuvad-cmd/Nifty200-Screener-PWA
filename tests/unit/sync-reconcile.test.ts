import { afterEach, describe, expect, it } from 'vitest';
import { jcsSha256Hex } from '../../src/core/envelope/canonicalHash';
import { runFileQuery } from '../../src/core/sync/appProperties';
import { discoverAndReconcile } from '../../src/core/sync/reconcile';
import { selectActiveFolder, serializeEnvelope, uploadRun } from '../../src/core/sync/upload';
import { countAtRiskRuns } from '../../src/core/storage/persistence';
import { listComparisonIdentityGroups } from '../../src/core/storage/comparisonIndex';
import { getAllRuns, getRun } from '../../src/core/storage/runs';
import { STORE } from '../../src/core/storage/schema';
import { getSyncProfile } from '../../src/core/storage/syncProfile';
import { DriveError } from '../../src/core/sync/errors';
import { synthetic, withoutKey } from '../helpers';
import { buildTestMultipartEnvelope } from '../storage-helpers';
import { commitNewRun } from '../../src/core/storage/runs';
import {
  addRun,
  closeAllDatabases,
  makeSyncHarness,
  secondDevice,
  type SyncHarness,
} from '../support/syncHarness';

afterEach(() => {
  closeAllDatabases();
});

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';

const isMedia = (r: { query: URLSearchParams }): boolean => r.query.get('alt') === 'media';
const jsonFiles = (h: SyncHarness) =>
  [...h.drive.files.values()].filter((f) => f.mimeType === 'application/json');

async function uploaded(h: SyncHarness, ...ids: string[]): Promise<void> {
  for (const id of ids) {
    expect((await uploadRun(h.ctx, id)).status).toBe('uploaded');
  }
}

async function divergentOf(h: SyncHarness, runId: string): Promise<Record<string, unknown>> {
  const run = await getRun(h.db, runId);
  if (!run) throw new Error('no run');
  const edited: Record<string, unknown> = {
    ...(run.envelope as Record<string, unknown>),
    query_text: 'edited elsewhere',
  };
  const rest = withoutKey(edited, 'envelope_sha256');
  return { ...rest, envelope_sha256: await jcsSha256Hex(rest) };
}

describe('fresh-device restore', () => {
  it('rebuilds every synced run byte-for-byte from Drive, marked synced with Drive metadata', async () => {
    const a = await makeSyncHarness();
    await addRun(a.db, A);
    await addRun(a.db, B, 'SYNTHETIC_non_ascii_names.csv');
    await commitNewRun(
      a.db,
      await buildTestMultipartEnvelope({
        runId: C,
        parts: [
          { fixtureBytes: synthetic('SYNTHETIC_run_history_multipart_1.csv'), filename: 'p1.csv' },
          { fixtureBytes: synthetic('SYNTHETIC_run_history_multipart_2.csv'), filename: 'p2.csv' },
        ],
      }),
    );
    await uploaded(a, A, B, C);

    const b = await secondDevice(a);
    const report = await discoverAndReconcile(b.ctx);
    expect(report.folderConflict).toBe(false);
    expect(report.files.map((f) => f.result).sort()).toEqual([
      'committed',
      'committed',
      'committed',
    ]);

    const original = new Map((await getAllRuns(a.db)).map((r) => [r.run_id, r]));
    const restored = await getAllRuns(b.db);
    expect(restored).toHaveLength(3);
    for (const run of restored) {
      const source = original.get(run.run_id);
      expect(run.envelope).toEqual(source?.envelope);
      expect(Array.from(serializeEnvelope(run.envelope))).toEqual(
        Array.from(serializeEnvelope(source?.envelope as never)),
      );
      expect(run.sync.state).toBe('synced');
      expect(run.sync.diagnostics.has_verified_remote_copy).toBe(true);
      expect(run.sync.drive?.file_id).toBe(source?.sync.drive?.file_id);
      expect(run.sync.drive?.md5_checksum).toBe(source?.sync.drive?.md5_checksum);
    }
    expect(await countAtRiskRuns(b.db)).toBe(0);
    expect((await listComparisonIdentityGroups(b.db)).length).toBeGreaterThan(0);
    const profile = await getSyncProfile(b.db);
    expect(profile?.known_folder_ids).toHaveLength(1);
    expect(profile?.active_folder_id).toBe(profile?.known_folder_ids[0]);
  });

  it('preserves pending local runs and merges by run_id without overwriting', async () => {
    const a = await makeSyncHarness();
    await addRun(a.db, A);
    await uploaded(a, A);
    const b = await secondDevice(a);
    await addRun(b.db, D); // a run only device B has, still pending
    const before = await getRun(b.db, D);
    await discoverAndReconcile(b.ctx);
    expect(await getRun(b.db, D)).toEqual(before);
    expect((await getAllRuns(b.db)).map((r) => r.run_id).sort()).toEqual([A, D].sort());
  });
});

describe('discovery: pagination and search', () => {
  it('finds every run across many pages', async () => {
    const a = await makeSyncHarness();
    const ids = [A, B, C, D, '55555555-5555-4555-8555-555555555555'];
    for (const id of ids) await addRun(a.db, id);
    await uploaded(a, ...ids);
    a.drive.pageSizeCap = 2;
    const b = await secondDevice(a);
    await discoverAndReconcile(b.ctx);
    expect((await getAllRuns(b.db)).map((r) => r.run_id).sort()).toEqual([...ids].sort());
    const pages = a.drive.requestsMatching(
      (r) => r.path === '/drive/v3/files' && r.query.has('pageToken'),
    );
    expect(pages.length).toBeGreaterThan(0);
  });

  it('survives a rejected page token by restarting the listing once', async () => {
    const a = await makeSyncHarness();
    const ids = [A, B, C, D];
    for (const id of ids) await addRun(a.db, id);
    await uploaded(a, ...ids);
    a.drive.pageSizeCap = 1;
    const b = await secondDevice(a);
    let invalidated = false;
    a.drive.fail({
      times: 999,
      when: (r) => {
        if (r.path === '/drive/v3/files' && r.query.has('pageToken') && !invalidated) {
          invalidated = true;
          a.drive.invalidatePageTokens();
        }
        return false;
      },
    });
    await discoverAndReconcile(b.ctx);
    expect((await getAllRuns(b.db)).map((r) => r.run_id).sort()).toEqual([...ids].sort());
  });

  it('a run file moved outside every app folder is still found by the global tagged-file search (orphaned_remote)', async () => {
    const a = await makeSyncHarness();
    await addRun(a.db, A);
    await uploaded(a, A);
    const fileId = (await getRun(a.db, A))?.sync.drive?.file_id ?? '';
    a.drive.move(fileId, []); // dragged out of the folder in the Drive web UI
    const b = await secondDevice(a);
    const report = await discoverAndReconcile(b.ctx);
    expect(report.files).toEqual([
      expect.objectContaining({ fileId, runId: A, result: 'committed', orphaned: true }),
    ]);
    expect((await getRun(b.db, A))?.sync.state).toBe('synced');
  });

  it('a renamed app folder is still found by its tags', async () => {
    const a = await makeSyncHarness();
    await addRun(a.db, A);
    await uploaded(a, A);
    const folder = [...a.drive.files.values()].find(
      (f) => f.mimeType === 'application/vnd.google-apps.folder',
    );
    if (folder) folder.name = 'renamed by the user';
    const b = await secondDevice(a);
    const report = await discoverAndReconcile(b.ctx);
    expect(report.folders).toHaveLength(1);
    expect(report.files[0]?.orphaned).toBe(false);
  });
});

describe('discovery: unrelated, malformed and mismatched files', () => {
  it('never fetches untagged files and ignores trashed ones', async () => {
    const a = await makeSyncHarness();
    await addRun(a.db, A);
    await uploaded(a, A);
    const folderId = (await getSyncProfile(a.db))?.active_folder_id ?? '';
    const untagged = a.drive.addFile({
      name: 'holiday-photos.zip',
      parents: [folderId],
      content: 'zip',
    });
    const trashed = a.drive.addFile({
      name: 'old.json',
      parents: [folderId],
      appProperties: { n200_app: 'n200-screener', n200_kind: 'run' },
      trashed: true,
      content: 'x',
    });
    const b = await secondDevice(a);
    await discoverAndReconcile(b.ctx);
    const downloaded = a.drive.requestsMatching(isMedia).map((r) => r.path.split('/').pop());
    expect(downloaded).not.toContain(untagged.id);
    expect(downloaded).not.toContain(trashed.id);
    expect((await getAllRuns(b.db)).map((r) => r.run_id)).toEqual([A]);
  });

  it('quarantines a tagged file whose content is malformed, preserving its exact bytes', async () => {
    const a = await makeSyncHarness();
    const garbage = new Uint8Array([0xff, 0x00, 0x7b, 0x80]);
    const bad = a.drive.addFile({
      name: 'run-garbage.json',
      appProperties: { n200_app: 'n200-screener', n200_kind: 'run', n200_run: A },
      content: garbage,
    });
    const b = await secondDevice(a);
    const report = await discoverAndReconcile(b.ctx);
    expect(report.files).toEqual([
      expect.objectContaining({ fileId: bad.id, result: 'quarantined', runId: null }),
    ]);
    const items = await b.db.getAll(STORE.quarantineItems);
    expect(items).toHaveLength(1);
    expect(items[0]?.source).toBe('drive');
    expect(Array.from(items[0]?.original_bytes ?? [])).toEqual(Array.from(garbage));
    expect(await getAllRuns(b.db)).toEqual([]);
  });

  it('quarantines a valid envelope whose appProperties disagree with its own content (hints are never trusted)', async () => {
    const a = await makeSyncHarness();
    await addRun(a.db, A);
    await uploaded(a, A);
    const file = jsonFiles(a)[0];
    if (!file) throw new Error('no file');
    // The tags now claim a different run than the file actually contains.
    file.appProperties['n200_run'] = B;
    const b = await secondDevice(a);
    const report = await discoverAndReconcile(b.ctx);
    expect(report.files[0]).toMatchObject({ result: 'quarantined' });
    expect(await getAllRuns(b.db)).toEqual([]);
    const items = await b.db.getAll(STORE.quarantineItems);
    expect(items).toHaveLength(1);
    expect(items[0]?.validation_errors).toContain('APP_PROPERTIES_MISMATCH');
  });

  it('preserves an unsupported-schema remote file as unsupported_schema, excluded from active views', async () => {
    const a = await makeSyncHarness();
    a.drive.addFile({
      name: 'run-future.json',
      appProperties: {
        n200_app: 'n200-screener',
        n200_kind: 'run',
        n200_run: D,
        n200_schema: '99',
      },
      content: JSON.stringify({ run_id: D, schema_version: '99', payload: 'opaque' }),
    });
    const b = await secondDevice(a);
    const report = await discoverAndReconcile(b.ctx);
    expect(report.files[0]).toMatchObject({ result: 'unsupported_schema', runId: D });
    expect((await getRun(b.db, D))?.sync.state).toBe('unsupported_schema');
  });
});

describe('reconciling with local state', () => {
  it('skips the download entirely when a known file is unchanged (same version and md5)', async () => {
    const a = await makeSyncHarness();
    await addRun(a.db, A);
    await uploaded(a, A);
    const before = a.drive.requestsMatching(isMedia).length;
    const report = await discoverAndReconcile(a.ctx);
    expect(report.files[0]?.result).toBe('unchanged');
    expect(a.drive.requestsMatching(isMedia).length).toBe(before);
  });

  it('a changed remote version forces a full re-download and re-validation, even if the content is identical', async () => {
    const a = await makeSyncHarness();
    await addRun(a.db, A);
    await uploaded(a, A);
    const file = jsonFiles(a)[0];
    if (!file) throw new Error('no file');
    a.drive.setContent(file.id, file.content); // same bytes, new version
    const before = a.drive.requestsMatching(isMedia).length;
    const report = await discoverAndReconcile(a.ctx);
    expect(a.drive.requestsMatching(isMedia).length).toBe(before + 1);
    expect(report.files[0]?.result).toBe('refreshed');
    const run = await getRun(a.db, A);
    expect(run?.sync.state).toBe('synced');
    expect(run?.sync.drive?.version).toBe(String(file.version));
  });

  it('a divergent remote copy is preserved as a remote variant and the canonical run becomes conflict; neither side is overwritten', async () => {
    const a = await makeSyncHarness();
    await addRun(a.db, A);
    await uploaded(a, A);
    const file = jsonFiles(a)[0];
    if (!file) throw new Error('no file');
    const canonicalBefore = (await getRun(a.db, A))?.envelope;
    const divergent = JSON.stringify(await divergentOf(a, A));
    a.drive.setContent(file.id, divergent);

    const report = await discoverAndReconcile(a.ctx);
    expect(report.files[0]?.result).toBe('conflict');
    const run = await getRun(a.db, A);
    expect(run?.sync.state).toBe('conflict');
    expect(run?.envelope).toEqual(canonicalBefore);
    const variants = await a.db.getAll(STORE.runVariants);
    expect(variants).toHaveLength(1);
    expect(variants[0]?.source).toBe('remote');
    expect(new TextDecoder().decode(a.drive.files.get(file.id)?.content)).toBe(divergent);
  });

  it('links a local pending run to an identical remote copy instead of creating a second Drive file', async () => {
    const a = await makeSyncHarness();
    await addRun(a.db, A);
    await uploaded(a, A);
    const b = await secondDevice(a);
    await addRun(b.db, A); // not the same envelope hash (built independently) -> would conflict
    const source = await getRun(a.db, A);
    if (!source) throw new Error('no run');
    // Give device B the very same immutable envelope (as a backup import would), still pending.
    await b.db.delete(STORE.runs, A);
    await b.db.put(STORE.runs, {
      run_id: A,
      envelope: source.envelope,
      sync: { state: 'pending', prior_stable_state: null, diagnostics: source.sync.diagnostics },
    });
    const report = await discoverAndReconcile(b.ctx);
    expect(report.files[0]?.result).toBe('linked');
    expect((await getRun(b.db, A))?.sync.state).toBe('synced');
    expect(jsonFiles(a)).toHaveLength(1);
  });

  it('reports a second remote copy of the same run as a duplicate without touching the linked one', async () => {
    const a = await makeSyncHarness();
    await addRun(a.db, A);
    await uploaded(a, A);
    const original = jsonFiles(a)[0];
    if (!original) throw new Error('no file');
    a.drive.addFile({
      name: 'run-copy.json',
      parents: original.parents,
      appProperties: { ...original.appProperties },
      content: original.content,
    });
    const before = (await getRun(a.db, A))?.sync.drive;
    const report = await discoverAndReconcile(a.ctx);
    expect(report.files.map((f) => f.result).sort()).toEqual(['duplicate_remote', 'unchanged']);
    expect((await getRun(a.db, A))?.sync.drive).toEqual(before);
  });
});

describe('missing remote files (only on a device that previously synced the run)', () => {
  it('a permanently deleted file marks the synced run remote_missing; never auto-re-uploaded', async () => {
    const a = await makeSyncHarness();
    await addRun(a.db, A);
    await uploaded(a, A);
    const fileId = (await getRun(a.db, A))?.sync.drive?.file_id ?? '';
    a.drive.deletePermanently(fileId);
    const report = await discoverAndReconcile(a.ctx);
    expect(report.missing).toEqual([A]);
    const run = await getRun(a.db, A);
    expect(run?.sync.state).toBe('remote_missing');
    expect(run?.sync.diagnostics.has_verified_remote_copy).toBe(false);
    expect(jsonFiles(a)).toHaveLength(0); // nothing was re-uploaded
  });

  it('a trashed file is also remote_missing', async () => {
    const a = await makeSyncHarness();
    await addRun(a.db, A);
    await uploaded(a, A);
    a.drive.trash((await getRun(a.db, A))?.sync.drive?.file_id ?? '');
    await discoverAndReconcile(a.ctx);
    expect((await getRun(a.db, A))?.sync.state).toBe('remote_missing');
  });

  it('a trashed file the search still lists (lagging index) is detected by the direct probe', async () => {
    const a = await makeSyncHarness();
    await addRun(a.db, A);
    await uploaded(a, A);
    const stale = await a.ctx.client.listFiles({ q: runFileQuery() });
    expect(stale).toHaveLength(1);
    a.drive.trash((await getRun(a.db, A))?.sync.drive?.file_id ?? '');
    const lagging = {
      ...a.ctx,
      client: {
        ...a.ctx.client,
        listFiles: ({ q }: { q: string }) =>
          q === runFileQuery() ? Promise.resolve(stale) : a.ctx.client.listFiles({ q }),
      },
    };
    const report = await discoverAndReconcile(lagging);
    expect(report.missing).toEqual([A]);
    expect((await getRun(a.db, A))?.sync.state).toBe('remote_missing');
    expect(jsonFiles(a).filter((f) => !f.trashed)).toHaveLength(0); // no re-upload, no untrash
  });

  it('a listed file that already shows as trashed is not downloaded, and its run is reported missing', async () => {
    const a = await makeSyncHarness();
    await addRun(a.db, A);
    await uploaded(a, A);
    const fileId = (await getRun(a.db, A))?.sync.drive?.file_id ?? '';
    a.drive.lagTrashInSearch = true;
    a.drive.trash(fileId);
    const before = a.drive.requests.length;
    const report = await discoverAndReconcile(a.ctx);
    expect(report.files.map((f) => f.result)).toEqual(['trashed']);
    expect(report.missing).toEqual([A]);
    expect(a.drive.requests.slice(before).filter(isMedia)).toHaveLength(0);
  });

  it('a present, untrashed file stays synced and is probed read-only', async () => {
    const a = await makeSyncHarness();
    await addRun(a.db, A);
    await uploaded(a, A);
    const before = a.drive.requests.length;
    const report = await discoverAndReconcile(a.ctx);
    expect(report.missing).toEqual([]);
    expect((await getRun(a.db, A))?.sync.state).toBe('synced');
    const added = a.drive.requests.slice(before);
    expect(added.every((r) => r.method === 'GET')).toBe(true);
    expect(
      added.some((r) => r.method === 'GET' && r.path.startsWith('/drive/v3/files/') && !isMedia(r)),
    ).toBe(true);
  });

  it('an inaccessible file (403 on the probe) is not reported missing', async () => {
    const a = await makeSyncHarness();
    await addRun(a.db, A);
    await uploaded(a, A);
    const fileId = (await getRun(a.db, A))?.sync.drive?.file_id ?? '';
    a.drive.fail({
      when: (r) => r.method === 'GET' && r.path === `/drive/v3/files/${fileId}` && !isMedia(r),
      status: 403,
      reason: 'forbidden',
      times: 10,
    });
    const report = await discoverAndReconcile(a.ctx);
    expect(report.missing).toEqual([]);
    expect((await getRun(a.db, A))?.sync.state).toBe('synced');
  });

  it('a transient probe failure (503) leaves the run synced, is counted as unverified, and does not fail the pass', async () => {
    const a = await makeSyncHarness({ maxAttempts: 2 });
    await addRun(a.db, A);
    await uploaded(a, A);
    const fileId = (await getRun(a.db, A))?.sync.drive?.file_id ?? '';
    a.drive.fail({
      when: (r) => r.method === 'GET' && r.path === `/drive/v3/files/${fileId}` && !isMedia(r),
      status: 503,
      times: 20,
    });
    const report = await discoverAndReconcile(a.ctx);
    expect(report.unverified).toBe(1);
    expect(report.missing).toEqual([]);
    expect((await getRun(a.db, A))?.sync.state).toBe('synced');
  });

  it('a 401 on the probe ends the pass as unauthorized (account level), never as unverified', async () => {
    const a = await makeSyncHarness();
    await addRun(a.db, A);
    await uploaded(a, A);
    const fileId = (await getRun(a.db, A))?.sync.drive?.file_id ?? '';
    a.drive.fail({
      when: (r) => r.method === 'GET' && r.path === `/drive/v3/files/${fileId}` && !isMedia(r),
      status: 401,
    });
    await expect(discoverAndReconcile(a.ctx)).rejects.toMatchObject({ kind: 'unauthorized' });
    expect((await getRun(a.db, A))?.sync.state).toBe('synced');
  });

  it('cancellation between probes stops the pass with a cancelled error and changes no run', async () => {
    const a = await makeSyncHarness();
    await addRun(a.db, A);
    await addRun(a.db, B, 'SYNTHETIC_non_ascii_names.csv');
    await uploaded(a, A, B);
    const controller = new AbortController();
    let probes = 0;
    const ctx = {
      ...a.ctx,
      signal: controller.signal,
      client: {
        ...a.ctx.client,
        probeFile: (id: string, o?: { signal?: AbortSignal }) => {
          probes += 1;
          controller.abort();
          return a.ctx.client.probeFile(id, o);
        },
      },
    };
    await expect(discoverAndReconcile(ctx)).rejects.toMatchObject({ kind: 'cancelled' });
    expect(probes).toBe(1);
    expect((await getRun(a.db, A))?.sync.state).toBe('synced');
    expect((await getRun(a.db, B))?.sync.state).toBe('synced');
  });

  it('request growth: exactly one metadata probe per synced run, none for runs that are not synced', async () => {
    const a = await makeSyncHarness();
    await addRun(a.db, A);
    await addRun(a.db, B, 'SYNTHETIC_non_ascii_names.csv');
    await addRun(a.db, C, 'SYNTHETIC_blank_numerics.csv');
    await uploaded(a, A, B);
    const before = a.drive.requests.length;
    await discoverAndReconcile(a.ctx);
    const probes = a.drive.requests
      .slice(before)
      .filter(
        (r) => r.method === 'GET' && /^\/drive\/v3\/files\/[^/]+$/.test(r.path) && !isMedia(r),
      );
    expect(probes).toHaveLength(2);
  });

  it('a run that never synced is unaffected, and a fresh device cannot detect a deletion it never saw', async () => {
    const a = await makeSyncHarness();
    await addRun(a.db, A);
    await discoverAndReconcile(a.ctx);
    expect((await getRun(a.db, A))?.sync.state).toBe('pending');
  });

  it('does not report missing when Drive only failed to list a file that still exists', async () => {
    const a = await makeSyncHarness();
    await addRun(a.db, A);
    await uploaded(a, A);
    const fileId = (await getRun(a.db, A))?.sync.drive?.file_id ?? '';
    // Untag the file (so search skips it) without deleting it: it still exists.
    const file = a.drive.files.get(fileId);
    if (file) file.appProperties = {};
    await discoverAndReconcile(a.ctx);
    expect((await getRun(a.db, A))?.sync.state).toBe('synced');
  });
});

describe('duplicate application folders', () => {
  it('surfaces the conflict without merging, moving or choosing; keeps reading from every folder; blocks uploads until the user picks one', async () => {
    const a = await makeSyncHarness();
    await addRun(a.db, A);
    await uploaded(a, A);
    // Another fresh device raced and created its own tagged folder holding its own run.
    const b = await secondDevice(a);
    await b.db.close();
    const raceFolder = a.drive.addFile({
      name: 'Nifty 200 Screener data',
      mimeType: 'application/vnd.google-apps.folder',
      appProperties: { n200_app: 'n200-screener', n200_kind: 'folder' },
    });
    const c = await secondDevice(a);
    await addRun(c.db, B);
    a.drive.addFile({
      name: `run-${B}.json`,
      parents: [raceFolder.id],
      appProperties: { n200_app: 'n200-screener', n200_kind: 'run', n200_run: B, n200_schema: '1' },
      content: serializeEnvelope((await getRun(c.db, B))?.envelope ?? ({} as never)),
    });
    const fresh = await secondDevice(a);
    const report = await discoverAndReconcile(fresh.ctx);
    expect(report.folderConflict).toBe(true);
    expect(report.folders).toHaveLength(2);
    const profile = await getSyncProfile(fresh.db);
    expect(profile?.active_folder_id).toBeNull();
    expect(profile?.known_folder_ids).toHaveLength(2);
    // Runs from BOTH folders are readable.
    expect((await getAllRuns(fresh.db)).map((r) => r.run_id).sort()).toEqual([A, B].sort());
    // Nothing was deleted or moved.
    expect(
      [...a.drive.files.values()].filter(
        (f) => f.mimeType === 'application/vnd.google-apps.folder',
      ),
    ).toHaveLength(2);

    // Uploads are blocked and the run is untouched until the user chooses.
    await addRun(fresh.db, C);
    const blocked = await uploadRun(fresh.ctx, C);
    expect(blocked).toEqual({ status: 'blocked', reason: 'FOLDER_CONFLICT' });
    expect((await getRun(fresh.db, C))?.sync.state).toBe('pending');
    await selectActiveFolder(fresh.db, raceFolder.id);
    expect((await uploadRun(fresh.ctx, C)).status).toBe('uploaded');
    expect(jsonFiles(a).find((f) => f.appProperties['n200_run'] === C)?.parents).toEqual([
      raceFolder.id,
    ]);
  });
});

describe('errors during discovery', () => {
  it('propagates a 401 (account level) without changing any run state', async () => {
    const a = await makeSyncHarness();
    await addRun(a.db, A);
    await uploaded(a, A);
    a.drive.revokeToken(a.token);
    await expect(discoverAndReconcile(a.ctx)).rejects.toBeInstanceOf(DriveError);
    expect(a.auth.get()).toBe('reconnect_required');
    expect((await getRun(a.db, A))?.sync.state).toBe('synced');
  });
});
