import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { downloadText, goTo } from './conflict-helpers';
import { makeVariant, shellPaths, startServer, type TestServer } from './dist-server';
import { chooseFile, confirmImport, FIXTURE_CRLF_THREE_ROW, fillRequiredFields } from './helpers';

const META_KEY = '/__n200-generations';

interface CacheSummary {
  [cacheName: string]: string[];
}

async function cacheSummary(page: Page): Promise<CacheSummary> {
  return page.evaluate(async () => {
    const out: Record<string, string[]> = {};
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      out[name] = (await cache.keys()).map((r) => new URL(r.url).pathname).sort();
    }
    return out;
  });
}

/** Loads the app, waits for the worker, and reloads once so the page is controlled by it. */
async function settle(page: Page, url: string, title: RegExp): Promise<void> {
  await page.goto(url);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
  await expect(page).toHaveTitle(title);
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}

async function importRun(page: Page): Promise<void> {
  await chooseFile(page, FIXTURE_CRLF_THREE_ROW);
  await fillRequiredFields(page, '2026-09-27');
  await confirmImport(page);
  await expect(page.getByText(/Committed run for 2026-09-27/)).toBeVisible();
}

async function runCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('n200-screener');
        open.onerror = () => reject(open.error as DOMException);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction('runs', 'readonly').objectStore('runs').count();
          req.onsuccess = () => {
            db.close();
            resolve(req.result);
          };
        };
      }),
  );
}

/**
 * Triggers the browser's update check and resolves when the candidate worker's install attempt
 * has ended, as reported by the worker's own lifecycle: 'installed' (now waiting), 'redundant'
 * (the install failed), or 'none' (no new worker was found). Event-driven; no sleeping.
 */
async function checkForUpdate(page: Page): Promise<'installed' | 'redundant' | 'none'> {
  return page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg === undefined) return 'none';
    let found = false;
    const outcome = new Promise<'installed' | 'redundant' | 'none'>((resolve) => {
      reg.addEventListener(
        'updatefound',
        () => {
          found = true;
          const worker = reg.installing;
          if (worker === null) {
            resolve('none');
            return;
          }
          const check = (): void => {
            if (worker.state === 'installed') resolve('installed');
            else if (worker.state === 'redundant') resolve('redundant');
          };
          worker.addEventListener('statechange', check);
          check();
        },
        { once: true },
      );
    });
    await reg.update().catch(() => undefined);
    if (!found && reg.installing === null) return 'none';
    return outcome;
  });
}

/** Counts `controllerchange` events from now on, i.e. any worker takeover in this tab. */
async function countControllerChanges(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __changes?: number };
    w.__changes = 0;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      w.__changes = (w.__changes ?? 0) + 1;
    });
  });
}

async function controllerChanges(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __changes?: number }).__changes ?? 0);
}

/** Lock requests currently queued (not granted) on the activity lock, origin-wide. */
async function pendingActivityRequests(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const state = await navigator.locks.query();
    return (state.pending ?? []).filter((l) => l.name === 'n200-activity').map((l) => l.mode ?? '');
  });
}

async function workerState(page: Page): Promise<{ waiting: boolean; installing: boolean }> {
  return page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return {
      waiting: reg?.waiting != null,
      installing: reg?.installing != null && reg.installing.state !== 'redundant',
    };
  });
}

/** How long an accepted update may take to finish and reload the tab. The app bounds activation
 * itself (a visible failure after 15 s), so a healthy run finishes far inside this; the ceiling
 * only has to tolerate several browsers starting in parallel on a busy machine. If the app shows
 * its failure notice the poll reports that instead of a title. */
const UPDATE_DEADLINE_MS = 40_000;

async function expectReleaseServed(page: Page, marker: RegExp): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          if ((await page.getByRole('alert', { name: 'App updates' }).count()) > 0) {
            return 'update-failed-notice';
          }
          return await page.title();
        } catch {
          return 'navigating';
        }
      },
      { timeout: UPDATE_DEADLINE_MS },
    )
    .toMatch(marker);
}

