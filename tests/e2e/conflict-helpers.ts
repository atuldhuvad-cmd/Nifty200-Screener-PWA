import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import canonicalize from 'canonicalize';
import { expect, type Download, type Page } from '@playwright/test';
import { chooseFile, confirmImport, FIXTURE_CRLF_THREE_ROW, fillRequiredFields } from './helpers';

export interface BackupJson {
  run_count: number;
  run_ids: string[];
  envelope_hashes: Record<string, string>;
  runs: Record<string, unknown>[];
}

export function jcsHash(value: unknown): string {
  const json = canonicalize(value);
  if (json === undefined) throw new Error('canonicalize returned undefined');
  return createHash('sha256').update(json, 'utf8').digest('hex');
}

export async function downloadText(download: Download): Promise<string> {
  const path = await download.path();
  if (!path) throw new Error('expected a downloaded file path');
  return readFileSync(path, 'utf8');
}

export async function downloadBytes(download: Download): Promise<Buffer> {
  const path = await download.path();
  if (!path) throw new Error('expected a downloaded file path');
  return readFileSync(path);
}

export async function goTo(page: Page, link: string, heading: string): Promise<void> {
  await page.getByRole('link', { name: link, exact: true }).click();
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
}

/** Imports one real run, exports a backup, and re-imports a hand-diverged copy of it (same
 * run_id, different query_text, recomputed envelope_sha256) so the run lands in `conflict`. */
export async function makeConflict(
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

export async function runSyncState(page: Page, runId: string): Promise<string | undefined> {
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
