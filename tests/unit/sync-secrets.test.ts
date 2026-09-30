import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORE, type N200Database } from '../../src/core/storage/schema';
import { syncNow } from '../../src/core/sync/engine';
import { DriveError } from '../../src/core/sync/errors';
import { uploadRun } from '../../src/core/sync/upload';
import { FAKE_EMAIL } from '../support/fakeDrive';
import { addRun, closeAllDatabases, makeSyncHarness, secondDevice } from '../support/syncHarness';

afterEach(() => {
  closeAllDatabases();
  vi.restoreAllMocks();
});

async function dumpEverything(db: N200Database): Promise<string> {
  const stores = [
    STORE.runs,
    STORE.runVariants,
    STORE.quarantineItems,
    STORE.comparisonIdentity,
    STORE.syncProfile,
  ] as const;
  const dump: Record<string, unknown[]> = {};
  for (const name of stores) {
    dump[name] = (await db.getAll(name)).map((record) =>
      // Quarantined bytes are stored as Uint8Array; render them so a leak inside them is found too.
      JSON.parse(
        JSON.stringify(record, (_k, v: unknown) =>
          v instanceof Uint8Array ? new TextDecoder('latin1').decode(v) : v,
        ),
      ),
    );
  }
  return JSON.stringify(dump);
}

describe('secrets never reach storage, logs or reports', () => {
  it('after a rich sync (resumable upload, interruption, 5xx, 401, restore) no token, session URL or email is anywhere', async () => {
    const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );

    const a = await makeSyncHarness({ maxAttempts: 2 });
    await addRun(a.db, '11111111-1111-4111-8111-111111111111');
    await addRun(a.db, '22222222-2222-4222-8222-222222222222', 'SYNTHETIC_non_ascii_names.csv');
    // An interrupted resumable transfer, then a transient 5xx, then success.
    a.drive.fail({
      when: (r) => r.method === 'PUT' && r.path.startsWith('/upload/'),
      partialBytes: 30,
    });
    a.drive.fail({ when: (r) => r.path === '/drive/v3/files/generateIds', status: 503 });
    const reports: unknown[] = [];
    reports.push(await syncNow(a.ctx));

    // A device restoring from Drive, then a revoked token.
    const b = await secondDevice(a);
    reports.push(await syncNow(b.ctx));
    a.drive.revokeToken(a.token);
    reports.push(await syncNow(b.ctx));
    const failure = await uploadRun(b.ctx, '99999999-9999-4999-8999-999999999999');
    reports.push(failure);

    // What the fake saw, so we know these secrets really were in play.
    const sessionIds = a.drive.requests
      .map((r) => r.query.get('upload_id'))
      .filter((v): v is string => v !== null);
    expect(sessionIds.length).toBeGreaterThan(0);
    expect(a.drive.requests.some((r) => r.headers['authorization'] === `Bearer ${a.token}`)).toBe(
      true,
    );

    const secrets = [a.token, 'Bearer', 'upload_id', 'uploadType', FAKE_EMAIL, ...sessionIds];
    const persisted = [await dumpEverything(a.db), await dumpEverything(b.db)].join('\n');
    const rendered = JSON.stringify(reports);
    for (const secret of secrets) {
      expect(persisted).not.toContain(secret);
      expect(rendered).not.toContain(secret);
    }
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();

    // The upload session existed only in memory and is gone once the upload finished.
    expect(a.client.hasSession('run:11111111-1111-4111-8111-111111111111')).toBe(false);
  });

  it('a DriveError carries only a kind, status and short reason code: no body, URL, header or token', async () => {
    const h = await makeSyncHarness({ maxAttempts: 1 });
    h.drive.fail({ when: () => true, status: 403, reason: 'insufficientFilePermissions' });
    let caught: unknown;
    try {
      await h.client.getFile('some-file-id');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(DriveError);
    const serialized = JSON.stringify(caught) + String(caught) + (caught as DriveError).message;
    expect(serialized).not.toContain(h.token);
    expect(serialized).not.toContain('googleapis');
    expect(serialized).not.toContain('some-file-id');
    expect(serialized).not.toContain('Bearer');
  });

  it('the token provider is the only holder of a token: the client and the auth store never expose it', async () => {
    const h = await makeSyncHarness();
    await h.client.aboutUser();
    expect(JSON.stringify(h.auth)).not.toContain(h.token);
    expect(Object.keys(h.client).join(',')).not.toMatch(/token/i);
    expect(h.auth.get()).toBe('connected');
  });
});
