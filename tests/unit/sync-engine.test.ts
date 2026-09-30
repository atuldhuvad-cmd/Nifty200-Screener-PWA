import { afterEach, describe, expect, it, vi } from 'vitest';
import { jcsSha256Hex } from '../../src/core/envelope/canonicalHash';
import { ingestEnvelopeBytes } from '../../src/core/storage/ingest';
import { WebLocksUnavailableError } from '../../src/core/storage/locks';
import { applyTransition, getAllRuns, getRun } from '../../src/core/storage/runs';
import { acquireSyncLease, getSyncProfile } from '../../src/core/storage/syncProfile';
import { transition } from '../../src/core/storage/syncState';
import { initialSyncRecord, type SyncState } from '../../src/core/storage/types';
import { syncNow } from '../../src/core/sync/engine';
import { serializeEnvelope, uploadRun } from '../../src/core/sync/upload';
import { withoutKey } from '../helpers';
import {
  addRun,
  closeAllDatabases,
  makeSyncHarness,
  secondDevice,
  type SyncHarness,
} from '../support/syncHarness';

afterEach(() => {
  closeAllDatabases();
  vi.unstubAllGlobals();
});

const ID = (n: number): string =>
  `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const jsonFiles = (h: SyncHarness) =>
  [...h.drive.files.values()].filter((f) => f.mimeType === 'application/json');
const uploadInitiations = (h: SyncHarness): number =>
  h.drive.requestsMatching((r) => r.method === 'POST' && r.path === '/upload/drive/v3/files')
    .length;

async function statesOf(h: SyncHarness): Promise<Record<string, SyncState>> {
  return Object.fromEntries((await getAllRuns(h.db)).map((r) => [r.run_id, r.sync.state]));
}

describe('state machine: which runs may ever be uploaded', () => {
  it.each(['conflict', 'quarantined', 'unsupported_schema'] as const)(
    'START_SYNC is invalid from %s',
    (state) => {
      const result = transition(initialSyncRecord(state), { type: 'START_SYNC' });
      expect(result.ok).toBe(false);
    },
  );

  it('preserves Drive metadata through every transition', () => {
    const base = {
      ...initialSyncRecord('pending'),
      drive: { file_id: 'f', folder_id: 'g', version: '1', md5_checksum: 'm' },
    };
    const started = transition(base, { type: 'START_SYNC' });
    expect(started.ok && started.record.drive).toEqual(base.drive);
    if (!started.ok) throw new Error('start failed');
    const done = transition(started.record, { type: 'SYNC_SUCCEEDED' });
    expect(done.ok && done.record.drive).toEqual(base.drive);
  });

  it('syncNow uploads only pending and retryable-error runs; every other state is left exactly as it was', async () => {
    const h = await makeSyncHarness();
    const ids = {
      pending: ID(1),
      retry: ID(2),
      hard: ID(3),
      localOnly: ID(4),
      conflict: ID(5),
      quarantined: ID(6),
      unsupported: ID(7),
      synced: ID(8),
      missing: ID(9),
    };
    const fixtures = [
      'SYNTHETIC_crlf_final_newline.csv',
      'SYNTHETIC_non_ascii_names.csv',
      'SYNTHETIC_5b_symbol_history_run1.csv',
      'SYNTHETIC_5b_symbol_history_run2.csv',
      'SYNTHETIC_5b_nse_only_early.csv',
      'SYNTHETIC_5b_isin_appears_later.csv',
      'SYNTHETIC_run_history_multipart_1.csv',
      'SYNTHETIC_5b_conflict.csv',
      'SYNTHETIC_crlf_final_newline.csv',
    ];
    const order = [
      ids.pending,
      ids.retry,
      ids.hard,
      ids.localOnly,
      ids.conflict,
      ids.quarantined,
      ids.synced,
      ids.missing,
    ];
    for (const [i, id] of order.entries()) await addRun(h.db, id, fixtures[i]);

    // retry: a transient failure
    await applyTransition(h.db, ids.retry, { type: 'START_SYNC' });
    await applyTransition(h.db, ids.retry, {
      type: 'SYNC_FAILED',
      errorCode: 'DRIVE_SERVER_ERROR',
      retryable: true,
    });
    // hard: a permanent failure (waits for the user)
    await applyTransition(h.db, ids.hard, { type: 'START_SYNC' });
    await applyTransition(h.db, ids.hard, {
      type: 'SYNC_FAILED',
      errorCode: 'DRIVE_FORBIDDEN',
      retryable: false,
    });
    // local_only, remote_missing and synced via the state machine
    for (const id of [ids.localOnly, ids.missing, ids.synced]) {
      await applyTransition(h.db, id, { type: 'START_SYNC' });
      await applyTransition(h.db, id, { type: 'SYNC_SUCCEEDED' });
    }
    await applyTransition(h.db, ids.localOnly, { type: 'REMOTE_MISSING_DETECTED' });
    await applyTransition(h.db, ids.localOnly, { type: 'KEEP_LOCAL_ONLY' });
    await applyTransition(h.db, ids.missing, { type: 'REMOTE_MISSING_DETECTED' });
    // conflict: a divergent copy of the same run arrives
    const conflictRun = await getRun(h.db, ids.conflict);
    const edited: Record<string, unknown> = {
      ...(conflictRun?.envelope as Record<string, unknown>),
      query_text: 'elsewhere',
    };
    const rest = withoutKey(edited, 'envelope_sha256');
    const divergent = { ...rest, envelope_sha256: await jcsSha256Hex(rest) };
    await ingestEnvelopeBytes(
      h.db,
      new TextEncoder().encode(JSON.stringify(divergent)),
      'backup_import',
    );
    // quarantined
    await applyTransition(h.db, ids.quarantined, { type: 'QUARANTINE' });
    // unsupported schema
    await ingestEnvelopeBytes(
      h.db,
      new TextEncoder().encode(JSON.stringify({ run_id: ids.unsupported, schema_version: '99' })),
      'backup_import',
    );

    const before = await statesOf(h);
    expect(before).toMatchObject({
      [ids.pending]: 'pending',
      [ids.retry]: 'error',
      [ids.hard]: 'error',
      [ids.localOnly]: 'local_only',
      [ids.conflict]: 'conflict',
      [ids.quarantined]: 'quarantined',
      [ids.unsupported]: 'unsupported_schema',
      [ids.synced]: 'synced',
      [ids.missing]: 'remote_missing',
    });
    // The synced and remote_missing runs have Drive identities that do not exist on this fake
    // Drive; make discovery leave them alone.
    const report = await syncNow(h.ctx);
    expect(report.status).toBe('ok');
    if (report.status !== 'ok') return;
    expect(report.uploads.map((u) => u.runId).sort()).toEqual([ids.pending, ids.retry].sort());
    expect(report.uploads.every((u) => u.outcome.status === 'uploaded')).toBe(true);
    const after = await statesOf(h);
    for (const id of Object.values(ids)) {
      if (id === ids.pending || id === ids.retry) expect(after[id]).toBe('synced');
      else if (id === ids.synced) expect(after[id]).toBe('synced');
      else expect(after[id]).toBe(before[id]);
    }
    // Only the two eligible runs were ever transferred.
    expect(
      jsonFiles(h)
        .map((f) => f.appProperties['n200_run'])
        .sort(),
    ).toEqual([ids.pending, ids.retry].sort());
  });

  it('calling uploadRun directly on an ineligible state is refused too (defence in depth)', async () => {
    const h = await makeSyncHarness();
    await addRun(h.db, ID(1));
    await applyTransition(h.db, ID(1), { type: 'QUARANTINE' });
    expect((await uploadRun(h.ctx, ID(1))).status).toBe('skipped');
    expect(h.drive.requests).toHaveLength(0);
  });
});

describe('account binding', () => {
  it('binds the opaque permissionId on first sync, verifies it after, and stores no email', async () => {
    const h = await makeSyncHarness();
    await addRun(h.db, ID(1));
    expect((await syncNow(h.ctx)).status).toBe('ok');
    expect((await getSyncProfile(h.db))?.bound_permission_id).toBe('fake-permission-0001');
    expect((await syncNow(h.ctx)).status).toBe('ok');
    expect(JSON.stringify(await getSyncProfile(h.db))).not.toContain('example.test');
    expect(
      h.drive
        .requestsMatching((r) => r.path === '/drive/v3/about')
        .every((r) => r.query.get('fields') === 'user(permissionId)'),
    ).toBe(true);
  });

  it('a different account blocks sync entirely: no listing, no upload, no change', async () => {
    const h = await makeSyncHarness();
    await addRun(h.db, ID(1));
    expect((await syncNow(h.ctx)).status).toBe('ok');
    const profileBefore = await getSyncProfile(h.db);
    const statesBefore = await statesOf(h);
    await addRun(h.db, ID(2), 'SYNTHETIC_non_ascii_names.csv');

    h.drive.permissionId = 'a-different-account';
    const requestsBefore = h.drive.requests.length;
    const report = await syncNow(h.ctx);
    expect(report).toEqual({ status: 'blocked', reason: 'ACCOUNT_MISMATCH' });
    // Only the identity check happened.
    expect(h.drive.requests.slice(requestsBefore).map((r) => r.path)).toEqual(['/drive/v3/about']);
    expect(await getSyncProfile(h.db)).toEqual(profileBefore);
    expect((await getRun(h.db, ID(2)))?.sync.state).toBe('pending');
    expect((await statesOf(h))[ID(1)]).toBe(statesBefore[ID(1)]);
  });
});

describe('authorization, locks and the leader lease', () => {
  it('401 is account-level: reconnect_required, and pending stays pending, synced stays synced', async () => {
    const h = await makeSyncHarness();
    await addRun(h.db, ID(1));
    await addRun(h.db, ID(2), 'SYNTHETIC_non_ascii_names.csv');
    expect((await uploadRun(h.ctx, ID(1))).status).toBe('uploaded');
    h.drive.revokeToken(h.token);
    const report = await syncNow(h.ctx);
    expect(report.status).toBe('reconnect_required');
    expect(h.auth.get()).toBe('reconnect_required');
    expect(await statesOf(h)).toEqual({ [ID(1)]: 'synced', [ID(2)]: 'pending' });
    expect((await getSyncProfile(h.db))?.lease).toBeNull();
  });

  it('fails closed without Web Locks: no network, no state change', async () => {
    const h = await makeSyncHarness();
    await addRun(h.db, ID(1));
    vi.stubGlobal('navigator', {});
    await expect(syncNow(h.ctx)).rejects.toBeInstanceOf(WebLocksUnavailableError);
    expect(h.drive.requests).toHaveLength(0);
    expect((await getRun(h.db, ID(1)))?.sync.state).toBe('pending');
  });

  it('two concurrent syncs: exactly one drains the queue, the other reports busy, and nothing is uploaded twice', async () => {
    const h = await makeSyncHarness();
    for (const [i, fixture] of [
      'SYNTHETIC_crlf_final_newline.csv',
      'SYNTHETIC_non_ascii_names.csv',
      'SYNTHETIC_5b_symbol_history_run1.csv',
    ].entries()) {
      await addRun(h.db, ID(i + 1), fixture);
    }
    const [x, y] = await Promise.all([syncNow(h.ctx), syncNow(h.ctx)]);
    expect([x.status, y.status].sort()).toEqual(['busy', 'ok']);
    expect(jsonFiles(h)).toHaveLength(3);
    expect(uploadInitiations(h)).toBe(3);
    expect((await getSyncProfile(h.db))?.lease).toBeNull();
  });

  it('takes over an expired lease left by a crashed tab, and releases its own even when the pass fails', async () => {
    const h = await makeSyncHarness({ maxAttempts: 1 });
    await addRun(h.db, ID(1));
    await acquireSyncLease(h.db, { holderId: 'crashed-tab', nowMs: 1000, ttlMs: 1000 });
    h.drive.fail({
      when: (r) => r.path === '/drive/v3/files' && r.method === 'GET',
      times: 99,
      status: 503,
    });
    const report = await syncNow({ ...h.ctx, now: () => 5000 });
    expect(report.status).toBe('failed');
    expect((await getSyncProfile(h.db))?.lease).toBeNull();
  });

  it('a live lease held by another tab makes this one busy without any Drive traffic beyond the identity check', async () => {
    const h = await makeSyncHarness();
    await addRun(h.db, ID(1));
    await acquireSyncLease(h.db, { holderId: 'other-tab', nowMs: 1000, ttlMs: 60_000 });
    const report = await syncNow({ ...h.ctx, now: () => 2000 });
    expect(report).toEqual({ status: 'busy' });
    expect(h.drive.requests.map((r) => r.path)).toEqual(['/drive/v3/about']);
  });
});

describe('a full round trip between devices', () => {
  it("device A syncs, device B syncs and restores, and neither uploads the other's runs again", async () => {
    const a = await makeSyncHarness();
    await addRun(a.db, ID(1));
    await addRun(a.db, ID(2), 'SYNTHETIC_non_ascii_names.csv');
    expect((await syncNow(a.ctx)).status).toBe('ok');
    const b = await secondDevice(a);
    await addRun(b.db, ID(3), 'SYNTHETIC_5b_symbol_history_run1.csv');
    const report = await syncNow(b.ctx);
    expect(report.status).toBe('ok');
    if (report.status !== 'ok') return;
    expect(report.uploads.map((u) => u.runId)).toEqual([ID(3)]);
    expect((await getAllRuns(b.db)).map((r) => r.run_id).sort()).toEqual([ID(1), ID(2), ID(3)]);
    expect(jsonFiles(a)).toHaveLength(3);
    expect(Array.from(serializeEnvelope((await getRun(b.db, ID(1)))?.envelope as never))).toEqual(
      Array.from(serializeEnvelope((await getRun(a.db, ID(1)))?.envelope as never)),
    );
  });
});
