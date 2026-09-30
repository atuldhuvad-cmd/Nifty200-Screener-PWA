import { expect, test, type Page } from '@playwright/test';
import { downloadText, goTo, type BackupJson } from './conflict-helpers';
import { chooseFile, confirmImport, FIXTURE_CRLF_THREE_ROW, fillRequiredFields } from './helpers';

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

/** Imports one run, exports it as a backup, then wipes the database so that backup is "new". */
async function makeBackupAndWipe(page: Page): Promise<string> {
  await page.goto('/');
  await chooseFile(page, FIXTURE_CRLF_THREE_ROW);
  await fillRequiredFields(page, '2026-09-27');
  await confirmImport(page);
  await expect(page.getByText(/Committed run for 2026-09-27/)).toBeVisible();
  await goTo(page, 'Backup', 'Backup');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export backup' }).click(),
  ]);
  const text = await downloadText(download);
  expect((JSON.parse(text) as BackupJson).run_count).toBe(1);
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
  expect(await runCount(page)).toBe(0);
  return text;
}

test.describe('Step 7: cross-tab behaviour', () => {
  test('another tab upgrading the database makes this tab close its connection and prompt a reload', async ({
    context,
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();

    const other = await context.newPage();
    await other.goto('/');
    await expect(other.getByRole('navigation', { name: 'Main' })).toBeVisible();

    // The second tab requests a NEWER schema version than the one currently installed (read from
    // the browser, so this stays true whatever the app's current DB_VERSION is). The first tab's
    // open connection receives `versionchange`; it must close, or this upgrade would block.
    const upgraded = await other.evaluate(async () => {
      const installed = (await indexedDB.databases()).find((d) => d.name === 'n200-screener');
      const nextVersion = (installed?.version ?? 0) + 1;
      return new Promise<string>((resolve) => {
        const req = indexedDB.open('n200-screener', nextVersion);
        const timer = setTimeout(() => resolve('timed_out_blocked'), 8000);
        req.onblocked = () => {
          /* wait: the old tab should release its connection */
        };
        req.onupgradeneeded = () => {
          /* no-op upgrade */
        };
        req.onsuccess = () => {
          clearTimeout(timer);
          req.result.close();
          resolve('upgraded');
        };
        req.onerror = () => {
          clearTimeout(timer);
          resolve('error');
        };
      });
    });
    expect(upgraded).toBe('upgraded');
    await expect(page.getByRole('alert').filter({ hasText: 'Reload this page' })).toBeVisible();
  });

  test('a second tab cannot restore a backup while another tab holds the restore lock', async ({
    context,
    page,
  }) => {
    const backupText = await makeBackupAndWipe(page);

    const holder = await context.newPage();
    await holder.goto('/');
    await holder.evaluate(() => {
      const w = window as unknown as { __releaseLock?: () => void; __lockHeld?: boolean };
      void navigator.locks.request('n200-activity', () => {
        w.__lockHeld = true;
        return new Promise<void>((resolve) => {
          w.__releaseLock = resolve;
        });
      });
    });
    await expect
      .poll(() => holder.evaluate(() => (window as unknown as { __lockHeld?: boolean }).__lockHeld))
      .toBe(true);

    await page.reload();
    await goTo(page, 'Backup', 'Backup');
    await page.getByLabel('Choose a backup file').setInputFiles({
      name: 'b.json',
      mimeType: 'application/json',
      buffer: Buffer.from(backupText),
    });
    await page.getByRole('button', { name: 'Confirm import' }).click();

    // While the other tab holds the lock, nothing is written and the UI stays in its busy state.
    await expect(page.getByRole('button', { name: 'Importing…' })).toBeVisible();
    await page.waitForTimeout(1500);
    expect(await runCount(page)).toBe(0);

    await holder.evaluate(() => {
      (window as unknown as { __releaseLock?: () => void }).__releaseLock?.();
    });
    await expect(page.getByText('Import complete')).toBeVisible();
    expect(await runCount(page)).toBe(1);
  });

  test('two tabs restoring the same backup at once produce exactly one run', async ({
    context,
    page,
  }) => {
    const backupText = await makeBackupAndWipe(page);
    const second = await context.newPage();
    for (const p of [page, second]) {
      await p.goto('/#/backup');
      await p.getByLabel('Choose a backup file').setInputFiles({
        name: 'b.json',
        mimeType: 'application/json',
        buffer: Buffer.from(backupText),
      });
      await expect(p.getByRole('button', { name: 'Confirm import' })).toBeVisible();
    }
    await Promise.all(
      [page, second].map((p) => p.getByRole('button', { name: 'Confirm import' }).click()),
    );
    for (const p of [page, second]) await expect(p.getByText('Import complete')).toBeVisible();
    expect(await runCount(page)).toBe(1);
    const texts = await Promise.all([page, second].map((p) => p.locator('body').innerText()));
    const committed = texts.filter((t) => t.includes('committed: 1')).length;
    const present = texts.filter((t) => t.includes('already_present: 1')).length;
    expect([committed, present]).toEqual([1, 1]);
  });
});