function updates(page: Page) {
  return page.getByRole('status', { name: 'App updates' });
}

async function withServers(
  fn: (ctx: { server: TestServer; v1: string; v2: string }) => Promise<void>,
): Promise<void> {
  const v1 = makeVariant('v1');
  const v2 = makeVariant('v2');
  const server = await startServer(v1);
  try {
    await fn({ server, v1, v2 });
  } finally {
    await server.close();
  }
}

test.describe('Step 8: registration, offline operation and cache contents', () => {
  test('registers, takes control, and reloads offline with pending runs intact', async ({
    page,
    context,
  }) => {
    await withServers(async ({ server }) => {
      await settle(page, server.url, /\(v1\)/);
      await importRun(page);
      await context.setOffline(true);
      try {
        await page.reload();
        await expect(page).toHaveTitle(/\(v1\)/);
        await expect(
          page.getByRole('complementary', { name: 'Privacy and data notices' }),
        ).toBeVisible();
        await expect(
          page
            .locator('table', { hasText: 'Sync state' })
            .getByRole('cell', { name: '2026-09-27', exact: true }),
        ).toBeVisible();
        await goTo(page, 'Compare stocks', 'Compare a stock across runs');
        await goTo(page, 'Backup', 'Backup');
        expect(await runCount(page)).toBe(1);
      } finally {
        await context.setOffline(false);
      }
    });
  });

  test('a cold launch while offline loads the shell, including when the launcher appends a query string to the start URL', async ({
    page,
    context,
  }) => {
    await withServers(async ({ server }) => {
      await settle(page, server.url, /\(v1\)/);
      await page.close();
      await context.setOffline(true);
      try {
        for (const suffix of ['/', '/?homescreen=1', '/?utm_source=pwa']) {
          const cold = await context.newPage();
          await cold.goto(`${server.url}${suffix}`);
          await expect(cold).toHaveTitle(/\(v1\)/);
          await expect(cold.getByRole('navigation', { name: 'Main' })).toBeVisible();
          await cold.close();
        }
      } finally {
        await context.setOffline(false);
      }
    });
  });

  test('Cache Storage holds exactly the versioned shell and the generation record, nothing else', async ({
    page,
  }) => {
    await withServers(async ({ server, v1 }) => {
      await settle(page, server.url, /\(v1\)/);
      await importRun(page);
      await goTo(page, 'Backup', 'Backup');
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Export backup' }).click(),
      ]);
      await downloadText(download); // a backup was produced; it must never reach a cache
      const source = await (await fetch(`${server.url}/sw.js`)).text();
      const version = /VERSION = '([0-9a-f]+)'/.exec(source)?.[1];
      expect(version).toMatch(/^[0-9a-f]{16}$/);
      expect(await cacheSummary(page)).toEqual({
        'n200-meta': [META_KEY],
        [`n200-shell-${version ?? ''}`]: shellPaths(v1),
      });
    });
  });

  test('automated installability diagnostics report no app-attributable errors', async ({
    page,
    context,
  }) => {
    await withServers(async ({ server }) => {
      await settle(page, server.url, /\(v1\)/);
      const cdp = await context.newCDPSession(page);
      await cdp.send('Page.enable');
      // Playwright's Microsoft Edge profile is InPrivate, and Edge then reports `in-incognito`
      // (installation is blocked in private windows). That is a property of the test harness,
      // not of the app, so it alone is excluded; every manifest, icon, start_url, display and
      // service-worker check must still come back clean.
      await expect
        .poll(async () =>
          (await cdp.send('Page.getInstallabilityErrors')).installabilityErrors
            .map((e) => e.errorId)
            .filter((id) => id !== 'in-incognito'),
        )
        .toEqual([]);
    });
  });
});

