import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { goTo, makeConflict } from './conflict-helpers';
import {
  chooseFile,
  confirmImport,
  FIXTURE_CRLF_THREE_ROW,
  FIXTURE_HEADER_ONLY,
  fillRequiredFields,
} from './helpers';

const NOTICES = [
  'No in-app run deletion in v1.',
  'Data is stored unencrypted in this browser.',
  'Hashes check integrity only; they do not prove authenticity.',
];

async function storeCounts(
  page: Page,
): Promise<{ runs: number; run_variants: number; quarantine_items: number }> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('n200-screener');
        open.onerror = () => reject(open.error as DOMException);
        open.onsuccess = () => {
          const db = open.result;
          const names = ['runs', 'run_variants', 'quarantine_items'] as const;
          const tx = db.transaction([...names], 'readonly');
          const out: Record<string, number> = {};
          for (const n of names) {
            const req = tx.objectStore(n).count();
            req.onsuccess = () => {
              out[n] = req.result;
            };
          }
          tx.oncomplete = () => {
            db.close();
            resolve(out as never);
          };
          tx.onerror = () => reject(tx.error as DOMException);
        };
      }),
  );
}

async function expectNotices(page: Page): Promise<void> {
  const notices = page.getByRole('complementary', { name: 'Privacy and data notices' });
  await expect(notices).toBeVisible();
  for (const text of NOTICES) await expect(notices).toContainText(text);
}

test.describe('Step 7: persistent privacy and data notices', () => {
  test('the three notices are visible on every route', async ({ page }) => {
    await page.goto('/');
    await chooseFile(page, FIXTURE_CRLF_THREE_ROW);
    await fillRequiredFields(page);
    await confirmImport(page);
    await expect(page.getByText(/Committed run for 2026-09-27/)).toBeVisible();

    await expectNotices(page); // run history / import
    await page.getByRole('link', { name: 'Compare stocks' }).click();
    await expectNotices(page);
    await page.getByRole('link', { name: 'Backup', exact: true }).click();
    await expectNotices(page);
    await page.getByRole('link', { name: 'Needs review' }).click();
    await expectNotices(page);
    await page.getByRole('link', { name: 'Run history' }).click();
    await page.getByRole('link', { name: /^Open run/ }).click();
    await expect(page.getByRole('heading', { name: /Run / }).first()).toBeVisible();
    await expectNotices(page);
  });

  test('the notices stay visible before local storage finishes opening', async ({ page }) => {
    await page.goto('/');
    await expectNotices(page);
  });
});

test.describe('Step 7: oversized input writes nothing', () => {
  const header = readFileSync(FIXTURE_CRLF_THREE_ROW, 'utf8').split(/\r?\n/)[0] ?? '';
  const row = '"1","Synthetic Alpha Ltd","1.50","1","1000","1500","SYNA","","ZZSYNTH00015"\r\n';

  const cases: [string, () => Buffer, RegExp][] = [
    [
      'a file over 2 MiB',
      () => Buffer.alloc(2 * 1024 * 1024 + 1, 0x61),
      /larger than the 2 MB limit/,
    ],
    [
      'more than 1,000 data rows',
      () => Buffer.from(`${header}\r\n${row.repeat(1001)}`, 'utf8'),
      /more than the 1,000-row limit/,
    ],
    [
      'more than 200 columns',
      () =>
        Buffer.from(
          `${Array.from({ length: 201 }, (_, i) => `"c${String(i)}"`).join(',')}\r\n`,
          'utf8',
        ),
      /more than the 200-column limit/,
    ],
  ];

  for (const [name, make, message] of cases) {
    test(`${name} is rejected with a clear error and zero writes`, async ({ page }) => {
      await page.goto('/');
      // Only touch IndexedDB directly once the app has opened (and created) its own database:
      // a raw open of a database that does not exist yet would create an empty version-1 one.
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
      const before = await storeCounts(page);
      await page.getByLabel('Choose an NSE index CSV file').setInputFiles({
        name: 'oversize.csv',
        mimeType: 'text/csv',
        buffer: make(),
      });
      await expect(page.getByRole('alert').filter({ hasText: message })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Confirm import' })).toHaveCount(0);
      expect(await storeCounts(page)).toEqual(before);
      expect(before).toEqual({ runs: 0, run_variants: 0, quarantine_items: 0 });
    });
  }
});

test.describe('Step 7: privacy of console output', () => {
  test('a full import, backup and review flow logs no filenames or CSV values', async ({
    page,
  }) => {
    const logs: string[] = [];
    page.on('console', (m) => logs.push(m.text()));
    page.on('pageerror', (e) => logs.push(e.message));

    await makeConflict(page);
    await goTo(page, 'Needs review', 'Needs review');
    await goTo(page, 'Compare stocks', 'Compare a stock across runs');

    const forbidden = [
      'SYNTHETIC_',
      'Synthetic Alpha',
      'Synthetic Beta',
      'ZZSYNTH',
      'diverged copy',
    ];
    for (const line of logs) {
      for (const word of forbidden) expect(line).not.toContain(word);
    }
  });
});

test.describe('Step 7: keyboard-only import', () => {
  test('a run can be imported using only the keyboard after choosing a file', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Choose an NSE index CSV file').setInputFiles(FIXTURE_HEADER_ONLY);
    const date = page.getByLabel('Effective date (required)');
    await date.focus();
    await page.keyboard.type('27092026');
    await expect(date).toHaveValue('2026-09-27');

    const attest = page.getByLabel('I confirm this file is a Nifty 200 export.');
    await attest.focus();
    await page.keyboard.press('Space');
    await expect(attest).toBeChecked();

    const empty = page.getByLabel('I confirm I want to commit this empty run.');
    await empty.focus();
    await page.keyboard.press('Space');
    await expect(empty).toBeChecked();

    const confirm = page.getByRole('button', { name: 'Confirm import' });
    await confirm.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText(/Committed run for 2026-09-27 \(0 stocks\)/)).toBeVisible();
    expect((await storeCounts(page)).runs).toBe(1);
  });
});
