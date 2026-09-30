import { describe, expect, it } from 'vitest';
import { DriveError } from '../../src/core/sync/errors';
import { makeHarness } from '../support/syncHarness';

const listFolders = { q: "trashed = false and mimeType = 'application/vnd.google-apps.folder'" };

async function errorOf(promise: Promise<unknown>): Promise<DriveError> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof DriveError) return e;
    throw e;
  }
  throw new Error('expected a DriveError');
}

describe('Drive client: requests', () => {
  it('sends the bearer token and asks only for the opaque permissionId, never the email', async () => {
    const h = makeHarness();
    expect(await h.client.aboutUser()).toEqual({ permissionId: 'fake-permission-0001' });
    const [req] = h.drive.requests;
    expect(req?.headers['authorization']).toBe(`Bearer ${h.token}`);
    expect(req?.query.get('fields')).toBe('user(permissionId)');
    expect(JSON.stringify(h.drive.requests.map((r) => r.url))).not.toContain('emailAddress');
  });

  it('generates pre-assigned file IDs', async () => {
    const h = makeHarness();
    const ids = await h.client.generateIds(2);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('downloads exact bytes', async () => {
    const h = makeHarness();
    const file = h.drive.addFile({ name: 'x', content: new Uint8Array([0, 255, 10, 13, 128]) });
    expect(Array.from(await h.client.downloadFile(file.id))).toEqual([0, 255, 10, 13, 128]);
  });
});

describe('Drive client: pagination', () => {
  it('follows nextPageToken until absent, returning every file', async () => {
    const h = makeHarness();
    for (let i = 0; i < 250; i += 1) h.drive.addFile({ name: `f${String(i)}` });
    const files = await h.client.listFiles({ q: 'trashed = false' });
    expect(files).toHaveLength(250);
    expect(new Set(files.map((f) => f.id)).size).toBe(250);
    const lists = h.drive.requestsMatching((r) => r.path === '/drive/v3/files');
    expect(lists).toHaveLength(3);
    expect(lists[0]?.query.has('pageToken')).toBe(false);
    expect(lists[1]?.query.has('pageToken')).toBe(true);
  });

  it('restarts a listing from the first page exactly once when a page token is rejected', async () => {
    const h = makeHarness();
    for (let i = 0; i < 250; i += 1) h.drive.addFile({ name: `f${String(i)}` });
    let invalidated = false;
    h.drive.fail({
      times: 999,
      when: (r) => {
        if (r.query.has('pageToken') && !invalidated) {
          invalidated = true;
          h.drive.invalidatePageTokens();
        }
        return false;
      },
    });
    const files = await h.client.listFiles({ q: 'trashed = false' });
    expect(files).toHaveLength(250);
    const firstPages = h.drive.requestsMatching(
      (r) => r.path === '/drive/v3/files' && !r.query.has('pageToken'),
    );
    expect(firstPages).toHaveLength(2);
  });

  it('stops and reports if the restarted listing is rejected again (no loop)', async () => {
    const h = makeHarness();
    for (let i = 0; i < 250; i += 1) h.drive.addFile({ name: `f${String(i)}` });
    h.drive.fail({
      times: 999,
      when: (r) => {
        if (r.query.has('pageToken')) h.drive.invalidatePageTokens();
        return false;
      },
    });
    const error = await errorOf(h.client.listFiles({ q: 'trashed = false' }));
    expect(error.kind).toBe('invalid_page_token');
    const firstPages = h.drive.requestsMatching(
      (r) => r.path === '/drive/v3/files' && !r.query.has('pageToken'),
    );
    expect(firstPages).toHaveLength(2);
  });

  it('a 400 that is not about the page token is permanent and is not retried', async () => {
    const h = makeHarness();
    h.drive.fail({ when: (r) => r.path === '/drive/v3/files', status: 400, reason: 'badRequest' });
    const error = await errorOf(h.client.listFiles(listFolders));
    expect(error.kind).toBe('bad_request');
    expect(h.drive.requestsMatching((r) => r.path === '/drive/v3/files')).toHaveLength(1);
  });
});

describe('Drive client: exact error classification and retry behaviour', () => {
  const path = '/drive/v3/files/abc';
  const cases: {
    name: string;
    status: number;
    reason: string;
    kind: DriveError['kind'];
    retried: boolean;
  }[] = [
    { name: '400', status: 400, reason: 'badRequest', kind: 'bad_request', retried: false },
    { name: '401', status: 401, reason: 'authError', kind: 'unauthorized', retried: false },
    {
      name: '403 rate limit',
      status: 403,
      reason: 'rateLimitExceeded',
      kind: 'quota_or_rate_limited',
      retried: true,
    },
    {
      name: '403 user rate limit',
      status: 403,
      reason: 'userRateLimitExceeded',
      kind: 'quota_or_rate_limited',
      retried: true,
    },
    {
      name: '403 storage quota exhausted',
      status: 403,
      reason: 'storageQuotaExceeded',
      kind: 'quota_exhausted',
      retried: false,
    },
    {
      name: '403 permission',
      status: 403,
      reason: 'insufficientFilePermissions',
      kind: 'forbidden',
      retried: false,
    },
    {
      name: '403 app not authorized',
      status: 403,
      reason: 'appNotAuthorizedToFile',
      kind: 'forbidden',
      retried: false,
    },
    { name: '404', status: 404, reason: 'notFound', kind: 'not_found', retried: false },
    { name: '409', status: 409, reason: 'duplicate', kind: 'conflict', retried: false },
    {
      name: '429',
      status: 429,
      reason: 'rateLimitExceeded',
      kind: 'quota_or_rate_limited',
      retried: true,
    },
    { name: '500', status: 500, reason: 'backendError', kind: 'server_error', retried: true },
    { name: '502', status: 502, reason: 'badGateway', kind: 'server_error', retried: true },
    { name: '503', status: 503, reason: 'serviceUnavailable', kind: 'server_error', retried: true },
    { name: '504', status: 504, reason: 'gatewayTimeout', kind: 'server_error', retried: true },
  ];

  it.each(cases)('$name → $kind (retried: $retried)', async (c) => {
    const h = makeHarness({ maxAttempts: 3 });
    h.drive.fail({ when: (r) => r.path === path, times: 99, status: c.status, reason: c.reason });
    const error = await errorOf(h.client.getFile('abc'));
    expect(error.kind).toBe(c.kind);
    expect(error.status).toBe(c.status);
    expect(error.reason).toBe(c.reason);
    expect(h.drive.requestsMatching((r) => r.path === path)).toHaveLength(c.retried ? 3 : 1);
    expect(h.sleeps).toHaveLength(c.retried ? 2 : 0);
    expect(error.retryable).toBe(c.retried);
  });

  it('retries a transient failure and then succeeds, with capped, jittered exponential backoff', async () => {
    const h = makeHarness({ maxAttempts: 5, random: () => 1 });
    const file = h.drive.addFile({ id: 'abc', name: 'x' });
    h.drive.fail({ when: (r) => r.path === path, times: 4, status: 503 });
    const got = await h.client.getFile(file.id);
    expect(got.id).toBe('abc');
    // base 100, cap 1000, random=1 (full jitter): 100, 200, 400, 800
    expect(h.sleeps).toEqual([100, 200, 400, 800]);
  });

  it('caps the delay and applies jitter within [50%, 100%]', async () => {
    const low = makeHarness({ maxAttempts: 8, random: () => 0 });
    low.drive.fail({ when: (r) => r.path === path, times: 99, status: 503 });
    await errorOf(low.client.getFile('abc'));
    expect(low.sleeps).toEqual([50, 100, 200, 400, 500, 500, 500]);

    const high = makeHarness({ maxAttempts: 8, random: () => 1 });
    high.drive.fail({ when: (r) => r.path === path, times: 99, status: 503 });
    await errorOf(high.client.getFile('abc'));
    expect(high.sleeps).toEqual([100, 200, 400, 800, 1000, 1000, 1000]);
  });

  it('honours Retry-After (capped by the maximum delay)', async () => {
    const h = makeHarness({ maxAttempts: 2 });
    h.drive.addFile({ id: 'abc', name: 'x' });
    h.drive.fail({
      when: (r) => r.path === path,
      status: 429,
      reason: 'rateLimitExceeded',
      headers: { 'retry-after': '3' },
    });
    await h.client.getFile('abc');
    expect(h.sleeps).toEqual([1000]);
  });

  it('never retries a non-idempotent request, whatever the failure', async () => {
    const h = makeHarness({ maxAttempts: 5 });
    h.drive.fail({ when: (r) => r.method === 'POST', times: 99, status: 503 });
    const error = await errorOf(
      h.client.request({
        method: 'POST',
        path: '/drive/v3/files',
        body: { name: 'x' },
        idempotent: false,
      }),
    );
    expect(error.kind).toBe('server_error');
    expect(h.drive.requestsMatching((r) => r.method === 'POST')).toHaveLength(1);
    expect(h.sleeps).toEqual([]);

    const net = makeHarness({ maxAttempts: 5 });
    net.drive.fail({ when: () => true, times: 99, network: true });
    const netError = await errorOf(
      net.client.request({ method: 'POST', path: '/drive/v3/files', body: {}, idempotent: false }),
    );
    expect(netError.kind).toBe('network');
    expect(net.drive.requests).toHaveLength(1);
  });

  it('offline (network failure) is classified as network and retried only when idempotent', async () => {
    const h = makeHarness({ maxAttempts: 3 });
    h.drive.fail({ when: () => true, times: 99, network: true });
    const error = await errorOf(h.client.getFile('abc'));
    expect(error.kind).toBe('network');
    expect(h.drive.requests).toHaveLength(3);
  });

  it('a request slower than the timeout is aborted and classified as timeout', async () => {
    const h = makeHarness({ timeoutMs: 30, maxAttempts: 1 });
    h.drive.addFile({ id: 'abc', name: 'x' });
    h.drive.fail({ when: (r) => r.path === path, delayMs: 500 });
    const error = await errorOf(h.client.getFile('abc'));
    expect(error.kind).toBe('timeout');
  });

  it('user cancellation stops cleanly as cancelled: no retry, no backoff', async () => {
    const h = makeHarness({ timeoutMs: 5000, maxAttempts: 5 });
    h.drive.addFile({ id: 'abc', name: 'x' });
    h.drive.fail({ when: (r) => r.path === path, delayMs: 2000 });
    const controller = new AbortController();
    const pending = h.client.getFile('abc', { signal: controller.signal });
    setTimeout(() => {
      controller.abort();
    }, 20);
    const error = await errorOf(pending);
    expect(error.kind).toBe('cancelled');
    expect(h.drive.requests).toHaveLength(1);
    expect(h.sleeps).toEqual([]);
  });
});

describe('Drive client: 401 is an account-level event', () => {
  it('sets reconnect_required, is never retried, and carries no run identity', async () => {
    const h = makeHarness();
    h.drive.revokeToken(h.token);
    const error = await errorOf(h.client.aboutUser());
    expect(error.kind).toBe('unauthorized');
    expect(h.auth.get()).toBe('reconnect_required');
    expect(h.drive.requests).toHaveLength(1);
  });

  it('with no token available fails as unauthorized without touching the network', async () => {
    const h = makeHarness();
    h.tokens.setToken(null);
    const error = await errorOf(h.client.aboutUser());
    expect(error.kind).toBe('unauthorized');
    expect(h.auth.get()).toBe('reconnect_required');
    expect(h.drive.requests).toHaveLength(0);
  });
});

describe('Drive client: remote file state probing (404 variants)', () => {
  it('distinguishes present, trashed, permanently missing and inaccessible', async () => {
    const h = makeHarness();
    const present = h.drive.addFile({ name: 'present' });
    const trashed = h.drive.addFile({ name: 'trashed' });
    h.drive.trash(trashed.id);
    h.drive.fail({
      when: (r) => r.path === '/drive/v3/files/locked',
      status: 403,
      reason: 'appNotAuthorizedToFile',
    });

    expect((await h.client.probeFile(present.id)).state).toBe('present');
    expect((await h.client.probeFile(trashed.id)).state).toBe('trashed');
    expect((await h.client.probeFile('gone')).state).toBe('missing');
    expect((await h.client.probeFile('locked')).state).toBe('inaccessible');
  });

  it('other failures are thrown, not misreported as missing', async () => {
    const h = makeHarness({ maxAttempts: 1 });
    h.drive.fail({ when: (r) => r.path === '/drive/v3/files/x', status: 500 });
    const error = await errorOf(h.client.probeFile('x'));
    expect(error.kind).toBe('server_error');
  });
});