test.describe('Step 8: user-accepted updates', () => {
  test('a new release waits for acceptance, then updates without data loss; older caches are cleaned only when safe', async ({
    page,
  }) => {
    await withServers(async ({ server, v2 }) => {
      const v3 = makeVariant('v3');
      await settle(page, server.url, /\(v1\)/);
      await importRun(page);
      await page.evaluate(async () => {
        await (await caches.open('other-app-cache')).put('/x', new Response('keep me'));
      });
      const before = await cacheSummary(page);
      expect(Object.keys(before).filter((n) => n.startsWith('n200-shell-'))).toHaveLength(1);

      server.setRoot(v2);
      await countControllerChanges(page);
      expect(await checkForUpdate(page)).toBe('installed');
      const notice = updates(page);
      await expect(notice).toContainText('A new version of N200 Screener is ready.');
      // The consequence is stated BEFORE the user accepts, not after.
      await expect(notice).toContainText(
        'Updating reloads this page and discards any import preview you have not confirmed.',
      );
      await expect(notice).toContainText('Runs already saved on this device are not affected.');
      // Never automatic: the candidate has installed and is only waiting; no takeover has
      // happened and nothing has even asked for the activity lock.
      await expect(page).toHaveTitle(/\(v1\)/);
      expect((await workerState(page)).waiting).toBe(true);
      expect(await controllerChanges(page)).toBe(0);
      expect(await pendingActivityRequests(page)).toEqual([]);

      const axe = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
        .analyze();
      expect(
        axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
      ).toEqual([]);

      const accept = notice.getByRole('button', { name: 'Update now' });
      await accept.focus();
      await page.keyboard.press('Enter');
      await expectReleaseServed(page, /\(v2\)/);
      await expect
        .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
        .toBe(true);
      expect(await runCount(page)).toBe(1);

      const afterV2 = await cacheSummary(page);
      expect(Object.keys(afterV2).filter((n) => n.startsWith('n200-shell-'))).toHaveLength(2);
      expect(afterV2['other-app-cache']).toEqual(['/x']);

      server.setRoot(v3);
      await checkForUpdate(page);
      await expect(updates(page)).toContainText('is ready');
      await updates(page).getByRole('button', { name: 'Update now' }).click();
      await expectReleaseServed(page, /\(v3\)/);
      const afterV3 = await cacheSummary(page);
      expect(Object.keys(afterV3).filter((n) => n.startsWith('n200-shell-'))).toHaveLength(2);
      expect(
        Object.keys(afterV3).some(
          (n) => n === Object.keys(before).find((k) => k.startsWith('n200-shell-')),
        ),
      ).toBe(false);
      expect(afterV3['other-app-cache']).toEqual(['/x']);
      expect(await runCount(page)).toBe(1);
    });
  });

  test('cancelling while the update waits leaves the current release running', async ({ page }) => {
    await withServers(async ({ server, v2 }) => {
      await settle(page, server.url, /\(v1\)/);
      server.setRoot(v2);
      await checkForUpdate(page);
      await expect(updates(page)).toContainText('is ready');
      await page.evaluate(() => {
        void navigator.locks.request('n200-activity', () => new Promise<void>(() => undefined));
      });
      await updates(page).getByRole('button', { name: 'Update now' }).click();
      await expect(updates(page)).toContainText('Waiting for imports, restores and migrations');
      await updates(page).getByRole('button', { name: 'Cancel update' }).click();
      await expect(updates(page)).toContainText('is ready');
      await expect(page).toHaveTitle(/\(v1\)/);
    });
  });
});

type Activity = 'import' | 'restore' | 'migration';

async function installDigestGate(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __gate: Promise<void>; __openGate: () => void };
    w.__gate = new Promise<void>((resolve) => {
      w.__openGate = resolve;
    });
    const original = crypto.subtle.digest.bind(crypto.subtle);
    crypto.subtle.digest = async (...args: Parameters<SubtleCrypto['digest']>) => {
      await w.__gate;
      return original(...args);
    };
  });
}

