import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { renderServiceWorker } from '../../scripts/build-sw.mjs';
import { ROOT } from '../helpers';

const ORIGIN = 'http://localhost:4173';
const SCOPE = `${ORIGIN}/`;
const TEMPLATE = readFileSync(join(ROOT, 'scripts', 'sw.template.js'), 'utf8');

const PRECACHE = [
  'assets/index-abc123.css',
  'assets/index-abc123.js',
  'icons/icon-192.png',
  'index.html',
  'manifest.webmanifest',
];

const CONTENT_TYPES: Record<string, string> = {
  css: 'text/css',
  js: 'text/javascript',
  png: 'image/png',
  html: 'text/html',
  webmanifest: 'application/manifest+json',
};

function contentTypeFor(url: string): string {
  return CONTENT_TYPES[url.split('.').pop() ?? ''] ?? 'application/octet-stream';
}

type Entries = Map<string, { body: string; type: string }>;
type Store = Map<string, Entries>;
type Listener = (event: unknown) => void;

interface World {
  caches: Store;
  fetched: string[];
  skipWaiting: ReturnType<typeof vi.fn>;
  install: () => Promise<void>;
  activate: () => Promise<void>;
  message: (data: unknown, source?: { type: string }) => void;
  fetchEvent: (
    request: Request,
    mode?: string,
  ) => Promise<{ intercepted: false } | { intercepted: true; response: Response }>;
}

function createWorld(options: {
  version: string;
  precache?: string[];
  caches?: Store;
  fetchImpl?: (request: Request) => Promise<Response>;
}): World {
  const store: Store = options.caches ?? new Map();
  const listeners = new Map<string, Listener>();
  const fetched: string[] = [];
  const skipWaiting = vi.fn();

  const cacheApi = {
    open(name: string) {
      let entries = store.get(name);
      if (!entries) {
        entries = new Map();
        store.set(name, entries);
      }
      const bucket = entries;
      return Promise.resolve({
        match(request: string | Request) {
          const key = typeof request === 'string' ? request : request.url;
          const hit = bucket.get(key);
          return Promise.resolve(
            hit ? new Response(hit.body, { headers: { 'content-type': hit.type } }) : undefined,
          );
        },
        async put(request: string | Request, response: Response) {
          const key = typeof request === 'string' ? request : request.url;
          bucket.set(key, {
            body: await response.text(),
            type: response.headers.get('content-type') ?? '',
          });
        },
      });
    },
    has: (name: string) => Promise.resolve(store.has(name)),
    delete: (name: string) => Promise.resolve(store.delete(name)),
    keys: () => Promise.resolve([...store.keys()]),
  };

  const defaultFetch = (request: Request): Promise<Response> =>
    Promise.resolve(
      new Response(`body:${request.url}`, {
        headers: { 'content-type': contentTypeFor(request.url) },
      }),
    );

  const sandbox = {
    self: {
      registration: { scope: SCOPE },
      location: { origin: ORIGIN },
      addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
      skipWaiting,
    },
    caches: cacheApi,
    fetch: (request: Request) => {
      fetched.push(request.url);
      return (options.fetchImpl ?? defaultFetch)(request);
    },
    Request,
    Response,
    URL,
  };
  vm.runInNewContext(
    renderServiceWorker(TEMPLATE, options.version, options.precache ?? PRECACHE),
    sandbox,
  );

  const lifecycle = async (type: string): Promise<void> => {
    let pending: Promise<unknown> = Promise.resolve();
    listeners.get(type)?.({
      waitUntil: (p: Promise<unknown>) => {
        pending = p;
      },
    });
    await pending;
  };

  return {
    caches: store,
    fetched,
    skipWaiting,
    install: () => lifecycle('install'),
    activate: () => lifecycle('activate'),
    message: (data, source = { type: 'window' }) => {
      listeners.get('message')?.({ data, source });
    },
    fetchEvent: async (request, mode = 'cors') => {
      let response: Promise<Response> | undefined;
      // Only `method`, `url`, `mode` and `headers` are read by the worker.
      const shaped = {
        method: request.method,
        url: request.url,
        mode,
        headers: request.headers,
      };
      listeners.get('fetch')?.({
        request: shaped,
        respondWith: (p: Promise<Response>) => {
          response = p;
        },
      });
      return response === undefined
        ? { intercepted: false }
        : { intercepted: true, response: await response };
    },
  };
}

