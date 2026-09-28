import { expect, test, type Page } from '@playwright/test';
import { chooseFile, confirmImport, fillRequiredFields, SAMPLE_SEVEN_ROW } from './helpers';

/** Step 5B review finding: a malformed percent-encoded hash segment must never throw an
 * uncaught exception, on either a same-document hash change or a full page load, and must fall
 * back to the plain run-history view rather than rendering a run-detail/comparison view for the
 * wrong (or no) identity. */

function trackErrors(page: Page): { pageErrors: string[]; consoleErrors: string[] } {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  return { pageErrors, consoleErrors };
}

async function commitOneRun(page: Page): Promise<void> {
  await page.goto('/');
  await chooseFile(page, SAMPLE_SEVEN_ROW);
  await fillRequiredFields(page);
  await confirmImport(page);
  await expect(page.getByText(/Committed run for 2026-09-27/)).toBeVisible();
}

const MALFORMED_SEGMENTS = ['%', '%2', '%GG', 'valid-prefix%2'];

test.describe('Route safety: malformed hash values never crash the app (review finding)', () => {
  for (const segment of MALFORMED_SEGMENTS) {
    test(`#/run/${segment} via same-document hash change falls back safely, no uncaught error`, async ({
      page,
    }) => {
      const { pageErrors, consoleErrors } = trackErrors(page);
      await commitOneRun(page);

      await page.evaluate((s) => {
        location.hash = `#/run/${s}`;
      }, segment);
      // Safe fallback: the plain run-history view, never a run-detail render for a
      // misinterpreted/guessed run ID.
      await expect(page.getByRole('heading', { name: 'Run history' })).toBeVisible();
      await expect(page.getByRole('heading', { name: /^Run for/ })).toHaveCount(0);
      const table = page.locator('table', { hasText: 'Sync state' });
      await expect(table.getByRole('cell', { name: '2026-09-27', exact: true })).toBeVisible();

      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
    });

    test(`#/compare/${segment} via same-document hash change falls back safely, no uncaught error`, async ({
      page,
    }) => {
      const { pageErrors, consoleErrors } = trackErrors(page);
      await commitOneRun(page);

      await page.evaluate((s) => {
        location.hash = `#/compare/${s}`;
      }, segment);
      await expect(page.getByRole('heading', { name: 'Run history' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Compare a stock across runs' })).toHaveCount(
        0,
      );

      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
    });
  }

  test('a malformed #/run/ hash present on initial full page load falls back safely, no uncaught error', async ({
    page,
  }) => {
    const { pageErrors, consoleErrors } = trackErrors(page);
    await page.goto('/#/run/%');

    await expect(page.getByRole('heading', { name: 'Nifty 200 Screener' })).toBeVisible();
    // Fresh database, nothing committed yet: the app must still reach its normal empty state
    // (the import UI), never a run-detail render and never a blank/broken page.
    await expect(page.getByRole('heading', { name: 'Import a CSV' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Run for/ })).toHaveCount(0);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('a malformed #/compare/ hash present on initial full page load falls back safely, no uncaught error', async ({
    page,
  }) => {
    const { pageErrors, consoleErrors } = trackErrors(page);
    await page.goto('/#/compare/%GG');

    await expect(page.getByRole('heading', { name: 'Nifty 200 Screener' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Import a CSV' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Compare a stock across runs' })).toHaveCount(0);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('a real run and a real comparison selection remain reachable after a malformed hash is corrected', async ({
    page,
  }) => {
    const { pageErrors, consoleErrors } = trackErrors(page);
    await commitOneRun(page);

    await page.evaluate(() => {
      location.hash = '#/compare/%';
    });
    await expect(page.getByRole('heading', { name: 'Run history' })).toBeVisible();

    // Recovering with a real link click (not a hand-typed hash) reaches the correct view — the
    // earlier malformed navigation left no stale/incorrect selection behind.
    await page.getByRole('link', { name: 'Compare stocks' }).click();
    await expect(page.getByRole('heading', { name: 'Compare a stock across runs' })).toBeVisible();
    await expect(page.getByLabel('Choose a stock to compare')).toHaveValue('');

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