async function activityLockHeld(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const state = await navigator.locks.query();
    return (state.held ?? []).filter((l) => l.name === 'n200-activity').map((l) => l.mode ?? '');
  });
}

async function wipeDatabase(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase('n200-screener');
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error as DOMException);
        req.onblocked = () => resolve();
      }),
  );
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}

async function openSecondTab(context: BrowserContext, url: string): Promise<Page> {
  const tab = await context.newPage();
  await settle(tab, url, /\(v1\)/);
  return tab;
}

test.describe('Step 8: updates wait for operations in every open tab', () => {
  for (const activity of ['import', 'restore', 'migration'] as Activity[]) {
    test(`an update accepted in one tab waits for a ${activity} running in another, then completes without data loss`, async ({
      page,
      context,
    }) => {
      await withServers(async ({ server, v2 }) => {
        const tabA = page;
        await settle(tabA, server.url, /\(v1\)/);
        const tabB = await openSecondTab(context, server.url);

        let backupText = '';
        if (activity === 'restore') {
          await importRun(tabB);
          await goTo(tabB, 'Backup', 'Backup');
          const [download] = await Promise.all([
            tabB.waitForEvent('download'),
            tabB.getByRole('button', { name: 'Export backup' }).click(),
          ]);
          backupText = await downloadText(download);
          await wipeDatabase(tabB);
          expect(await runCount(tabB)).toBe(0);
        }

        // Start the activity in tab B and hold it open.
        if (activity === 'migration') {
          await tabB.evaluate(() => {
            const w = window as unknown as { __release: () => void };
            void navigator.locks.request(
              'n200-activity',
              () =>
                new Promise<void>((resolve) => {
                  w.__release = resolve;
                }),
            );
          });
        } else {
          if (activity === 'import') {
            // Preview hashing must finish first; only the confirm-and-commit step is gated.
            await chooseFile(tabB, FIXTURE_CRLF_THREE_ROW);
            await fillRequiredFields(tabB, '2026-09-27');
            await expect(tabB.getByRole('button', { name: 'Confirm import' })).toBeEnabled();
            await installDigestGate(tabB);
            await tabB.getByRole('button', { name: 'Confirm import' }).click();
          } else {
            await goTo(tabB, 'Backup', 'Backup');
            await tabB.getByLabel('Choose a backup file').setInputFiles({
              name: 'b.json',
              mimeType: 'application/json',
              buffer: Buffer.from(backupText),
            });
            await expect(tabB.getByRole('button', { name: 'Confirm import' })).toBeVisible();
            await installDigestGate(tabB);
            await tabB.getByRole('button', { name: 'Confirm import' }).click();
          }
        }
        await expect
          .poll(() => activityLockHeld(tabB))
          .toEqual([activity === 'import' ? 'shared' : 'exclusive']);

        // A new release is deployed; tab A accepts it.
        server.setRoot(v2);
        await countControllerChanges(tabA);
        await countControllerChanges(tabB);
        expect(await checkForUpdate(tabA)).toBe('installed');
        await expect(updates(tabA)).toContainText('is ready');
        await updates(tabA).getByRole('button', { name: 'Update now' }).click();
        await expect(updates(tabA)).toContainText('Waiting for imports, restores and migrations');

        // While tab B is mid-operation nothing may activate, anywhere: tab A's request for the
        // exclusive lock is observably queued (not granted), the candidate worker is still
        // only waiting, and neither tab has seen a takeover.
        await expect.poll(() => pendingActivityRequests(tabB)).toEqual(['exclusive']);
        expect((await workerState(tabA)).waiting).toBe(true);
        expect((await workerState(tabB)).waiting).toBe(true);
        await expect(tabA).toHaveTitle(/\(v1\)/);
        await expect(tabB).toHaveTitle(/\(v1\)/);
        expect(await controllerChanges(tabA)).toBe(0);
        expect(await controllerChanges(tabB)).toBe(0);

        // The operation finishes; only then does the update proceed.
        await tabB.evaluate(() => {
          const w = window as unknown as { __openGate?: () => void; __release?: () => void };
          w.__openGate?.();
          w.__release?.();
        });
        if (activity === 'import') {
          await expect(tabB.getByText(/Committed run for 2026-09-27/)).toBeVisible();
        } else if (activity === 'restore') {
          await expect(tabB.getByText('Import complete')).toBeVisible();
        }
        await expectReleaseServed(tabA, /\(v2\)/);
        await expect(updates(tabB)).toContainText('updated in another tab');
        if (activity !== 'migration') expect(await runCount(tabB)).toBe(1);

        // The other tab keeps working until its user chooses to reload.
        await expect(tabB).toHaveTitle(/\(v1\)/);
        await updates(tabB).getByRole('button', { name: 'Reload now' }).click();
        await expectReleaseServed(tabB, /\(v2\)/);
        if (activity !== 'migration') expect(await runCount(tabB)).toBe(1);
      });
    });
  }
});

