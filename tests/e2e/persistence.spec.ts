import { expect, test } from '@playwright/test';
import { chooseFile, confirmImport, fillRequiredFields, SAMPLE_SEVEN_ROW } from './helpers';

test('6. a committed run remains visible after reload', async ({ page }) => {
  await page.goto('/');
  await chooseFile(page, SAMPLE_SEVEN_ROW);
  await fillRequiredFields(page);
  await confirmImport(page);
  await expect(page.getByText(/Committed run for 2026-09-27 \(7 stocks\)/)).toBeVisible();

  await page.reload();

  const runsTable = page.locator('table', { hasText: 'Sync state' });
  await expect(runsTable.getByRole('cell', { name: '2026-09-27', exact: true })).toBeVisible();
  await expect(runsTable.getByRole('cell', { name: '7', exact: true })).toBeVisible();
  await expect(page.getByText('No runs have been committed yet.')).toHaveCount(0);
});
