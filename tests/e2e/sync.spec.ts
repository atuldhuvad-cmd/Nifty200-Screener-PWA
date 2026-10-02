import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { jcsHash } from './conflict-helpers';
import { chooseFile, confirmImport, FIXTURE_CRLF_THREE_ROW, fillRequiredFields } from './helpers';
import {
  cspViolations,
  dumpBrowserStorage,
  installMockGoogle,
  type MockGoogle,
} from './mockGoogle';
import { FAKE_EMAIL, FakeDrive } from '../support/fakeDrive';

const BASE = 'http://localhost:4321';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

interface Device {
  context: BrowserContext;
  page: Page;
  google: MockGoogle;
  token: string;
  console: string[];
}

async function newDevice(browser: Browser, drive: FakeDrive, token?: string): Promise<Device> {
  const context = await browser.newContext({ baseURL: BASE });
  const issued = token ?? drive.issueToken();
  const google = await installMockGoogle(context, drive, { token: issued });
  const page = await context.newPage();
  const logged: string[] = [];
  page.on('console', (m) => logged.push(m.text()));
  page.on('pageerror', (e) => logged.push(e.message));
  return { context, page, google, token: issued, console: logged };
}

async function importRun(page: Page, date = '2026-09-27'): Promise<void> {
  await page.goto('/');
  await chooseFile(page, FIXTURE_CRLF_THREE_ROW);
  await fillRequiredFields(page, date);
  await confirmImport(page);
  await expect(page.getByText(new RegExp(`Committed run for ${date}`))).toBeVisible();
}

async function openSync(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Sync', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Google Drive sync' })).toBeVisible();
}

async function connect(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Connect Google Drive' }).click();
  await expect(page.getByRole('status', { name: 'Connection status' })).toContainText('Connected');
}

async function syncNow(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByLabel('Last sync result')).toBeVisible();
}

const result = (page: Page) => page.getByLabel('Last sync result');
const jsonFiles = (drive: FakeDrive) =>
  [...drive.files.values()].filter((f) => f.mimeType === 'application/json');

async function expectClean(device: Device): Promise<void> {
  expect(await cspViolations(device.page)).toEqual([]);
  expect(device.console.filter((l) => /content security policy|refused to/i.test(l))).toEqual([]);
}

test.describe('Step 10: nothing reaches Google until the user connects', () => {
  test('no Google request is made while browsing every view; only Connect loads the script', async ({
    browser,
  }) => {
    const drive = new FakeDrive();
    const d = await newDevice(browser, drive);
    await importRun(d.page);
    for (const link of ['Compare stocks', 'Backup', 'Needs review', 'Sync']) {
      await d.page.getByRole('link', { name: link, exact: true }).click();
      await d.page.waitForTimeout(150);
    }
    expect(d.google.counts).toEqual({ gis: 0, drive: 0 });
    expect(await d.page.evaluate(() => 'google' in window)).toBe(false);

    await connect(d.page);
    expect(d.google.counts.gis).toBe(1);
    expect(d.google.counts.drive).toBe(0); // connecting alone does not sync
    await expectClean(d);
    await d.context.close();
  });

  test('the script is requested with the approved scope only', async ({ browser }) => {
    const drive = new FakeDrive();
    const d = await newDevice(browser, drive);
    await d.page.goto('/#/sync');
    await connect(d.page);
    const config = await d.page.evaluate(
      () => (window as unknown as { __gis: { lastConfig: unknown } }).__gis.lastConfig,
    );
    expect(config).toMatchObject({
      scope: 'https://www.googleapis.com/auth/drive.file',
    });
    expect((config as { client_id: string }).client_id).toMatch(
      /n200-e2e-client\.apps\.googleusercontent\.com|\.apps\.googleusercontent\.com/,
    );
    await d.context.close();
  });
});