const get = (path: string, init?: RequestInit): Request => new Request(`${ORIGIN}${path}`, init);

describe('service worker: install', () => {
  it('precaches exactly the shell list into a versioned cache and does not skip waiting', async () => {
    const world = createWorld({ version: 'v1hash' });
    await world.install();
    expect([...world.caches.keys()]).toEqual(['n200-shell-v1hash']);
    const cached = [...(world.caches.get('n200-shell-v1hash')?.keys() ?? [])].sort();
    expect(cached).toEqual(PRECACHE.map((p) => `${SCOPE}${p}`).sort());
    expect(world.skipWaiting).not.toHaveBeenCalled();
  });

  it('fetches with cache:reload and credentials omitted', async () => {
    const seen: { cache: string; credentials: string }[] = [];
    const world = createWorld({
      version: 'v1',
      fetchImpl: (request) => {
        seen.push({ cache: request.cache, credentials: request.credentials });
        return Promise.resolve(
          new Response('x', { headers: { 'content-type': contentTypeFor(request.url) } }),
        );
      },
    });
    await world.install();
    expect(seen.length).toBe(PRECACHE.length);
    for (const s of seen) expect(s).toEqual({ cache: 'reload', credentials: 'omit' });
  });

  it.each([
    ['a 503 response', () => new Response('down', { status: 503 })],
    [
      'an HTML fallback served for a script (SPA rewrite)',
      () => new Response('<html>', { headers: { 'content-type': 'text/html' } }),
    ],
  ])('a failed precache (%s) rejects install and leaves no half-built cache', async (_n, bad) => {
    const world = createWorld({
      version: 'v2',
      fetchImpl: (request) =>
        Promise.resolve(
          request.url.endsWith('.js')
            ? bad()
            : new Response('ok', { headers: { 'content-type': contentTypeFor(request.url) } }),
        ),
    });
    await expect(world.install()).rejects.toThrow();
    expect([...world.caches.keys()]).toEqual([]);
  });

  it('a failed install never deletes an already-complete cache of the same version', async () => {
    const existing: Store = new Map([
      ['n200-shell-v3', new Map([[`${SCOPE}index.html`, { body: 'old', type: 'text/html' }]])],
    ]);
    const world = createWorld({
      version: 'v3',
      caches: existing,
      fetchImpl: () => Promise.reject(new Error('offline')),
    });
    await expect(world.install()).rejects.toThrow();
    expect(world.caches.has('n200-shell-v3')).toBe(true);
  });
});

describe('service worker: activate', () => {
  it('keeps the current and one previous generation, deleting only older n200 shell caches', async () => {
    const store: Store = new Map([
      ['other-app-cache', new Map()],
      ['workbox-precache-v2', new Map()],
    ]);
    for (const version of ['gen1', 'gen2', 'gen3']) {
      const world = createWorld({ version, caches: store });
      await world.install();
      await world.activate();
    }
    expect([...store.keys()].sort()).toEqual(
      [
        'n200-meta',
        'n200-shell-gen2',
        'n200-shell-gen3',
        'other-app-cache',
        'workbox-precache-v2',
      ].sort(),
    );
  });

  it('never deletes caches that do not belong to this app', async () => {
    const store: Store = new Map([
      ['someone-elses-cache', new Map()],
      ['n200-shell-stale', new Map()],
    ]);
    const world = createWorld({ version: 'fresh', caches: store });
    await world.install();
    await world.activate();
    expect(store.has('someone-elses-cache')).toBe(true);
    expect(store.has('n200-shell-fresh')).toBe(true);
  });
});

