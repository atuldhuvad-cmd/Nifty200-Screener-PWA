import { expect, test } from '@playwright/test';
import { chooseFile, confirmImport, fillRequiredFields, SAMPLE_SEVEN_ROW } from './helpers';

test.describe('durability warnings', () => {
  test('when the browser denies persistent storage, a non-blocking warning shows the at-risk run count', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator.storage, 'persist', {
        value: () => Promise.resolve(false),
        configurable: true,
      });
      Object.defineProperty(navigator.storage, 'persisted', {
        value: () => Promise.resolve(false),
        configurable: true,
      });
    });
    await page.goto('/');
    await expect(page.getByText(/Persistent storage was not granted/)).toBeVisible();
    await expect(page.getByText('0 runs without a verified remote backup.')).toBeVisible();

    await chooseFile(page, SAMPLE_SEVEN_ROW);
    await fillRequiredFields(page);
    await confirmImport(page);
    await expect(page.getByText(/Committed run for 2026-09-27/)).toBeVisible();

    // Non-blocking: the app is still usable, and the count reflects the pending run.
    await expect(page.getByText('1 run without a verified remote backup.')).toBeVisible();
  });
});
