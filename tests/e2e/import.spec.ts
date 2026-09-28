import { expect, test } from '@playwright/test';
import {
  chooseFile,
  confirmImport,
  fillRequiredFields,
  FIXTURE_HEADER_ONLY,
  FIXTURE_MISSING_NUMERATOR,
  SAMPLE_SEVEN_ROW,
} from './helpers';

test.describe('Step 4 import flow', () => {
  test('1. imports the real seven-row sample and shows it as a committed run', async ({ page }) => {
    await page.goto('/');
    await chooseFile(page, SAMPLE_SEVEN_ROW);

    await expect(page.getByText('Data rows: 7')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /App Volume Ratio/ })).toBeVisible();
    // The provider's own VolumeRatio column must remain separately labelled, not merged.
    await expect(page.getByText('provider-reported, not the app ratio')).toBeVisible();

    await fillRequiredFields(page);
    await confirmImport(page);

    await expect(page.getByText(/Committed run for 2026-09-27 \(7 stocks\)/)).toBeVisible();
    const runsTable = page.locator('table', { hasText: 'Sync state' });
    await expect(runsTable.getByRole('cell', { name: '7', exact: true })).toBeVisible();
    await expect(runsTable.getByRole('cell', { name: '2026-09-27' })).toBeVisible();
  });

  test('2. cancel leaves storage empty', async ({ page }) => {
    await page.goto('/');
    await chooseFile(page, SAMPLE_SEVEN_ROW);
    await expect(page.getByText('Data rows: 7')).toBeVisible();
    await fillRequiredFields(page);

    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByText('No runs have been committed yet.')).toBeVisible();
    await expect(page.getByText('Data rows: 7')).toHaveCount(0);

    const count = await page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const req = indexedDB.open('n200-screener');
          req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('runs')) {
              db.close();
              resolve(0);
              return;
            }
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
    expect(count).toBe(0);
  });

  test('3. a CSV missing the required numerator is blocked and writes nothing', async ({
    page,
  }) => {
    await page.goto('/');
    await chooseFile(page, FIXTURE_MISSING_NUMERATOR);

    await expect(page.getByRole('alert')).toContainText('This file cannot be imported');
    await expect(page.getByRole('button', { name: 'Confirm import' })).toHaveCount(0);

    const count = await page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const req = indexedDB.open('n200-screener');
          req.onsuccess = () => {
            const db = req.result;
            const stores = ['runs', 'quarantine_items'] as const;
            let total = 0;
            let remaining = stores.length;
            for (const name of stores) {
              if (!db.objectStoreNames.contains(name)) {
                remaining -= 1;
                if (remaining === 0) {
                  db.close();
                  resolve(total);
                }
                continue;
              }
              const tx = db.transaction(name, 'readonly');
              const countReq = tx.objectStore(name).count();
              countReq.onsuccess = () => {
                total += countReq.result;
                remaining -= 1;
                if (remaining === 0) {
                  db.close();
                  resolve(total);
                }
              };
              countReq.onerror = () => reject(countReq.error);
            }
          };
          req.onerror = () => reject(req.error);
        }),
    );
    expect(count).toBe(0);
  });

  test('4. re-importing identical bytes shows a duplicate warning and requires confirmation', async ({
    page,
  }) => {
    await page.goto('/');
    await chooseFile(page, SAMPLE_SEVEN_ROW);
    await fillRequiredFields(page);
    await confirmImport(page);
    await expect(page.getByText(/Committed run for 2026-09-27/)).toBeVisible();

    await chooseFile(page, SAMPLE_SEVEN_ROW);
    await expect(page.getByText(/already-committed run/)).toBeVisible();
    await fillRequiredFields(page);

    await expect(page.getByRole('button', { name: 'Confirm import' })).toBeDisabled();
    await page.getByLabel('I confirm I want to import this duplicate anyway.').check();
    await expect(page.getByRole('button', { name: 'Confirm import' })).toBeEnabled();

    await confirmImport(page);
    await expect(page.getByText(/Committed run for 2026-09-27 \(7 stocks\)/)).toBeVisible();
  });

  test('5. a header-only CSV requires confirmation and stores an empty run', async ({ page }) => {
    await page.goto('/');
    await chooseFile(page, FIXTURE_HEADER_ONLY);

    await expect(page.getByText('Data rows: 0')).toBeVisible();
    await expect(page.getByText('This file has a header row but no data rows.')).toBeVisible();
    await fillRequiredFields(page);

    await expect(page.getByRole('button', { name: 'Confirm import' })).toBeDisabled();
    await page.getByLabel('I confirm I want to commit this empty run.').check();
    await expect(page.getByRole('button', { name: 'Confirm import' })).toBeEnabled();

    await confirmImport(page);
    await expect(page.getByText(/Committed run for 2026-09-27 \(0 stocks\)/)).toBeVisible();
    const runsTable = page.locator('table', { hasText: 'Sync state' });
    await expect(runsTable.getByRole('cell', { name: '0', exact: true })).toBeVisible();
  });
});
