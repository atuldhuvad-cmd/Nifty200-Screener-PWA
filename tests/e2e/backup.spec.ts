import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import {
  chooseFile,
  confirmImport,
  FIXTURE_CRLF_THREE_ROW,
  FIXTURE_HEADER_ONLY,
  fillRequiredFields,
} from './helpers';

async function goToBackup(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('link', { name: 'Backup' }).click();
  await expect(page.getByRole('heading', { name: 'Backup', exact: true })).toBeVisible();
}

async function clearDatabaseAndReload(page: import('@playwright/test').Page): Promise<void> {
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
}

test.describe('Step 6: backup export and import', () => {
  test('export downloads a correctly-named JSON file; re-importing it reports every run already present', async ({
    page,
  }) => {
    await page.goto('/');
    await chooseFile(page, FIXTURE_CRLF_THREE_ROW);
    await fillRequiredFields(page, '2026-09-27');
    await confirmImport(page);
    await expect(page.getByText(/Committed run for 2026-09-27/)).toBeVisible();

    await goToBackup(page);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export backup' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^n200-backup-v1-.*\.json$/);
    await expect(page.getByText('Backup exported (1 run).')).toBeVisible();

    const path = await download.path();
    if (!path) throw new Error('expected a downloaded file path');
    const backupText = readFileSync(path, 'utf8');
    const backup: unknown = JSON.parse(backupText);
    expect((backup as { run_count: number }).run_count).toBe(1);
    expect((backup as { format_version: string }).format_version).toBe('1');

    await page.getByLabel('Choose a backup file').setInputFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(backupText),
    });

    const previewTable = page.locator('table', { hasText: 'Outcome' });
    await expect(previewTable.getByRole('row', { name: /Already present\s+1/ })).toBeVisible();
    await expect(previewTable.getByRole('row', { name: /Added\s+0/ })).toBeVisible();

    await page.getByRole('button', { name: 'Confirm import' }).click();
    await expect(page.getByText('already_present: 1')).toBeVisible();
  });

  test('restoring a backup onto a fresh instance re-adds every run, and a corrupt entry alongside known entries is rejected without blocking them', async ({
    page,
  }) => {
    await page.goto('/');
    await chooseFile(page, FIXTURE_CRLF_THREE_ROW);
    await fillRequiredFields(page, '2026-09-27');
    await confirmImport(page);
    await expect(page.getByText(/Committed run for 2026-09-27/)).toBeVisible();

    await chooseFile(page, FIXTURE_HEADER_ONLY);
    await fillRequiredFields(page, '2026-09-28');
    await page.getByLabel('I confirm I want to commit this empty run.').check();
    await confirmImport(page);
    await expect(page.getByText(/Committed run for 2026-09-28 \(0 stocks\)/)).toBeVisible();

    await goToBackup(page);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export backup' }).click(),
    ]);
    const path = await download.path();
    if (!path) throw new Error('expected a downloaded file path');
    const backupText = readFileSync(path, 'utf8');
    const backup = JSON.parse(backupText) as {
      run_count: number;
      run_ids: string[];
      runs: unknown[];
    };
    expect(backup.run_count).toBe(2);

    // Splice in one corrupt entry, without touching the two known-good ones, and re-import into
    // the SAME (non-cleared) instance: both known entries must classify/commit as
    // already-present, and the corrupt one must be rejected without blocking either of them.
    const withCorruptEntry = {
      ...backup,
      run_count: 3,
      run_ids: [...backup.run_ids, 'not-a-real-run'],
      runs: [...backup.runs, { this: 'is not a valid envelope' }],
    };
    await page.getByLabel('Choose a backup file').setInputFiles({
      name: 'backup-with-corruption.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(withCorruptEntry)),
    });
    const previewTable = page.locator('table', { hasText: 'Outcome' });
    await expect(previewTable.getByRole('row', { name: /Already present\s+2/ })).toBeVisible();
    await expect(previewTable.getByRole('row', { name: /Rejected\s+1/ })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm import' }).click();
    await expect(page.getByText('already_present: 2')).toBeVisible();
    await expect(page.getByText('quarantined: 1')).toBeVisible();

    // Now restore the clean (uncorrupted) export onto a completely fresh instance.
    await clearDatabaseAndReload(page);
    await page.getByRole('link', { name: 'Run history' }).click();
    await expect(page.getByText('No runs have been committed yet.')).toBeVisible();

    await goToBackup(page);
    await page.getByLabel('Choose a backup file').setInputFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(backupText),
    });
    await expect(previewTable.getByRole('row', { name: /Added\s+2/ })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm import' }).click();
    await expect(page.getByText('committed: 2')).toBeVisible();

    await page.getByRole('link', { name: 'Run history' }).click();
    const runHistoryTable = page.locator('table', { hasText: 'Sync state' });
    await expect(
      runHistoryTable.getByRole('cell', { name: '2026-09-27', exact: true }),
    ).toBeVisible();
    await expect(
      runHistoryTable.getByRole('cell', { name: '2026-09-28', exact: true }),
    ).toBeVisible();
  });

  test('cancelling an import preview leaves storage unchanged, and the whole flow is keyboard-operable', async ({
    page,
  }) => {
    await page.goto('/');
    await chooseFile(page, FIXTURE_CRLF_THREE_ROW);
    await fillRequiredFields(page, '2026-09-27');
    await confirmImport(page);
    await expect(page.getByText(/Committed run for 2026-09-27/)).toBeVisible();

    // Keyboard-only: Tab to the nav's "Backup" link and activate it with Enter, no mouse.
    const backupLink = page.getByRole('link', { name: 'Backup' });
    await backupLink.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Backup', exact: true })).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export backup' }).click(),
    ]);
    const path = await download.path();
    if (!path) throw new Error('expected a downloaded file path');
    const backupText = readFileSync(path, 'utf8');

    await page.getByLabel('Choose a backup file').setInputFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(backupText),
    });
    await expect(page.getByRole('button', { name: 'Confirm import' })).toBeVisible();

    const countBeforeCancel = await page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const req = indexedDB.open('n200-screener');
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction('runs', 'readonly');
            const countReq = tx.objectStore('runs').count();
            countReq.onsuccess = () => {
              db.close();
              resolve(countReq.result);
            };
            countReq.onerror = () => reject(countReq.error);
          };
          req.onerror = () => reject(req.error);
        }),
    );
    expect(countBeforeCancel).toBe(1);

    // Keyboard-only: Tab to Cancel and activate with Enter.
    const cancelButton = page.getByRole('button', { name: 'Cancel' });
    await cancelButton.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Confirm import' })).toHaveCount(0);

    const countAfterCancel = await page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const req = indexedDB.open('n200-screener');
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction('runs', 'readonly');
            const countReq = tx.objectStore('runs').count();
            countReq.onsuccess = () => {
              db.close();
              resolve(countReq.result);
            };
            countReq.onerror = () => reject(countReq.error);
          };
          req.onerror = () => reject(req.error);
        }),
    );
    expect(countAfterCancel).toBe(1); // unchanged — cancel never wrote anything
  });

  test('a file over the size/count limits and a malformed file are rejected with an accessible error, no preview shown', async ({
    page,
  }) => {
    await page.goto('/');
    await goToBackup(page);

    await page.getByLabel('Choose a backup file').setInputFiles({
      name: 'not-json.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{this is not valid json'),
    });
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('could not be parsed as JSON');
    await expect(page.getByRole('button', { name: 'Confirm import' })).toHaveCount(0);
  });
});
