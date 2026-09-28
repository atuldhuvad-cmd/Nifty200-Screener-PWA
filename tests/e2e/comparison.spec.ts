import { expect, test, type Page } from '@playwright/test';
import {
  chooseFile,
  chooseMultipartFiles,
  confirmImport,
  confirmMultipartImport,
  fillMultipartRequiredFields,
  fillRequiredFields,
  FIXTURE_5B_CONFLICT,
  FIXTURE_5B_ISIN_APPEARS_LATER,
  FIXTURE_5B_NSE_ONLY_EARLY,
  FIXTURE_CRLF_THREE_ROW,
  SAMPLE_PAGE_1,
  SAMPLE_PAGE_2,
  SAMPLE_SEVEN_ROW,
  switchToMultipartImport,
} from './helpers';

async function goToCompare(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Compare stocks' }).click();
  await expect(page.getByRole('heading', { name: 'Compare a stock across runs' })).toBeVisible();
}

async function selectStock(page: Page, optionLabelPattern: RegExp): Promise<void> {
  const select = page.getByLabel('Choose a stock to compare');
  const option = select.locator('option').filter({ hasText: optionLabelPattern });
  const value = await option.getAttribute('value');
  if (value === null) throw new Error(`No picker option matched ${String(optionLabelPattern)}`);
  await select.selectOption(value);
}

