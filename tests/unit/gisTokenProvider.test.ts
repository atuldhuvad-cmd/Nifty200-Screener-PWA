import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOAuthStateStore } from '../../src/core/sync/auth';
import {
  createGisTokenProvider,
  DRIVE_FILE_SCOPE,
  type GoogleOAuth2,
  type GoogleTokenClientConfig,
  type GoogleTokenResponse,
} from '../../src/core/sync/gisTokenProvider';

afterEach(() => {
  vi.unstubAllGlobals();
});

type Behave = (config: GoogleTokenClientConfig) => void;

function fakeOAuth2() {
  const calls = {
    init: [] as GoogleTokenClientConfig[],
    request: 0,
    revoke: [] as string[],
  };
  const state: { behave: Behave; revokeMode: 'confirm' | 'hang' } = {
    behave: (config) => {
      config.callback({
        access_token: 'fake-access-token-1',
        expires_in: 3600,
        scope: DRIVE_FILE_SCOPE,
      });
    },
    revokeMode: 'confirm',
  };
  const api: GoogleOAuth2 = {
    initTokenClient(config) {
      calls.init.push(config);
      return {
        requestAccessToken() {
          calls.request += 1;
          queueMicrotask(() => {
            state.behave(config);
          });
        },
      };
    },
    revoke(token, done) {
      calls.revoke.push(token);
      if (state.revokeMode === 'confirm') done?.({ successful: true });
    },
  };
  return { api, calls, state };
}

function setup(options: { now?: () => number; revokeTimeoutMs?: number } = {}) {
  const fake = fakeOAuth2();
  const auth = createOAuthStateStore('disconnected');
  const loads = { count: 0 };
  let loadFails = false;
  let available = true;
  const provider = createGisTokenProvider({
    clientId: 'test-client.apps.googleusercontent.com',
    auth,
    loadScript: () => {
      loads.count += 1;
      return loadFails ? Promise.reject(new Error('blocked')) : Promise.resolve();
    },
    getOAuth2: () => (available ? fake.api : undefined),
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(options.revokeTimeoutMs !== undefined ? { revokeTimeoutMs: options.revokeTimeoutMs } : {}),
  });
  return {
    fake,
    auth,
    loads,
    provider,
    failLoad: (v: boolean) => {
      loadFails = v;
    },
    setAvailable: (v: boolean) => {
      available = v;
    },
  };
}

describe('lazy loading', () => {
  it('loads nothing and requests no token until connect() is called', async () => {
    const t = setup();
    expect(await t.provider.getAccessToken()).toBeNull();
    expect(t.provider.hasToken()).toBe(false);
    expect(t.loads.count).toBe(0);
    expect(t.fake.calls.init).toHaveLength(0);
    expect(t.auth.get()).toBe('disconnected');
  });

  it('loads the script once, however many times the user connects', async () => {
    const t = setup();
    await t.provider.connect();
    await t.provider.connect();
    expect(t.loads.count).toBe(1);
  });
});

describe('connect', () => {
  it('requests only the drive.file scope, with no email or identity hint, and connects', async () => {
    const t = setup();
    const states: string[] = [];
    t.auth.subscribe((s) => states.push(s));
    expect(await t.provider.connect()).toEqual({ status: 'connected' });
    expect(states).toEqual(['authorizing', 'connected']);
    expect(await t.provider.getAccessToken()).toBe('fake-access-token-1');
    const config = t.fake.calls.init[0];
    expect(config?.client_id).toBe('test-client.apps.googleusercontent.com');
    expect(config?.scope).toBe(DRIVE_FILE_SCOPE);
    expect(Object.keys(config ?? {}).sort()).toEqual(
      ['callback', 'client_id', 'error_callback', 'scope'].sort(),
    );
  });

  it('a response that does not grant drive.file is refused and no token is kept', async () => {
    const t = setup();
    t.fake.state.behave = (c) => {
      c.callback({
        access_token: 'partial',
        expires_in: 3600,
        scope: 'https://www.googleapis.com/auth/drive.readonly',
      });
    };
    expect(await t.provider.connect()).toEqual({ status: 'scope_missing' });
    expect(t.provider.hasToken()).toBe(false);
    expect(await t.provider.getAccessToken()).toBeNull();
    expect(t.auth.get()).toBe('disconnected');
  });

  it.each([
    ['the user closes the popup', { type: 'popup_closed' }, { status: 'cancelled' }],
    ['the browser blocks the popup', { type: 'popup_failed_to_open' }, { status: 'popup_blocked' }],
    ['an unknown popup error occurs', { type: 'unknown' }, { status: 'error', code: 'unknown' }],
  ])('when %s, no token is kept and the state is disconnected', async (_n, error, expected) => {
    const t = setup();
    t.fake.state.behave = (c) => {
      c.error_callback?.(error);
    };
    expect(await t.provider.connect()).toEqual(expected);
    expect(t.provider.hasToken()).toBe(false);
    expect(t.auth.get()).toBe('disconnected');
  });

  it.each([
    ['access_denied', { status: 'denied' }],
    ['something_else', { status: 'error', code: 'something_else' }],
  ])('a token response with error %s is reported and no token is kept', async (code, expected) => {
    const t = setup();
    t.fake.state.behave = (c) => {
      c.callback({ error: code } satisfies GoogleTokenResponse);
    };
    expect(await t.provider.connect()).toEqual(expected);
    expect(t.provider.hasToken()).toBe(false);
  });

  it('a response with no access token is an error', async () => {
    const t = setup();
    t.fake.state.behave = (c) => {
      c.callback({ scope: DRIVE_FILE_SCOPE });
    };
    expect(await t.provider.connect()).toEqual({ status: 'error', code: 'NO_ACCESS_TOKEN' });
  });

  it('a failing script load is reported and can be retried', async () => {
    const t = setup();
    t.failLoad(true);
    expect(await t.provider.connect()).toEqual({ status: 'script_failed' });
    expect(t.auth.get()).toBe('disconnected');
    t.failLoad(false);
    expect(await t.provider.connect()).toEqual({ status: 'connected' });
    expect(t.loads.count).toBe(2);
  });

  it('a script that loads but does not provide the API is a script failure', async () => {
    const t = setup();
    t.setAvailable(false);
    expect(await t.provider.connect()).toEqual({ status: 'script_failed' });
  });

  it('concurrent connect() calls share one popup request and one result', async () => {
    const t = setup();
    const [a, b] = await Promise.all([t.provider.connect(), t.provider.connect()]);
    expect(a).toEqual(b);
    expect(t.fake.calls.request).toBe(1);
  });
});

