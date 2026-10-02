// Nifty 200 Screener service worker (template). `scripts/build-sw.mjs` fills in VERSION and the
// precache list after the production build; the result is emitted as dist/sw.js.
//
// Rules this worker follows:
//  - Shell only: it precaches the built app shell and serves it, nothing else. It never caches
//    user data, CSV files, backup exports, credentials, or any cross-origin response.
//  - It never writes to a cache while handling a request. Caches are filled only at install.
//  - It never activates on its own. Activation happens only when a page, holding the app's
//    exclusive activity lock, asks for it with a SKIP_WAITING message.
//  - It deletes only this app's own obsolete caches, and keeps the previous generation so that
//    pages still running an older release can keep loading their assets.
//  - It produces no diagnostics output at all.
'use strict';

const VERSION = '__N200_VERSION__';
const PRECACHE = JSON.parse('__N200_PRECACHE__');

const SHELL_CACHE_PREFIX = 'n200-shell-';
const META_CACHE = 'n200-meta';
const CACHE_NAME = SHELL_CACHE_PREFIX + VERSION;

const scopeUrl = (path) => new URL(path, self.registration.scope).href;
const PRECACHE_URLS = PRECACHE.map(scopeUrl);
const INDEX_URL = scopeUrl('index.html');
const META_URL = scopeUrl('__n200-generations');
const SCOPE_PATH = new URL(self.registration.scope).pathname;

// The only paths (relative to the scope) this worker will ever answer from a cache.
const SHELL_PATH =
  /^(index\.html|manifest\.webmanifest|icons\/[A-Za-z0-9._-]+\.png|assets\/[A-Za-z0-9._-]+\.(js|css))$/;

// A precache response must look like what its extension promises, so a host that rewrites
// missing files to an HTML page can never get that page cached under a script's URL.
const EXPECTED_TYPE = {
  js: /javascript/,
  css: /^text\/css/,
  png: /^image\/png/,
  html: /^text\/html/,
  webmanifest: /json/,
};

function hasExpectedType(url, response) {
  const extension = new URL(url).pathname.split('.').pop();
  const expected = EXPECTED_TYPE[extension];
  const actual = response.headers.get('content-type') || '';
  return expected !== undefined && expected.test(actual);
}

async function installShell() {
  const existed = await caches.has(CACHE_NAME);
  const cache = await caches.open(CACHE_NAME);
  try {
    await Promise.all(
      PRECACHE_URLS.map(async (url) => {
        const response = await fetch(new Request(url, { cache: 'reload', credentials: 'omit' }));
        if (!response.ok || response.redirected || !hasExpectedType(url, response)) {
          throw new Error('PRECACHE_FAILED');
        }
        await cache.put(url, response);
      }),
    );
  } catch (error) {
    // Never leave a half-built cache behind, and never delete a complete one that was already
    // there before this attempt.
    if (!existed) await caches.delete(CACHE_NAME);
    throw error;
  }
}

async function readGenerations(meta) {
  const empty = { current: null, previous: null };
  const hit = await meta.match(META_URL);
  if (!hit) return empty;
  try {
    const value = await hit.json();
    return {
      current: typeof value.current === 'string' ? value.current : null,
      previous: typeof value.previous === 'string' ? value.previous : null,
    };
  } catch {
    return empty;
  }
}

async function activateShell() {
  const meta = await caches.open(META_CACHE);
  const known = await readGenerations(meta);
  const next =
    known.current === CACHE_NAME ? known : { current: CACHE_NAME, previous: known.current };
  await meta.put(
    META_URL,
    new Response(JSON.stringify(next), { headers: { 'content-type': 'application/json' } }),
  );
  const keep = new Set([META_CACHE, next.current, next.previous]);
  for (const name of await caches.keys()) {
    if (name.startsWith(SHELL_CACHE_PREFIX) && !keep.has(name)) await caches.delete(name);
  }
}

function resolveShellTarget(url, isNavigation) {
  if (!url.pathname.startsWith(SCOPE_PATH)) return null;
  const relative = url.pathname.slice(SCOPE_PATH.length);
  if (isNavigation) return relative === '' || relative === 'index.html' ? INDEX_URL : null;
  return SHELL_PATH.test(relative) ? url.href : null;
}

async function serveShell(target, request) {
  const names = [CACHE_NAME];
  if (await caches.has(META_CACHE)) {
    const generations = await readGenerations(await caches.open(META_CACHE));
    if (generations.previous && generations.previous !== CACHE_NAME)
      names.push(generations.previous);
  }
  for (const name of names) {
    if (!(await caches.has(name))) continue;
    const hit = await (await caches.open(name)).match(target);
    if (hit) return hit;
  }
  return fetch(request);
}

self.addEventListener('install', (event) => {
  // No skipWaiting here: a new release waits until a page explicitly accepts it.
  event.waitUntil(installShell());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(activateShell());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (request.headers.has('authorization')) return;
  const url = new URL(request.url);
  const isNavigation = request.mode === 'navigate';
  if (url.origin !== self.location.origin) return;
  // A query string disqualifies a subresource (it could carry a token), but not a navigation:
  // launchers append one to the start URL (e.g. Android's home-screen/install launch), and the
  // shell is static, so the query is never forwarded, stored or answered with anything but the shell.
  if (url.search !== '' && !isNavigation) return;
  const target = resolveShellTarget(url, isNavigation);
  if (target === null) return;
  event.respondWith(serveShell(target, request));
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'SKIP_WAITING') return;
  if (!event.source || event.source.type !== 'window') return;
  self.skipWaiting();
});
