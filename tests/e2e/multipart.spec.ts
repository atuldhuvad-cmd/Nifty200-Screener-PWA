import { expect, test } from '@playwright/test';
import {
  chooseMultipartFiles,
  confirmMultipartImport,
  fillMultipartRequiredFields,
  SAMPLE_PAGE_1,
  SAMPLE_PAGE_2,
  switchToMultipartImport,
} from './helpers';

test.describe('Step 4A: multipart CSV import', () => {
  test('selects the two real 100-row pages, previews 200 combined rows, commits one run, and retains it after reload', async ({
    page,
  }) => {
    await page.goto('/');
    await switchToMultipartImport(page);
    await chooseMultipartFiles(page, [SAMPLE_PAGE_1, SAMPLE_PAGE_2]);

    await expect(
      page.getByText('Combined rows: 200. Combined unique stock count: 200.'),
    ).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: 'App Volume Ratio (computed)' }),
    ).toBeVisible();

    await fillMultipartRequiredFields(page);
    await expect(page.getByRole('button', { name: 'Confirm multipart import' })).toBeEnabled();
    await confirmMultipartImport(page);

    await expect(
      page.getByText(/Committed multipart run for 2026-09-27 \(200 stocks\)/),
    ).toBeVisible();

    // Exactly one 200-stock run is shown, not two 100-stock runs.
    const runsTable = page.locator('table', { hasText: 'Sync state' });
    await expect(runsTable.getByRole('cell', { name: '200', exact: true })).toBeVisible();
    await expect(runsTable.getByRole('cell', { name: '100', exact: true })).toHaveCount(0);
    await expect(runsTable.getByRole('cell', { name: '2 parts' })).toBeVisible();
    const rowCount = await runsTable.locator('tbody tr').count();
    expect(rowCount).toBe(1);

    await page.reload();
    const runsTableAfterReload = page.locator('table', { hasText: 'Sync state' });
    await expect(
      runsTableAfterReload.getByRole('cell', { name: '200', exact: true }),
    ).toBeVisible();
    await expect(await runsTableAfterReload.locator('tbody tr').count()).toBe(1);
  });
});