test.describe('Step 8: a replaced waiting worker', () => {
  test('an update queued behind an operation still succeeds when a newer release replaces the waiting one', async ({
    page,
  }) => {
    await withServers(async ({ server, v2 }) => {
      const v3 = makeVariant('v3');
      await settle(page, server.url, /\(v1\)/);
      server.setRoot(v2);
      expect(await checkForUpdate(page)).toBe('installed');
      await expect(updates(page)).toContainText('is ready');

      // An operation is running (held open), so the accepted update has to queue.
      await page.evaluate(() => {
        const w = window as unknown as { __release: () => void };
        void navigator.locks.request(
          'n200-activity',
          () =>
            new Promise<void>((resolve) => {
              w.__release = resolve;
            }),
        );
      });
      await expect.poll(() => activityLockHeld(page)).toEqual(['exclusive']);
      await updates(page).getByRole('button', { name: 'Update now' }).click();
      await expect(updates(page)).toContainText('Waiting for imports, restores and migrations');
      await expect.poll(() => pendingActivityRequests(page)).toEqual(['exclusive']);

      // A newer release is deployed while queued: the v2 candidate becomes redundant.
      server.setRoot(v3);
      expect(await checkForUpdate(page)).toBe('installed');
      // The waiting notice must not be replaced by a second "Update now" while queued.
      await expect(updates(page)).toContainText('Waiting for imports, restores and migrations');
      await expect(updates(page).getByRole('button', { name: 'Update now' })).toHaveCount(0);

      await page.evaluate(() => {
        (window as unknown as { __release: () => void }).__release();
      });
      // Well inside the 15 s activation timeout: the newer waiting worker is activated.
      await expectReleaseServed(page, /\(v3\)/);
    });
  });
});

test.describe('Step 8: failed installs keep the working version', () => {
  for (const fault of ['503', 'html'] as const) {
    test(`a release whose script precache fails (${fault}) never replaces the working version`, async ({
      page,
      context,
    }) => {
      await withServers(async ({ server, v2 }) => {
        await settle(page, server.url, /\(v1\)/);
        await importRun(page);
        const before = await cacheSummary(page);

        server.setRoot(v2);
        const script = shellPaths(v2).find((p) => p.endsWith('.js'));
        expect(script).toBeDefined();
        server.fail(script ?? '', fault);
        // The browser's update job finishes only after the candidate's install attempt has
        // ended: it must have failed, and left neither an installing nor a waiting worker.
        expect(await checkForUpdate(page)).toBe('redundant');
        await expect.poll(() => workerState(page)).toEqual({ waiting: false, installing: false });
        await expect(updates(page)).toHaveCount(0);
        expect(await cacheSummary(page)).toEqual(before);

        await context.setOffline(true);
        try {
          await page.reload();
          await expect(page).toHaveTitle(/\(v1\)/);
          expect(await runCount(page)).toBe(1);
        } finally {
          await context.setOffline(false);
        }
      });
    });
  }
});