test.describe('Step 10: connect, sync and restore through the UI', () => {
  test('connect, then Sync now uploads the run; nothing happens without the click', async ({
    browser,
  }) => {
    const drive = new FakeDrive();
    const d = await newDevice(browser, drive);
    await importRun(d.page);
    await openSync(d.page);
    await connect(d.page);
    expect(jsonFiles(drive)).toHaveLength(0);
    await syncNow(d.page);
    await expect(result(d.page)).toContainText('Sync finished.');
    await expect(result(d.page)).toContainText('Uploaded: 1');
    await syncNow(d.page);
    await expect(result(d.page)).toContainText('Files checked in Drive: 1');
    await expect(result(d.page)).toContainText('Unchanged: 1');
    expect(jsonFiles(drive)).toHaveLength(1);
    expect(jsonFiles(drive)[0]?.name).toMatch(/^run-[0-9a-f-]{36}\.json$/);

    await d.page.getByRole('link', { name: 'Run history' }).click();
    const history = d.page.locator('table', { hasText: 'Sync state' });
    await expect(history.getByRole('cell', { name: 'synced', exact: true })).toBeVisible();
    await expectClean(d);
    await d.context.close();
  });

  test('a fresh device restores every synced run from Drive', async ({ browser }) => {
    const drive = new FakeDrive();
    const a = await newDevice(browser, drive);
    await importRun(a.page, '2026-09-27');
    await openSync(a.page);
    await connect(a.page);
    await syncNow(a.page);

    const b = await newDevice(browser, drive);
    await b.page.goto('/#/sync');
    await connect(b.page);
    await syncNow(b.page);
    await expect(result(b.page)).toContainText('Restored from Drive: 1');
    await b.page.getByRole('link', { name: 'Run history' }).click();
    const history = b.page.locator('table', { hasText: 'Sync state' });
    await expect(history.getByRole('cell', { name: '2026-09-27', exact: true })).toBeVisible();
    await expect(history.getByRole('cell', { name: 'synced', exact: true })).toBeVisible();
    expect(jsonFiles(drive)).toHaveLength(1); // restored, not duplicated
    await expectClean(b);
    await a.context.close();
    await b.context.close();
  });

  test('a divergent remote copy is kept as a conflict for review', async ({ browser }) => {
    const drive = new FakeDrive();
    const d = await newDevice(browser, drive);
    await importRun(d.page);
    await openSync(d.page);
    await connect(d.page);
    await syncNow(d.page);
    const file = jsonFiles(drive)[0];
    if (!file) throw new Error('no file');
    const edited = JSON.parse(new TextDecoder().decode(file.content)) as Record<string, unknown>;
    edited['query_text'] = 'edited on drive';
    delete edited['envelope_sha256'];
    edited['envelope_sha256'] = jcsHash(edited);
    drive.setContent(file.id, JSON.stringify(edited));

    await syncNow(d.page);
    await expect(result(d.page)).toContainText('Conflicts kept for review: 1');
    await d.page.getByRole('link', { name: 'Needs review' }).click();
    await expect(d.page.getByRole('article', { name: /^Conflict: run / })).toBeVisible();
    await d.context.close();
  });
});

test.describe('Step 10: runs missing from Drive', () => {
  async function missingDevice(browser: Browser) {
    const drive = new FakeDrive();
    const d = await newDevice(browser, drive);
    await importRun(d.page);
    await openSync(d.page);
    await connect(d.page);
    await syncNow(d.page);
    const file = jsonFiles(drive)[0];
    if (!file) throw new Error('no file');
    drive.deletePermanently(file.id);
    await syncNow(d.page);
    await expect(result(d.page)).toContainText('Missing from Drive: 1');
    return { drive, d, oldId: file.id };
  }

  test('Restore to Drive re-uploads under a new file and the run is synced again', async ({
    browser,
  }) => {
    const { drive, d, oldId } = await missingDevice(browser);
    await d.page.getByRole('button', { name: /^Restore run .* to Drive$/ }).click();
    await expect(d.page.getByText('The run was restored to Google Drive.')).toBeVisible();
    await expect(result(d.page)).toContainText('may be out of date');
    const files = jsonFiles(drive);
    expect(files).toHaveLength(1);
    expect(files[0]?.id).not.toBe(oldId);
    await expect(d.page.getByRole('heading', { name: /Runs missing from Drive/ })).toHaveCount(0);
    await d.context.close();
  });

  test('Keep local only stops the prompting and never re-uploads', async ({ browser }) => {
    const { drive, d } = await missingDevice(browser);
    await d.page.getByRole('button', { name: /^Keep run .* on this device only$/ }).click();
    await expect(d.page.getByText('The run will stay on this device only.')).toBeVisible();
    await expect(result(d.page)).toContainText('may be out of date');
    await syncNow(d.page);
    await expect(result(d.page)).not.toContainText('may be out of date');
    expect(jsonFiles(drive)).toHaveLength(0);
    await d.page.getByRole('link', { name: 'Run history' }).click();
    const history = d.page.locator('table', { hasText: 'Sync state' });
    await expect(history.getByRole('cell', { name: 'local_only', exact: true })).toBeVisible();
    await d.context.close();
  });
});

