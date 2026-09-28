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

  // Unsupported-schema-shaped entries (not plain garbage): each still has a usable run_id, so
  // previewBackupImport's classification performs a real IndexedDB `getRun` round trip per
  // entry — unlike unparseable garbage, which is rejected before any storage read and would
  // preview far too fast to reliably race against a small file's preview.
  function slowUnsupportedSchemaBackup(entryCount: number): {
    format_version: string;
    schema_version: string;
    created_at: string;
    run_count: number;
    run_ids: string[];
    envelope_hashes: Record<string, never>;
    runs: { run_id: string; schema_version: string }[];
  } {
    const run_ids = Array.from({ length: entryCount }, (_, i) => `slow-${String(i)}`);
    return {
      format_version: '1',
      schema_version: '1',
      created_at: new Date().toISOString(),
      run_count: entryCount,
      run_ids,
      envelope_hashes: {},
      runs: run_ids.map((run_id) => ({ run_id, schema_version: '99' })),
    };
  }

  test('the file input is disabled while a preview is being computed', async ({ page }) => {
    await page.goto('/');
    await goToBackup(page);

    // A deterministic artificial delay on the read itself, so this doesn't depend on how fast
    // classification happens to run in a given environment.
    await page.evaluate(() => {
      const original = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = function (this: File) {
        if (this.name === 'slow-backup.json') {
          return new Promise((resolve) => {
            setTimeout(() => resolve(original.call(this)), 2000);
          });
        }
        return original.call(this);
      };
    });

    const fileInput = page.getByLabel('Choose a backup file');
    await fileInput.setInputFiles({
      name: 'slow-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(slowUnsupportedSchemaBackup(5))),
    });
    await expect(fileInput).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Confirm import' })).toBeVisible({
      timeout: 15000,
    });
    await expect(fileInput).toBeEnabled();
  });

  test('selecting a second file while an earlier preview is still in flight never leaves a mismatched preview or a stale backup file behind', async ({
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
    const path = await download.path();
    if (!path) throw new Error('expected a downloaded file path');
    const smallBackupText = readFileSync(path, 'utf8');

    // Force the "slow" file's read to take several seconds — a deterministic delay, so this
    // test reliably reproduces "an earlier selection resolves after a later one" instead of
    // depending on incidental processing speed.
    await page.evaluate(() => {
      const original = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = function (this: File) {
        if (this.name === 'slow-backup.json') {
          return new Promise((resolve) => {
            setTimeout(() => resolve(original.call(this)), 2000);
          });
        }
        return original.call(this);
      };
    });

    const fileInput = page.getByLabel('Choose a backup file');
    // Select the deliberately slow file and, without waiting for it to resolve, immediately
    // select the small one-run export instead.
    await fileInput.setInputFiles({
      name: 'slow-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(slowUnsupportedSchemaBackup(5))),
    });
    await fileInput.setInputFiles({
      name: 'small-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(smallBackupText),
    });

    const previewTable = page.locator('table', { hasText: 'Outcome' });
    await expect(page.getByRole('button', { name: 'Confirm import' })).toBeVisible();
    await expect(previewTable.getByRole('row', { name: /Already present\s+1/ })).toBeVisible();
    await expect(previewTable.getByRole('row', { name: /Unsupported schema\s+5/ })).toHaveCount(0);

    // Give the slow file's read (and its eventual, now-stale continuation) time to actually
    // resolve in the background, so a bug that lets it clobber state afterward would show up.
    await page.waitForTimeout(2500);
    await expect(previewTable.getByRole('row', { name: /Already present\s+1/ })).toBeVisible();
    await expect(previewTable.getByRole('row', { name: /Unsupported schema\s+5/ })).toHaveCount(0);

    await page.getByRole('button', { name: 'Confirm import' }).click();
    await expect(page.getByText('already_present: 1')).toBeVisible();
  });

  test('a storage failure during preview shows an accessible, retryable error instead of leaving the UI stuck', async ({
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
    const path = await download.path();
    if (!path) throw new Error('expected a downloaded file path');
    const backupText = readFileSync(path, 'utf8');

    // Force the next IDBObjectStore#getAll call (previewBackupImport's single up-front load of
    // the canonical run set) to throw once, simulating a genuine storage failure mid-preview.
    await page.evaluate(() => {
      const proto = IDBObjectStore.prototype;
      const original = proto.getAll;
      let armed = true;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
      (proto as unknown as { getAll: Function }).getAll = function (
        this: IDBObjectStore,
        ...args: Parameters<IDBObjectStore['getAll']>
      ) {
        if (armed) {
          armed = false;
          throw new DOMException('Simulated storage failure', 'UnknownError');
        }
        return original.apply(this, args);
      };
    });

    await page.getByLabel('Choose a backup file').setInputFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(backupText),
    });

    const alert = page.getByRole('alert');
    await expect(alert).toContainText(/something went wrong/i);
    await expect(page.getByRole('button', { name: 'Confirm import' })).toHaveCount(0);
    // Scoped to role=status (not role=alert), since the error message itself mentions
    // "checking this backup" and a plain text locator would otherwise match the alert too.
    await expect(page.getByRole('status').filter({ hasText: 'Checking this backup' })).toHaveCount(
      0,
    );

    // Retryable: the patched failure only fires once, so selecting the same file again succeeds.
    await page.getByLabel('Choose a backup file').setInputFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(backupText),
    });
    await expect(page.getByRole('button', { name: 'Confirm import' })).toBeVisible();
  });
});
