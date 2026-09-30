import type { BrowserContext, Page } from '@playwright/test';
import type { FakeDrive } from '../support/fakeDrive';

/**
 * A local stand-in for Google, for browser tests. It answers the two Google origins the page's
 * CSP allows, entirely inside Playwright: the Google Identity Services script is a small stub,
 * and every Drive API request is served by the in-repo FakeDrive (synthetic data only). Nothing
 * here talks to the real Google.
 */

export const E2E_CLIENT_ID = 'n200-e2e-client.apps.googleusercontent.com';

const GIS_STUB = `
window.google = { accounts: { oauth2: {
  initTokenClient: function (config) {
    return { requestAccessToken: function () {
      var g = window.__gis;
      g.requests = (g.requests || 0) + 1;
      g.lastConfig = { client_id: config.client_id, scope: config.scope };
      setTimeout(function () {
        if (g.behavior === 'popup_closed') config.error_callback({ type: 'popup_closed' });
        else if (g.behavior === 'popup_blocked') config.error_callback({ type: 'popup_failed_to_open' });
        else if (g.behavior === 'denied') config.callback({ error: 'access_denied' });
        else config.callback({
          access_token: g.token, expires_in: 3600,
          scope: 'https://www.googleapis.com/auth/drive.file'
        });
      }, 0);
    } };
  },
  revoke: function (token, done) {
    window.__gis.revoked = token;
    if (done) done({ successful: true });
  }
} } };
`;

export interface MockGoogle {
  /** Requests the page made to each Google origin. */
  counts: { gis: number; drive: number };
}

function corsHeaders(origin: string | undefined, requested?: string): Record<string, string> {
  return {
    'access-control-allow-origin': origin ?? '*',
    'access-control-expose-headers': 'location, range, content-type',
    ...(requested !== undefined ? { 'access-control-allow-headers': requested } : {}),
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, OPTIONS',
    'access-control-max-age': '600',
    vary: 'origin',
  };
}

export async function installMockGoogle(
  context: BrowserContext,
  drive: FakeDrive,
  initial: { token: string },
): Promise<MockGoogle> {
  const counts = { gis: 0, drive: 0 };

  await context.addInitScript(
    ({ token }) => {
      (window as unknown as { __gis: unknown }).__gis = { behavior: 'grant', token, requests: 0 };
      // Record any Content Security Policy violation, for the tests to assert there are none.
      const violations: string[] = [];
      (window as unknown as { __csp: string[] }).__csp = violations;
      document.addEventListener('securitypolicyviolation', (e) => {
        violations.push(`${e.violatedDirective} ${e.blockedURI}`);
      });
    },
    { token: initial.token },
  );

  await context.route('https://accounts.google.com/gsi/client', async (route) => {
    counts.gis += 1;
    await route.fulfill({ status: 200, contentType: 'text/javascript', body: GIS_STUB });
  });

  await context.route('https://www.googleapis.com/**', async (route) => {
    counts.drive += 1;
    const request = route.request();
    const headers = request.headers();
    const origin = headers['origin'];
    if (request.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: corsHeaders(origin, headers['access-control-request-headers']),
      });
      return;
    }
    const contentType = headers['content-type'] ?? '';
    const body: string | Buffer | undefined = contentType.includes('json')
      ? (request.postData() ?? undefined)
      : (request.postDataBuffer() ?? undefined);
    try {
      const response = await drive.fetch(request.url(), {
        method: request.method(),
        headers,
        ...(body !== undefined ? { body: body as BodyInit } : {}),
      });
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      await route.fulfill({
        status: response.status,
        headers: { ...responseHeaders, ...corsHeaders(origin) },
        body: Buffer.from(await response.arrayBuffer()),
      });
    } catch {
      await route.abort('failed'); // the fake simulated a network failure
    }
  });

  return { counts };
}

/** Everything the page could have persisted, as one searchable string. */
export async function dumpBrowserStorage(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const out: Record<string, unknown> = {
      localStorage: { ...localStorage },
      sessionStorage: { ...sessionStorage },
      cookie: document.cookie,
    };

    const dbs = await indexedDB.databases();
    const idb: Record<string, unknown> = {};
    for (const info of dbs) {
      if (info.name === undefined) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(info.name as string);
        req.onsuccess = () => {
          resolve(req.result);
        };
        req.onerror = () => {
          reject(req.error as DOMException);
        };
      });
      const stores: Record<string, unknown> = {};
      for (const name of Array.from(db.objectStoreNames)) {
        stores[name] = await new Promise((resolve, reject) => {
          const req = db.transaction(name, 'readonly').objectStore(name).getAll();
          req.onsuccess = () => {
            resolve(
              JSON.parse(
                JSON.stringify(req.result, (_k, v: unknown) =>
                  v instanceof Uint8Array ? new TextDecoder('latin1').decode(v) : v,
                ),
              ),
            );
          };
          req.onerror = () => {
            reject(req.error as DOMException);
          };
        });
      }
      db.close();
      idb[info.name] = stores;
    }
    out['indexedDB'] = idb;

    const caches_: Record<string, unknown> = {};
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      const entries: Record<string, string> = {};
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        entries[request.url] = response ? (await response.text()).slice(0, 4000) : '';
      }
      caches_[name] = entries;
    }
    out['cacheStorage'] = caches_;
    return JSON.stringify(out);
  });
}

export async function cspViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
}
