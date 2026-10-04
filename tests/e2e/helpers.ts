import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const SAMPLE_SEVEN_ROW = join(ROOT, 'samples', 'Nifty200 All_September 27, 2026 (2).csv');
export const SAMPLE_PAGE_1 = join(ROOT, 'samples', 'Nifty200 All_September 27, 2026.csv');
export const SAMPLE_PAGE_2 = join(ROOT, 'samples', 'Nifty200 All_September 27, 2026 (1).csv');
export const FIXTURE_MISSING_NUMERATOR = join(
  ROOT,
  'tests',
  'fixtures',
  'synthetic',
  'SYNTHETIC_missing_numerator_column.csv',
);
export const FIXTURE_HEADER_ONLY = join(
  ROOT,
  'tests',
  'fixtures',
  'synthetic',
  'SYNTHETIC_header_only.csv',
);
export const FIXTURE_CRLF_THREE_ROW = join(
  ROOT,
  'tests',
  'fixtures',
  'synthetic',
  'SYNTHETIC_crlf_final_newline.csv',
);
export const FIXTURE_RUN_HISTORY_MULTIPART_1 = join(
  ROOT,
  'tests',
  'fixtures',
  'synthetic',
  'SYNTHETIC_run_history_multipart_1.csv',
);
export const FIXTURE_RUN_HISTORY_MULTIPART_2 = join(
  ROOT,
  'tests',
  'fixtures',
  'synthetic',
  'SYNTHETIC_run_history_multipart_2.csv',
);
export const FIXTURE_5B_SYMBOL_HISTORY_RUN1 = join(
  ROOT,
  'tests',
  'fixtures',
  'synthetic',
  'SYNTHETIC_5b_symbol_history_run1.csv',
);
export const FIXTURE_5B_SYMBOL_HISTORY_RUN2 = join(
  ROOT,
  'tests',
  'fixtures',
  'synthetic',
  'SYNTHETIC_5b_symbol_history_run2.csv',
);
export const FIXTURE_5B_NSE_ONLY_EARLY = join(
  ROOT,
  'tests',
  'fixtures',
  'synthetic',
  'SYNTHETIC_5b_nse_only_early.csv',
);
export const FIXTURE_5B_ISIN_APPEARS_LATER = join(
  ROOT,
  'tests',
  'fixtures',
  'synthetic',
  'SYNTHETIC_5b_isin_appears_later.csv',
);
export const FIXTURE_5B_CONFLICT = join(
  ROOT,
  'tests',
  'fixtures',
  'synthetic',
  'SYNTHETIC_5b_conflict.csv',
);

export async function chooseFile(page: Page, path: string): Promise<void> {
  await page.getByLabel('Choose an NSE index CSV file').setInputFiles(path);
}

export async function fillRequiredFields(
  page: Page,
  effectiveDate = '2026-09-27',
  universe = 'Nifty 200',
): Promise<void> {
  await page.getByLabel('Effective date (required)').fill(effectiveDate);
  await page.getByLabel(`I confirm this file is a ${universe} export.`).check();
}

export async function confirmImport(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Confirm import' }).click();
}

export async function switchToMultipartImport(page: Page): Promise<void> {
  await page.getByLabel('Multipart export').check();
}

export async function chooseMultipartFiles(page: Page, paths: string[]): Promise<void> {
  await page.getByLabel('Choose CSV files (two or more)').setInputFiles(paths);
}

export async function fillMultipartRequiredFields(
  page: Page,
  effectiveDate = '2026-09-27',
  universe = 'Nifty 200',
): Promise<void> {
  await page.getByLabel('Effective date (required)').fill(effectiveDate);
  await page.getByLabel(`I confirm these files together are a ${universe} export.`).check();
}

export async function confirmMultipartImport(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Confirm multipart import' }).click();
}
