import { expect, test, type Page } from '@playwright/test';
import {
  chooseFile,
  chooseMultipartFiles,
  confirmImport,
  confirmMultipartImport,
  fillMultipartRequiredFields,
  fillRequiredFields,
  FIXTURE_CRLF_THREE_ROW,
  FIXTURE_HEADER_ONLY,
  FIXTURE_RUN_HISTORY_MULTIPART_1,
  FIXTURE_RUN_HISTORY_MULTIPART_2,
  switchToMultipartImport,
} from './helpers';

async function runHistoryTable(page: Page) {
  return page.locator('table', { hasText: 'Sync state' });
}

async function openRunRow(page: Page, effectiveDate: string): Promise<void> {
  const table = await runHistoryTable(page);
  const row = table.locator('tbody tr', { hasText: effectiveDate }).first();
  await row.getByRole('link', { name: /^Open/ }).click();
}

test.describe('Step 5A: run history', () => {
  test('run-list ordering: newer effective_date sorts first, and the default order is stated in the UI', async ({
    page,
  }) => {
    await page.goto('/');
    await chooseFile(page, FIXTURE_CRLF_THREE_ROW);
    await fillRequiredFields(page, '2026-01-01');
    await confirmImport(page);
    await expect(page.getByText(/Committed run for 2026-01-01/)).toBeVisible();

    await chooseFile(page, FIXTURE_CRLF_THREE_ROW);
    await fillRequiredFields(page, '2026-03-01');
    // Same source bytes as the first import: acknowledge the duplicate-file warning.
    await page.getByLabel('I confirm I want to import this duplicate anyway.').check();
    await confirmImport(page);
    await expect(page.getByText(/Committed run for 2026-03-01/)).toBeVisible();

    await expect(
      page.getByText(
        'Runs are ordered by effective date (newest first), then import time (newest first), then run ID.',
      ),
    ).toBeVisible();

    const table = await runHistoryTable(page);
    const dateCells = await table.locator('tbody tr td:first-child').allTextContents();
    expect(dateCells).toEqual(['2026-03-01', '2026-01-01']);
  });

  test('opening a v1 run shows its full stock table, sortable and never lexicographic', async ({
    page,
  }) => {
    await page.goto('/');
    await chooseFile(page, FIXTURE_CRLF_THREE_ROW);
    await fillRequiredFields(page, '2026-04-01');
    await confirmImport(page);
    await expect(page.getByText(/Committed run for 2026-04-01/)).toBeVisible();

    await openRunRow(page, '2026-04-01');
    await expect(page.getByRole('heading', { name: 'Run for 2026-04-01' })).toBeVisible();

    const ratioHeader = page.getByRole('columnheader', { name: /App Volume Ratio \(computed\)/ });
    await expect(ratioHeader).toHaveAttribute('aria-sort', 'none');

    await ratioHeader.getByRole('button').click();
    await expect(ratioHeader).toHaveAttribute('aria-sort', 'ascending');
    // SYNTHETIC_crlf_final_newline.csv: Beta 0.500, Alpha 1.500, Gamma 2.000.
    const cellsAsc = await page.locator('tbody tr td:last-child').allTextContents();
    expect(cellsAsc).toEqual(['0.500', '1.500', '2.000']);

    await ratioHeader.getByRole('button').click();
    await expect(ratioHeader).toHaveAttribute('aria-sort', 'descending');
    const cellsDesc = await page.locator('tbody tr td:last-child').allTextContents();
    expect(cellsDesc).toEqual(['2.000', '1.500', '0.500']);

    const stockHeader = page.getByRole('columnheader', { name: 'Stock' });
    await stockHeader.getByRole('button').click();
    await expect(stockHeader).toHaveAttribute('aria-sort', 'ascending');
    // Column order is Identity, Sl No, Stock, ... — the "Stock" <td> is the 3rd td in each row
    // (0-based index 2 among tds only, since the row-number cell is a <th>, not a <td>).
    const stockCellText = (): Promise<string[]> =>
      page
        .locator('tbody tr')
        .evaluateAll((rows) => rows.map((r) => r.querySelectorAll('td')[2]?.textContent ?? ''));
    expect(await stockCellText()).toEqual([
      'Synthetic Alpha Ltd',
      'Synthetic Beta Ltd',
      'Synthetic Gamma Ltd',
    ]);

    // Click again (descending) to prove this is a real sort, not coincidental natural order.
    await stockHeader.getByRole('button').click();
    await expect(stockHeader).toHaveAttribute('aria-sort', 'descending');
    expect(await stockCellText()).toEqual([
      'Synthetic Gamma Ltd',
      'Synthetic Beta Ltd',
      'Synthetic Alpha Ltd',
    ]);
  });

  test('opening a v2 multipart run shows source provenance and proves 2 < 9 < 10 numeric sorting', async ({
    page,
  }) => {
    await page.goto('/');
    await switchToMultipartImport(page);
    await chooseMultipartFiles(page, [
      FIXTURE_RUN_HISTORY_MULTIPART_1,
      FIXTURE_RUN_HISTORY_MULTIPART_2,
    ]);
    await fillMultipartRequiredFields(page, '2026-05-01');
    await page.getByLabel(/I confirm I want to commit this run with 4 unique stocks\./).check();
    await confirmMultipartImport(page);
    await expect(
      page.getByText(/Committed multipart run for 2026-05-01 \(4 stocks\)/),
    ).toBeVisible();

    await openRunRow(page, '2026-05-01');
    await expect(page.getByRole('heading', { name: 'Run for 2026-05-01' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Source file' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Source row' })).toBeVisible();

    const ratioHeader = page.getByRole('columnheader', { name: /App Volume Ratio \(computed\)/ });
    await ratioHeader.getByRole('button').click();
    await expect(ratioHeader).toHaveAttribute('aria-sort', 'ascending');
    const cellsAsc = await page.locator('tbody tr td:last-child').allTextContents();
    // Beta 0.900, Alpha 2.000, Gamma 9.000, Epsilon 10.000: strictly numeric, never lexicographic
    // (a lexicographic sort would put "10.000" before "2.000" and "9.000").
    expect(cellsAsc).toEqual(['0.900', '2.000', '9.000', '10.000']);

    const sourceFiles = await page.locator('tbody tr td:nth-child(2)').allTextContents();
    expect(new Set(sourceFiles)).toEqual(
      new Set(['SYNTHETIC_run_history_multipart_1.csv', 'SYNTHETIC_run_history_multipart_2.csv']),
    );
  });

  test('keyboard navigation from run history to run detail and back', async ({ page }) => {
    await page.goto('/');
    await chooseFile(page, FIXTURE_CRLF_THREE_ROW);
    await fillRequiredFields(page, '2026-06-01');
    await confirmImport(page);
    await expect(page.getByText(/Committed run for 2026-06-01/)).toBeVisible();

    const table = await runHistoryTable(page);
    const openLink = table.getByRole('link', { name: /^Open/ }).first();
    await openLink.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Run for 2026-06-01' })).toBeVisible();

    const backLink = page.getByRole('link', { name: 'Back to run history' });
    await backLink.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Run history' })).toBeVisible();
  });

  test('an empty run opens and shows an explicit zero-stock state', async ({ page }) => {
    await page.goto('/');
    await chooseFile(page, FIXTURE_HEADER_ONLY);
    await fillRequiredFields(page, '2026-07-01');
    await page.getByLabel('I confirm I want to commit this empty run.').check();
    await confirmImport(page);
    await expect(page.getByText(/Committed run for 2026-07-01 \(0 stocks\)/)).toBeVisible();

    await openRunRow(page, '2026-07-01');
    await expect(page.getByRole('heading', { name: 'Run for 2026-07-01' })).toBeVisible();
    await expect(page.getByText('This run has zero stocks.')).toBeVisible();
  });

  test('the selected run persists across reload (route preserved)', async ({ page }) => {
    await page.goto('/');
    await chooseFile(page, FIXTURE_CRLF_THREE_ROW);
    await fillRequiredFields(page, '2026-08-01');
    await confirmImport(page);
    await expect(page.getByText(/Committed run for 2026-08-01/)).toBeVisible();

    await openRunRow(page, '2026-08-01');
    await expect(page.getByRole('heading', { name: 'Run for 2026-08-01' })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Run for 2026-08-01' })).toBeVisible();
  });

  test('run stock table remains compact with one-line nowrap cells and horizontal scrolling', async ({
    page,
  }) => {
    await page.goto('/');
    await chooseFile(page, FIXTURE_CRLF_THREE_ROW);
    await fillRequiredFields(page, '2026-09-01');
    await confirmImport(page);
    await openRunRow(page, '2026-09-01');

    const table = page.locator('table.run-stock-table');
    await expect(table).toBeVisible();

    const scrollContainer = page.locator('.table-scroll');
    await expect(scrollContainer).toBeVisible();

    // Verify cell styling: white-space nowrap and compact padding
    const firstTd = table.locator('tbody tr td').first();
    const whiteSpace = await firstTd.evaluate((el) => window.getComputedStyle(el).whiteSpace);
    expect(whiteSpace).toBe('nowrap');

    // Verify row height is compact (not blown up by wrapped content)
    const firstRowHeight = await table
      .locator('tbody tr')
      .first()
      .evaluate((el) => el.getBoundingClientRect().height);
    expect(firstRowHeight).toBeLessThan(50);

    // Verify on mobile viewport
    await page.setViewportSize({ width: 390, height: 844 });
    const isScrollable = await scrollContainer.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(isScrollable).toBe(true);

    const mobileFirstRowHeight = await table
      .locator('tbody tr')
      .first()
      .evaluate((el) => el.getBoundingClientRect().height);
    expect(mobileFirstRowHeight).toBeLessThan(50);
  });
});