test.describe('Step 11: trash detection despite a lagging search index', () => {
  test('a trashed file that search still lists is reported missing on the very next Sync now', async ({
    browser,
  }) => {
    const drive = new FakeDrive();
    const d = await newDevice(browser, drive);
    await importRun(d.page);
    await openSync(d.page);
    await connect(d.page);
    await syncNow(d.page);
    const file = jsonFiles(drive)[0];
    if (!file) throw new Error('no file');
    drive.lagTrashInSearch = true;
    drive.trash(file.id);
    await syncNow(d.page);
    await expect(result(d.page)).toContainText('Missing from Drive: 1');
    await expect(d.page.getByRole('heading', { name: /Runs missing from Drive/ })).toBeVisible();
    // Detection is read-only: nothing was re-uploaded or untrashed.
    expect(jsonFiles(drive).filter((f) => !f.trashed)).toHaveLength(0);
    await d.context.close();
  });
});

test.describe('Step 10: account-level states', () => {
  test('after a 401 the account needs a reconnect, nothing is lost, and Reconnect restores sync', async ({
    browser,
  }) => {
    const drive = new FakeDrive();
    const d = await newDevice(browser, drive);
    await importRun(d.page);
    await openSync(d.page);
    await connect(d.page);
    drive.revokeToken(d.token);
    await syncNow(d.page);
    await expect(result(d.page)).toContainText('authorization expired');
    await expect(d.page.getByRole('status', { name: 'Connection status' })).toContainText(
      'Reconnect required',
    );
    await expect(d.page.getByRole('button', { name: 'Sync now' })).toBeDisabled();
    expect(jsonFiles(drive)).toHaveLength(0);

    const fresh = drive.issueToken();
    await d.page.evaluate((t) => {
      (window as unknown as { __gis: { token: string } }).__gis.token = t;
    }, fresh);
    await d.page.getByRole('button', { name: 'Reconnect Google Drive' }).click();
    await expect(d.page.getByRole('status', { name: 'Connection status' })).toContainText(
      'Connected',
    );
    await syncNow(d.page);
    await expect(result(d.page)).toContainText('Uploaded: 1');
    await d.context.close();
  });

  test('a different Google account blocks sync and changes nothing', async ({ browser }) => {
    const drive = new FakeDrive();
    const d = await newDevice(browser, drive);
    await importRun(d.page);
    await openSync(d.page);
    await connect(d.page);
    await syncNow(d.page);
    const requestsBefore = drive.requests.length;
    drive.permissionId = 'a-different-account';
    await syncNow(d.page);
    await expect(result(d.page)).toContainText('different from the one this device was first');
    expect(drive.requests.slice(requestsBefore).map((r) => r.path)).toEqual(['/drive/v3/about']);
    await d.context.close();
  });

  test('several Drive folders are listed without choosing; choosing one lets sync continue into it', async ({
    browser,
  }) => {
    const drive = new FakeDrive();
    const tags = { n200_app: 'n200-screener', n200_kind: 'folder' };
    drive.addFile({ name: 'Folder One', mimeType: FOLDER_MIME, appProperties: tags });
    const two = drive.addFile({ name: 'Folder Two', mimeType: FOLDER_MIME, appProperties: tags });
    const d = await newDevice(browser, drive);
    await importRun(d.page);
    await openSync(d.page);
    await connect(d.page);
    await syncNow(d.page);
    await expect(d.page.getByRole('group', { name: /Several Drive folders/ })).toBeVisible();
    expect(jsonFiles(drive)).toHaveLength(0);
    await expect(d.page.getByRole('button', { name: 'Use this folder' })).toBeDisabled();

    await d.page.getByLabel(/^Folder Two/).check();
    await d.page.getByRole('button', { name: 'Use this folder' }).click();
    await expect(d.page.getByText('Folder chosen.')).toBeVisible();
    await syncNow(d.page);
    expect(jsonFiles(drive)[0]?.parents).toEqual([two.id]);
    await d.context.close();
  });

  test('connect failures are explained and leave the app disconnected', async ({ browser }) => {
    const drive = new FakeDrive();
    const d = await newDevice(browser, drive);
    await d.page.goto('/#/sync');
    const cases: [string, string][] = [
      ['popup_closed', 'sign-in window was closed'],
      ['popup_blocked', 'blocked the Google sign-in window'],
      ['denied', 'access was not granted'],
    ];
    for (const [behavior, text] of cases) {
      await d.page.evaluate((b) => {
        (window as unknown as { __gis: { behavior: string } }).__gis.behavior = b;
      }, behavior);
      await d.page.getByRole('button', { name: 'Connect Google Drive' }).click();
      await expect(d.page.getByRole('alert').filter({ hasText: text })).toBeVisible();
      await expect(d.page.getByRole('status', { name: 'Connection status' })).toContainText(
        'Disconnected',
      );
    }
    await d.context.close();
  });

  test('Disconnect revokes the token, and Sync now is disabled afterwards', async ({ browser }) => {
    const drive = new FakeDrive();
    const d = await newDevice(browser, drive);
    await d.page.goto('/#/sync');
    await connect(d.page);
    await d.page.getByRole('button', { name: 'Disconnect' }).click();
    await expect(d.page.getByRole('status', { name: 'Connection status' })).toContainText(
      'Disconnected',
    );
    expect(
      await d.page.evaluate(
        () => (window as unknown as { __gis: { revoked: string } }).__gis.revoked,
      ),
    ).toBe(d.token);
    await expect(d.page.getByRole('button', { name: 'Sync now' })).toBeDisabled();
    await d.context.close();
  });

  test('without Web Locks the view warns and sync is disabled', async ({ browser }) => {
    const drive = new FakeDrive();
    const d = await newDevice(browser, drive);
    await d.page.goto('/');
    await expect(d.page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await d.page.evaluate(() => {
      Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
    });
    await openSync(d.page);
    await expect(
      d.page.getByRole('alert').filter({ hasText: 'Web Locks are unavailable' }),
    ).toBeVisible();
    await connect(d.page);
    await expect(d.page.getByRole('button', { name: 'Sync now' })).toBeDisabled();
    await d.context.close();
  });

  test('the readable-and-unencrypted notice is always shown on the Sync view', async ({
    browser,
  }) => {
    const d = await newDevice(browser, new FakeDrive());
    await d.page.goto('/#/sync');
    await expect(d.page.getByText(/readable, unencrypted JSON/)).toBeVisible();
    await d.context.close();
  });
});

test.describe('Step 10: keyboard and accessibility', () => {
  test('the whole flow works by keyboard alone', async ({ browser }) => {
    const drive = new FakeDrive();
    const d = await newDevice(browser, drive);
    await importRun(d.page);
    await d.page.getByRole('link', { name: 'Sync', exact: true }).focus();
    await d.page.keyboard.press('Enter');
    await expect(d.page.getByRole('heading', { name: 'Google Drive sync' })).toBeVisible();
    const press = async (name: string): Promise<void> => {
      const button = d.page.getByRole('button', { name });
      await button.focus();
      await expect(button).toBeFocused();
      await d.page.keyboard.press('Enter');
    };
    await press('Connect Google Drive');
    await expect(d.page.getByRole('status', { name: 'Connection status' })).toContainText(
      'Connected',
    );
    await press('Sync now');
    await expect(result(d.page)).toContainText('Uploaded: 1');
    await press('Disconnect');
    await expect(d.page.getByRole('status', { name: 'Connection status' })).toContainText(
      'Disconnected',
    );
    await d.context.close();
  });

  test('the Sync view has no serious or critical axe violations in any state', async ({
    browser,
  }) => {
    const drive = new FakeDrive();
    const tags = { n200_app: 'n200-screener', n200_kind: 'folder' };
    drive.addFile({ name: 'Folder One', mimeType: FOLDER_MIME, appProperties: tags });
    drive.addFile({ name: 'Folder Two', mimeType: FOLDER_MIME, appProperties: tags });
    const d = await newDevice(browser, drive);
    await importRun(d.page);
    await openSync(d.page);

    const check = async (label: string): Promise<void> => {
      const axe = await new AxeBuilder({ page: d.page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(
        axe.violations
          .filter((v) => v.impact === 'serious' || v.impact === 'critical')
          .map((v) => `${label}: ${v.id}`),
      ).toEqual([]);
    };
    await check('disconnected');
    await connect(d.page);
    await check('connected');
    await syncNow(d.page);
    await check('folder conflict');
    await d.page.getByLabel(/^Folder One/).check();
    await d.page.getByRole('button', { name: 'Use this folder' }).click();
    await syncNow(d.page);
    const file = jsonFiles(drive)[0];
    if (!file) throw new Error('no file');
    drive.deletePermanently(file.id);
    await syncNow(d.page);
    await expect(d.page.getByRole('heading', { name: /Runs missing from Drive/ })).toBeVisible();
    await check('missing runs');
    drive.revokeToken(d.token);
    await syncNow(d.page);
    await check('reconnect required');
    await d.context.close();
  });
});

test.describe('Step 10: no secrets or Drive traffic in any browser storage, cache, log or export', () => {
  test('after connect, upload (resumable), reconnect, restore and export: no token, session URL or email anywhere', async ({
    browser,
  }) => {
    const drive = new FakeDrive();
    const d = await newDevice(browser, drive);
    await importRun(d.page);
    await openSync(d.page);
    await connect(d.page);
    await syncNow(d.page);
    drive.revokeToken(d.token);
    await syncNow(d.page);
    const second = drive.issueToken();
    await d.page.evaluate((t) => {
      (window as unknown as { __gis: { token: string } }).__gis.token = t;
    }, second);
    await d.page.getByRole('button', { name: 'Reconnect Google Drive' }).click();
    await expect(d.page.getByRole('status', { name: 'Connection status' })).toContainText(
      'Connected',
    );
    const file = jsonFiles(drive)[0];
    if (!file) throw new Error('no file');
    drive.deletePermanently(file.id);
    await syncNow(d.page);
    await d.page.getByRole('button', { name: /^Restore run .* to Drive$/ }).click();
    await expect(d.page.getByText('The run was restored to Google Drive.')).toBeVisible();

    // A backup export is also "storage": it must be free of Drive data.
    await d.page.getByRole('link', { name: 'Backup', exact: true }).click();
    const [download] = await Promise.all([
      d.page.waitForEvent('download'),
      d.page.getByRole('button', { name: 'Export backup' }).click(),
    ]);
    const exportPath = await download.path();
    if (!exportPath) throw new Error('no export');
    const exported = (await import('node:fs')).readFileSync(exportPath, 'utf8');

    const sessionIds = drive.requests
      .map((r) => r.query.get('upload_id'))
      .filter((v): v is string => v !== null);
    expect(sessionIds.length).toBeGreaterThan(0);
    const secrets = [d.token, second, 'upload_id', FAKE_EMAIL, 'Bearer', ...sessionIds];
    const storage = await dumpBrowserStorage(d.page);
    const logs = d.console.join('\n');
    for (const secret of secrets) {
      expect(storage).not.toContain(secret);
      expect(exported).not.toContain(secret);
      expect(logs).not.toContain(secret);
    }
    expect(exported).not.toContain('googleapis');
    expect(logs).not.toMatch(/googleapis/);

    // Cache Storage holds only the app shell and the service worker's own bookkeeping.
    const cacheNames = await d.page.evaluate(() => caches.keys());
    expect(cacheNames.every((n) => n === 'n200-meta' || n.startsWith('n200-shell-'))).toBe(true);
    // The cached app shell legitimately names the approved Google hosts in its CSP; no
    // Drive data, API path or file name may appear anywhere in storage.
    expect(storage).not.toMatch(/drive\/v3|upload\/drive|googleapis\.com\/(drive|upload)/i);
    const cacheDump = JSON.parse(storage) as {
      cacheStorage: Record<string, Record<string, string>>;
    };
    expect(Object.keys(cacheDump.cacheStorage).join()).not.toMatch(/google/i);
    for (const cache of Object.values(cacheDump.cacheStorage)) {
      expect(Object.keys(cache).filter((url) => !url.startsWith(BASE))).toEqual([]);
    }
    await expectClean(d);
    await d.context.close();
  });
});
