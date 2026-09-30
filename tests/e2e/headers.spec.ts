import { expect, test } from '@playwright/test';

// The preview server serves the `/*` block of public/_headers. This proves the app loads,
// installs its service worker and runs under those headers; it does not prove Cloudflare applies
// them (that is an owner check after a real deploy).
test.describe('host security headers', () => {
  test('the page is served with the required headers and still works under them', async ({
    page,
  }) => {
    const response = await page.goto('/');
    const h = response?.headers() ?? {};
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['referrer-policy']).toBe('no-referrer');
    expect(h['content-security-policy']).toBe("frame-ancestors 'none'");
    expect(h['cross-origin-opener-policy']).toBe('same-origin-allow-popups');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('the cache rules are applied per path: shell and service worker revalidate, hashed assets are immutable', async ({
    page,
  }) => {
    await page.goto('/');
    const assetPath = await page.evaluate(
      () => document.querySelector<HTMLScriptElement>('script[src*="/assets/"]')?.src ?? '',
    );
    expect(assetPath).toContain('/assets/');
    const get = async (path: string) => (await page.request.get(path)).headers();
    expect((await get('/sw.js'))['cache-control']).toBe('no-cache');
    expect((await get('/manifest.webmanifest'))['cache-control']).toBe('no-cache');
    expect((await get('/'))['cache-control']).toBe('no-cache');
    expect((await get(new URL(assetPath).pathname))['cache-control']).toBe(
      'public, max-age=31536000, immutable',
    );
    // Every response, including static files, carries the global protections.
    expect((await get('/sw.js'))['x-content-type-options']).toBe('nosniff');
  });
});
