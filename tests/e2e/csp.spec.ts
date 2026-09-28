import { expect, test } from '@playwright/test';
import { chooseFile, confirmImport, fillRequiredFields, SAMPLE_SEVEN_ROW } from './helpers';

test('8. no CSP violation appears in the browser console during a full import', async ({
  page,
}) => {
  const violations: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (/content security policy|refused to/i.test(text)) violations.push(text);
  });

  await page.goto('/');
  await chooseFile(page, SAMPLE_SEVEN_ROW);
  await fillRequiredFields(page);
  await confirmImport(page);
  await expect(page.getByText(/Committed run for 2026-09-27/)).toBeVisible();
  await page.reload();
  const runHistoryTable = page.locator('table', { hasText: 'Sync state' });
  await expect(
    runHistoryTable.getByRole('cell', { name: '2026-09-27', exact: true }),
  ).toBeVisible();

  expect(violations).toEqual([]);
});