test.describe('Step 5B: longitudinal stock comparison', () => {
  test('selecting a stock shows its comparison table', async ({ page }) => {
    await page.goto('/');
    await chooseFile(page, SAMPLE_SEVEN_ROW);
    await fillRequiredFields(page);
    await confirmImport(page);
    await expect(page.getByText(/Committed run for 2026-09-27 \(7 stocks\)/)).toBeVisible();

    await goToCompare(page);
    await selectStock(page, /LG Electronics/);

    await expect(page.getByRole('columnheader', { name: 'Presence' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Present' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'LG Electronics' })).toBeVisible();
  });

  test('comparing a v1 single-file run and a v2 multipart run for the same real stock', async ({
    page,
  }) => {
    await page.goto('/');
    await chooseFile(page, SAMPLE_SEVEN_ROW);
    await fillRequiredFields(page, '2026-01-01');
    await confirmImport(page);
    await expect(page.getByText(/Committed run for 2026-01-01/)).toBeVisible();

    await switchToMultipartImport(page);
    await chooseMultipartFiles(page, [SAMPLE_PAGE_1, SAMPLE_PAGE_2]);
    await fillMultipartRequiredFields(page, '2026-02-01');
    await confirmMultipartImport(page);
    await expect(
      page.getByText(/Committed multipart run for 2026-02-01 \(200 stocks\)/),
    ).toBeVisible();

    await goToCompare(page);
    // LG Electronics (INE324D01010) is a real stock present in both the 7-row sample (v1) and
    // the two-page 200-stock multipart export (v2).
    await selectStock(page, /LG Electronics/);

    const table = page.locator('table[aria-describedby="comparison-order"]');
    await expect(table.getByRole('row', { name: /2026-01-01/ })).toContainText('Present');
    await expect(table.getByRole('row', { name: /2026-02-01/ })).toContainText('Present');
    // v2's source provenance: one of the two real page filenames, not the v1 filename.
    await expect(
      table.getByRole('row', { name: /2026-02-01/ }).getByText(/Nifty200 All_September 27, 2026/),
    ).toBeVisible();
  });

  test('a run without the selected stock shows explicit Absent', async ({ page }) => {
    await page.goto('/');
    await chooseFile(page, SAMPLE_SEVEN_ROW);
    await fillRequiredFields(page, '2026-01-01');
    await confirmImport(page);
    await expect(page.getByText(/Committed run for 2026-01-01/)).toBeVisible();

    await chooseFile(page, FIXTURE_CRLF_THREE_ROW);
    await fillRequiredFields(page, '2026-02-01');
    await confirmImport(page);
    await expect(page.getByText(/Committed run for 2026-02-01/)).toBeVisible();

    await goToCompare(page);
    // LG Electronics only appears in the 7-row sample, never in the synthetic 3-row fixture.
    await selectStock(page, /LG Electronics/);

    const table = page.locator('table[aria-describedby="comparison-order"]');
    await expect(table.getByRole('row', { name: /2026-01-01/ })).toContainText('Present');
    const absentRow = table.getByRole('row', { name: /2026-02-01/ });
    await expect(absentRow).toContainText('Absent');
    await expect(absentRow).toContainText('Absent from this run');
  });

  test('same-date runs stay separately selectable and identifiable in the run list', async ({
    page,
  }) => {
    await page.goto('/');
    await chooseFile(page, FIXTURE_CRLF_THREE_ROW);
    await fillRequiredFields(page, '2026-03-01');
    await confirmImport(page);
    await expect(page.getByText(/Committed run for 2026-03-01/)).toBeVisible();

    await chooseFile(page, FIXTURE_CRLF_THREE_ROW);
    await fillRequiredFields(page, '2026-03-01');
    await page.getByLabel('I confirm I want to import this duplicate anyway.').check();
    await confirmImport(page);
    await expect(page.getByText(/Committed run for 2026-03-01/)).toBeVisible();

    await goToCompare(page);
    await selectStock(page, /Synthetic Alpha/);

    const checkboxes = page.locator('fieldset input[type="checkbox"]');
    await expect(checkboxes).toHaveCount(2);
    const labels = page.locator('fieldset label');
    await expect(labels.nth(0)).toContainText('2026-03-01');
    await expect(labels.nth(1)).toContainText('2026-03-01');
    // Both checkboxes are checked by default (all eligible runs included).
    await expect(checkboxes.nth(0)).toBeChecked();
    await expect(checkboxes.nth(1)).toBeChecked();
  });

  test('an NSE-Code-only match is visibly labelled provisional, and stored metrics are shown as-is', async ({
    page,
  }) => {
    await page.goto('/');
    await chooseFile(page, FIXTURE_5B_NSE_ONLY_EARLY);
    await fillRequiredFields(page, '2026-04-01');
    await confirmImport(page);
    await expect(page.getByText(/Committed run for 2026-04-01/)).toBeVisible();

    await goToCompare(page);
    await selectStock(page, /provisional/);

    await expect(page.getByText('Provisional match by NSE Code only')).toBeVisible();
    const table = page.locator('table[aria-describedby="comparison-order"]');
    await expect(table.getByRole('cell', { name: 'nse_code_provisional' })).toBeVisible();
    // Consolidated end of day Vol 1200 / 30D average 1000 = 1.200, the stored historical metric.
    await expect(table.getByRole('cell', { name: '1.200' })).toBeVisible();
  });

  test('a later run supplying an ISIN never retroactively absorbs the older NSE-only identity into one picker entry', async ({
    page,
  }) => {
    await page.goto('/');
    await chooseFile(page, FIXTURE_5B_NSE_ONLY_EARLY);
    await fillRequiredFields(page, '2026-05-01');
    await confirmImport(page);
    await expect(page.getByText(/Committed run for 2026-05-01/)).toBeVisible();

    await chooseFile(page, FIXTURE_5B_ISIN_APPEARS_LATER);
    await fillRequiredFields(page, '2026-05-02');
    await confirmImport(page);
    await expect(page.getByText(/Committed run for 2026-05-02/)).toBeVisible();

    await goToCompare(page);
    const select = page.getByLabel('Choose a stock to compare');
    const options = await select.locator('option').allTextContents();
    const sameStockEntries = options.filter((o) => o.includes('Synthetic Provisional Stock'));
    // Two distinct picker entries for the same stock name/NSE Code: one provisional-only
    // (labelled by its NSE Code, since it has no ISIN), one ISIN-matched (labelled by its ISIN,
    // per the picker's ISIN-first label preference) — never merged into a single entry.
    expect(sameStockEntries.length).toBe(2);
    expect(sameStockEntries.some((o) => o.includes('PROVCODE') && o.includes('provisional'))).toBe(
      true,
    );
    expect(sameStockEntries.some((o) => o.includes('ZZSYNTH00056'))).toBe(true);
  });

  test('keyboard-only navigation: run history -> compare -> pick a stock -> back', async ({
    page,
  }) => {
    await page.goto('/');
    await chooseFile(page, SAMPLE_SEVEN_ROW);
    await fillRequiredFields(page);
    await confirmImport(page);
    await expect(page.getByText(/Committed run for 2026-09-27/)).toBeVisible();

    const compareLink = page.getByRole('link', { name: 'Compare stocks' });
    await compareLink.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Compare a stock across runs' })).toBeVisible();

    await page.getByLabel('Choose a stock to compare').focus();
    await selectStock(page, /LG Electronics/);
    await expect(page.getByRole('cell', { name: 'Present' })).toBeVisible();

    const backLink = page.getByRole('link', { name: 'Back to run history' });
    await backLink.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Run history' })).toBeVisible();
  });

  test('the selected comparison persists across reload (route preserved)', async ({ page }) => {
    await page.goto('/');
    await chooseFile(page, SAMPLE_SEVEN_ROW);
    await fillRequiredFields(page);
    await confirmImport(page);
    await expect(page.getByText(/Committed run for 2026-09-27/)).toBeVisible();

    await goToCompare(page);
    await selectStock(page, /LG Electronics/);
    await expect(page.getByRole('cell', { name: 'Present' })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Compare a stock across runs' })).toBeVisible();
    await expect(page.getByLabel('Choose a stock to compare')).toHaveValue('isin:INE324D01010');
    await expect(page.getByRole('cell', { name: 'Present' })).toBeVisible();
  });

  test('no CSP violation appears in the console across a full comparison flow', async ({
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

    await goToCompare(page);
    await selectStock(page, /LG Electronics/);
    await expect(page.getByRole('cell', { name: 'Present' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Compare a stock across runs' })).toBeVisible();

    expect(violations).toEqual([]);
  });

  test('an identity conflict (same NSE Code, different ISINs) is surfaced and never auto-merged', async ({
    page,
  }) => {
    await page.goto('/');
    await chooseFile(page, FIXTURE_5B_CONFLICT);
    await fillRequiredFields(page, '2026-06-01');
    await confirmImport(page);
    await expect(page.getByText(/Committed run for 2026-06-01/)).toBeVisible();

    await goToCompare(page);
    await expect(page.getByText(/1 identity conflict detected/)).toBeVisible();
    await expect(page.getByText(/SHAREDCODE.*ZZSYNTH00015.*ZZSYNTH00023/)).toBeVisible();

    // The two conflicting ISINs remain two separate, independently selectable picker entries —
    // never combined into one "SHAREDCODE" security.
    const select = page.getByLabel('Choose a stock to compare');
    const options = await select.locator('option').allTextContents();
    expect(options.some((o) => o.includes('ZZSYNTH00015'))).toBe(true);
    expect(options.some((o) => o.includes('ZZSYNTH00023'))).toBe(true);

    await selectStock(page, /Synthetic Conflict Alpha/);
    await expect(page.getByText(/Identity conflict: NSE Code SHAREDCODE/)).toBeVisible();
    const table = page.locator('table[aria-describedby="comparison-order"]');
    // Only the selected ISIN's own row shows in this comparison, not the conflicting one.
    await expect(table.getByRole('cell', { name: 'ZZSYNTH00015' }).first()).toBeVisible();
    await expect(table.getByRole('cell', { name: 'ZZSYNTH00023' })).toHaveCount(0);
  });
});
