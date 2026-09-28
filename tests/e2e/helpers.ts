import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const SAMPLE_SEVEN_ROW = join(ROOT, 'samples', 'Nifty200 All_September 27, 2026 (2).csv');
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

export async function chooseFile(page: Page, path: string): Promise<void> {
  await page.getByLabel('Choose a Nifty 200 CSV file').setInputFiles(path);
}

export async function fillRequiredFields(page: Page, effectiveDate = '2026-09-27'): Promise<void> {
  await page.getByLabel('Effective date (required)').fill(effectiveDate);
  await page.getByLabel('I confirm this file is a Nifty 200 export.').check();
}

export async function confirmImport(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Confirm import' }).click();
}