describe('expiry and 401', () => {
  it('a token is valid until shortly before Google says it expires, then reconnect_required', async () => {
    let now = 1_000_000;
    const t = setup({ now: () => now });
    await t.provider.connect();
    now += (3600 - 61) * 1000;
    expect(await t.provider.getAccessToken()).toBe('fake-access-token-1');
    now += 2000; // inside the 60 s safety margin
    expect(await t.provider.getAccessToken()).toBeNull();
    expect(t.auth.get()).toBe('reconnect_required');
    expect(t.provider.hasToken()).toBe(false);
  });

  it('a 401 (the client setting reconnect_required) discards the token', async () => {
    const t = setup();
    await t.provider.connect();
    expect(t.provider.hasToken()).toBe(true);
    t.auth.set('reconnect_required');
    expect(t.provider.hasToken()).toBe(false);
    expect(await t.provider.getAccessToken()).toBeNull();
  });

  it('cancelling a reconnect keeps the state at reconnect_required', async () => {
    const t = setup();
    await t.provider.connect();
    t.auth.set('reconnect_required');
    t.fake.state.behave = (c) => {
      c.error_callback?.({ type: 'popup_closed' });
    };
    expect(await t.provider.connect()).toEqual({ status: 'cancelled' });
    expect(t.auth.get()).toBe('reconnect_required');
  });

  it('reconnecting after expiry works', async () => {
    let now = 0;
    const t = setup({ now: () => now });
    await t.provider.connect();
    now += 4000 * 1000;
    expect(await t.provider.getAccessToken()).toBeNull();
    t.fake.state.behave = (c) => {
      c.callback({ access_token: 'second-token', expires_in: 3600, scope: DRIVE_FILE_SCOPE });
    };
    expect(await t.provider.connect()).toEqual({ status: 'connected' });
    expect(await t.provider.getAccessToken()).toBe('second-token');
    expect(t.auth.get()).toBe('connected');
  });
});

describe('disconnect and revoke', () => {
  it('revokes the token, clears it and disconnects', async () => {
    const t = setup();
    await t.provider.connect();
    expect(await t.provider.disconnect()).toEqual({ status: 'revoked' });
    expect(t.fake.calls.revoke).toEqual(['fake-access-token-1']);
    expect(t.provider.hasToken()).toBe(false);
    expect(t.auth.get()).toBe('disconnected');
  });

  it('an unconfirmed revoke still discards the token locally and says so', async () => {
    const t = setup({ revokeTimeoutMs: 20 });
    await t.provider.connect();
    t.fake.state.revokeMode = 'hang';
    expect(await t.provider.disconnect()).toEqual({ status: 'unconfirmed' });
    expect(t.provider.hasToken()).toBe(false);
    expect(t.auth.get()).toBe('disconnected');
  });

  it('with nothing to revoke, no revoke request is made', async () => {
    const t = setup();
    expect(await t.provider.disconnect()).toEqual({ status: 'nothing_to_revoke' });
    expect(t.fake.calls.revoke).toEqual([]);
    expect(t.loads.count).toBe(0);
  });
});

describe('the token lives in memory only', () => {
  it('never touches localStorage or sessionStorage through connect, expiry and disconnect', async () => {
    const trap = new Proxy(
      {},
      {
        get: () => {
          throw new Error('storage was touched');
        },
        set: () => {
          throw new Error('storage was touched');
        },
      },
    );
    vi.stubGlobal('localStorage', trap);
    vi.stubGlobal('sessionStorage', trap);
    let now = 0;
    const t = setup({ now: () => now });
    await t.provider.connect();
    await t.provider.getAccessToken();
    now += 4000 * 1000;
    await t.provider.getAccessToken();
    await t.provider.connect();
    await t.provider.disconnect();
    expect(JSON.stringify(t.provider)).not.toContain('fake-access-token');
  });
});
