import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import canonicalize from 'canonicalize';
import { expect, test, type Download, type Page } from '@playwright/test';
import { chooseFile, confirmImport, FIXTURE_CRLF_THREE_ROW, fillRequiredFields } from './helpers';

interface BackupJson {
  run_count: number;
  run_ids: string[];
  envelope_hashes: Record<string, string>;
  runs: Record<string, unknown>[];
}

function jcsHash(value: unknown): string {
  const json = canonicalize(value);
  if (json === undefined) throw new Error('canonicalize returned undefined');
  return createHash('sha256').update(json, 'utf8').digest('hex');
}

async function downloadText(download: Download): Promise<string> {
  const path = await download.path();
  if (!path) throw new Error('expected a downloaded file path');
  return readFileSync(path, 'utf8');
}

async function downloadBytes(download: Download): Promise<Buffer> {
  const path = await download.path();
  if (!path) throw new Error('expected a downloaded file path');
  return readFileSync(path);
}

async function goTo(page: Page, link: string, heading: string): Promise<void> {
  await page.getByRole('link', { name: link, exact: true }).click();
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
}

/** Imports one real run, exports a backup, and re-imports a hand-diverged copy of it (same
 * run_id, different query_text, recomputed envelope_sha256) so the run lands in `conflict`. */