describe('service worker: fetch allowlist', () => {
  async function installed(): Promise<World> {
    const world = createWorld({ version: 'live' });
    await world.install();
    await world.activate();
    return world;
  }

  it('serves precached shell assets from the cache, not the network', async () => {
    const world = await installed();
    const before = world.fetched.length;
    const result = await world.fetchEvent(get('/assets/index-abc123.js'));
    expect(result.intercepted).toBe(true);
    expect(world.fetched.length).toBe(before);
    if (result.intercepted) expect(await result.response.text()).toContain('index-abc123.js');
  });

  it.each(['/', '/index.html'])('serves index.html for navigations to %s', async (path) => {
    const world = await installed();
    const result = await world.fetchEvent(get(path), 'navigate');
    expect(result.intercepted).toBe(true);
    if (result.intercepted) expect(await result.response.text()).toContain('index.html');
  });

  it.each(['/?homescreen=1', '/?utm_source=pwa', '/index.html?x=1'])(
    'serves index.html for cold-launch navigations with query strings to %s',
    async (path) => {
      const world = await installed();
      const result = await world.fetchEvent(get(path), 'navigate');
      expect(result.intercepted).toBe(true);
      if (result.intercepted) expect(await result.response.text()).toContain('index.html');
    },
  );

  it.each([
    ['a non-GET request', () => get('/index.html', { method: 'POST', body: 'x' })],
    ['a cross-origin request', () => new Request('https://example.com/assets/index-abc123.js')],
    [
      'a request carrying an Authorization header',
      () => get('/assets/index-abc123.js', { headers: { Authorization: 'Bearer x' } }),
    ],
    ['a shell path with a query string', () => get('/assets/index-abc123.js?access_token=abc')],
    ['a backup export path', () => get('/n200-backup-v1-2026.json')],
    ['a CSV path', () => get('/samples/export.csv')],
    ['an unrelated app path', () => get('/api/drive/files')],
    ['the Drive API', () => new Request('https://www.googleapis.com/drive/v3/files?fields=id')],
    [
      'a Drive resumable session URL',
      () =>
        new Request(
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=x',
        ),
    ],
    ['the Google sign-in script', () => new Request('https://accounts.google.com/gsi/client')],
  ])('does not intercept %s', async (_n, make) => {
    const world = await installed();
    expect((await world.fetchEvent(make())).intercepted).toBe(false);
  });

  it('never writes to any cache while handling fetches', async () => {
    const world = await installed();
    const snapshot = (): string =>
      JSON.stringify([...world.caches.entries()].map(([n, m]) => [n, [...m.keys()]]));
    const before = snapshot();
    await world.fetchEvent(get('/assets/index-abc123.js'));
    await world.fetchEvent(get('/some/other.js'));
    // A shell-shaped path that is in no cache goes to the network and is still not stored.
    const miss = await world.fetchEvent(get('/assets/not-cached-999.js'));
    expect(miss.intercepted).toBe(true);
    if (miss.intercepted) expect(await miss.response.text()).toContain('not-cached-999.js');
    expect(snapshot()).toBe(before);
  });

  it('serves an old client its old hashed asset from the retained previous generation', async () => {
    const store: Store = new Map();
    const build = (version: string, asset: string): World =>
      createWorld({ version, precache: [`assets/${asset}`, 'index.html'], caches: store });
    const gen1 = build('gen1', 'old-111.js');
    await gen1.install();
    await gen1.activate();
    const gen2 = build('gen2', 'new-222.js');
    await gen2.install();
    await gen2.activate();
    expect((await gen2.fetchEvent(get('/assets/old-111.js'))).intercepted).toBe(true);
    expect((await gen2.fetchEvent(get('/assets/new-222.js'))).intercepted).toBe(true);
    const gen3 = build('gen3', 'newer-333.js');
    await gen3.install();
    await gen3.activate();
    expect(store.has('n200-shell-gen1')).toBe(false);
    expect(store.has('n200-shell-gen2')).toBe(true);
  });
});

describe('service worker: update messages', () => {
  it('skips waiting only when asked by a window client', () => {
    const world = createWorld({ version: 'msg' });
    world.message({ type: 'SKIP_WAITING' }, { type: 'worker' });
    world.message({ type: 'SOMETHING_ELSE' });
    world.message('SKIP_WAITING');
    expect(world.skipWaiting).not.toHaveBeenCalled();
    world.message({ type: 'SKIP_WAITING' });
    expect(world.skipWaiting).toHaveBeenCalledTimes(1);
  });
});