async function makeConflict(
  page: Page,
): Promise<{ runId: string; canonicalHash: string; variantHash: string }> {
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
  const backup = JSON.parse(await downloadText(download)) as BackupJson;
  const original = backup.runs[0];
  if (!original) throw new Error('expected one exported run');
  const runId = original['run_id'] as string;
  const canonicalHash = original['envelope_sha256'] as string;

  const rest: Record<string, unknown> = { ...original, query_text: 'diverged copy' };
  delete rest['envelope_sha256'];
  const variantHash = jcsHash(rest);
  const divergent = { ...rest, envelope_sha256: variantHash };
  const diverged: BackupJson = {
    ...backup,
    envelope_hashes: { [runId]: variantHash },
    runs: [divergent],
  };
  await page.getByLabel('Choose a backup file').setInputFiles({
    name: 'diverged.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(diverged)),
  });
  await expect(
    page.locator('table', { hasText: 'Outcome' }).getByRole('row', { name: /Conflict\s+1/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Confirm import' }).click();
  await expect(page.getByText('conflict: 1')).toBeVisible();
  return { runId, canonicalHash, variantHash };
}

async function runSyncState(page: Page, runId: string): Promise<string | undefined> {
  return page.evaluate(
    (id) =>
      new Promise<string | undefined>((resolve, reject) => {
        const open = indexedDB.open('n200-screener');
        open.onerror = () => reject(open.error as DOMException);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction('runs', 'readonly').objectStore('runs').get(id);
          req.onsuccess = () => {
            db.close();
            resolve((req.result as { sync?: { state?: string } } | undefined)?.sync?.state);
          };
          req.onerror = () => reject(req.error as DOMException);
        };
      }),
    runId,
  );
}

test.describe('Step 6B: conflict and quarantine review', () => {
  test('shows an explicit empty state when nothing needs review', async ({ page }) => {
    await page.goto('/');
    await goTo(page, 'Needs review', 'Needs review');
    await expect(page.getByText('No conflicts.')).toBeVisible();
    await expect(page.getByText('No quarantined inputs.')).toBeVisible();
  });

  test('lists a backup-import conflict with its canonical and variant metadata', async ({
    page,
  }) => {
    const { runId, canonicalHash, variantHash } = await makeConflict(page);
    await goTo(page, 'Needs review', 'Needs review');
    const article = page.getByRole('article', { name: `Conflict: run ${runId}` });
    await expect(article).toBeVisible();
    await expect(article.getByRole('cell', { name: canonicalHash })).toBeVisible();
    await expect(article.getByRole('cell', { name: variantHash })).toBeVisible();
    await expect(article.getByRole('cell', { name: 'backup_import' })).toBeVisible();
    await expect(article.getByText(/excluded from run detail and comparison/)).toBeVisible();
  });

  test('exports both copies with content and hashes preserved', async ({ page }) => {
    const { runId, canonicalHash, variantHash } = await makeConflict(page);
    await goTo(page, 'Needs review', 'Needs review');

    const [canonicalDl] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: `Export canonical copy of run ${runId}` }).click(),
    ]);
    expect(canonicalDl.suggestedFilename()).toBe(
      `n200-inspect-${runId}-canonical-${canonicalHash.slice(0, 8)}.json`,
    );
    const canonical = JSON.parse(await downloadText(canonicalDl)) as Record<string, unknown>;
    expect(canonical['envelope_sha256']).toBe(canonicalHash);
    const { envelope_sha256: _c, ...canonicalRest } = canonical;
    void _c;
    expect(jcsHash(canonicalRest)).toBe(canonicalHash);

    const [variantDl] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: `Export variant 1 of run ${runId}` }).click(),
    ]);
    expect(variantDl.suggestedFilename()).toBe(
      `n200-inspect-${runId}-variant-${variantHash.slice(0, 8)}.json`,
    );
    const variant = JSON.parse(await downloadText(variantDl)) as Record<string, unknown>;
    expect(variant['envelope_sha256']).toBe(variantHash);
    expect(variant['query_text']).toBe('diverged copy');
    const { envelope_sha256: _v, ...variantRest } = variant;
    void _v;
    expect(jcsHash(variantRest)).toBe(variantHash);
  });

  test('lists a quarantined input and downloads its original bytes exactly', async ({ page }) => {
    await page.goto('/');
    await goTo(page, 'Backup', 'Backup');
    const corruptEntry = { this: 'is not a valid envelope', n: 1 };
    const backup = {
      format_version: '1',
      schema_version: '1',
      created_at: '2026-09-29T00:00:00Z',
      run_count: 1,
      run_ids: ['not-a-real-run'],
      envelope_hashes: {},
      runs: [corruptEntry],
    };
    await page.getByLabel('Choose a backup file').setInputFiles({
      name: 'corrupt.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup)),
    });
    await page.getByRole('button', { name: 'Confirm import' }).click();
    await expect(page.getByText('quarantined: 1')).toBeVisible();

    await goTo(page, 'Needs review', 'Needs review');
    const button = page.getByRole('button', { name: /^Export original bytes of quarantine item / });
    await expect(button).toBeVisible();
    const [dl] = await Promise.all([page.waitForEvent('download'), button.click()]);
    expect(dl.suggestedFilename()).toMatch(/^n200-quarantine-[0-9a-f-]{36}\.bin$/);
    const bytes = await downloadBytes(dl);
    expect(bytes.equals(Buffer.from(JSON.stringify(corruptEntry)))).toBe(true);
  });

  test('cancelling Keep local only changes nothing; confirming returns the run to active views', async ({
    page,
  }) => {
    const { runId } = await makeConflict(page);
    await goTo(page, 'Needs review', 'Needs review');
    expect(await runSyncState(page, runId)).toBe('conflict');

    await page.getByRole('button', { name: `Keep local only for run ${runId}` }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    expect(await runSyncState(page, runId)).toBe('conflict');

    await page.getByRole('button', { name: `Keep local only for run ${runId}` }).click();
    await expect(page.getByRole('dialog')).toContainText('return to run history and comparison');
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm keep local only' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByText('No conflicts.')).toBeVisible();
    expect(await runSyncState(page, runId)).toBe('local_only');

    const resolved = page.getByRole('article', { name: `Preserved variants: run ${runId}` });
    await expect(resolved).toBeVisible();
    await expect(
      resolved.getByRole('button', { name: `Export variant 1 of run ${runId}` }),
    ).toBeVisible();

    await goTo(page, 'Run history', 'Nifty 200 Screener');
    await expect(page.getByRole('link', { name: /^Open run/ })).toBeVisible();
    await page.getByRole('link', { name: 'Compare stocks' }).click();
    await expect(page.getByRole('combobox').first().locator('option')).not.toHaveCount(1);
  });

  test('keyboard-only: dialog traps focus, Escape closes it and focus returns to the trigger', async ({
    page,
  }) => {
    const { runId } = await makeConflict(page);
    await goTo(page, 'Needs review', 'Needs review');
    const trigger = page.getByRole('button', { name: `Keep local only for run ${runId}` });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const insideDialog = (): Promise<boolean> =>
      page.evaluate(() => document.activeElement?.closest('dialog') !== null);
    for (let i = 0; i < 5; i += 1) {
      expect(await insideDialog()).toBe(true);
      await page.keyboard.press('Tab');
    }
    expect(await insideDialog()).toBe(true);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(await runSyncState(page, runId)).toBe('conflict');
  });

  test('backup restore fails closed with an accessible error when Web Locks are unavailable', async ({
    page,
  }) => {
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
    const backupText = await downloadText(download);
    const backup = JSON.parse(backupText) as BackupJson;
    const other = { ...backup.runs[0], run_id: '99999999-9999-4999-8999-999999999999' };
    const bumped: BackupJson = {
      ...backup,
      run_count: 1,
      run_ids: [other['run_id'] as string],
      runs: [other],
    };

    await page.evaluate(() => {
      Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
    });
    await page.getByLabel('Choose a backup file').setInputFiles({
      name: 'b.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(bumped)),
    });
    await page.getByRole('button', { name: 'Confirm import' }).click();
    await expect(page.getByRole('alert')).toContainText('Web Locks');
    await expect(page.getByText('Import complete')).toBeHidden();

    const count = await page.evaluate(
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
    expect(count).toBe(1);
  });

  test('no CSP violations or console errors across the review flow', async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' || /content security policy/i.test(m.text())) {
        problems.push(`${m.type()}: ${m.text()}`);
      }
    });
    const { runId } = await makeConflict(page);
    await goTo(page, 'Needs review', 'Needs review');
    await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: `Export canonical copy of run ${runId}` }).click(),
    ]);
    await page.getByRole('button', { name: `Keep local only for run ${runId}` }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm keep local only' }).click();
    await expect(page.getByText('No conflicts.')).toBeVisible();
    expect(problems.filter((p) => !/favicon/i.test(p))).toEqual([]);
  });
});
