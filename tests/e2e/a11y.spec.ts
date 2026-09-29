import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { goTo, makeConflict } from './conflict-helpers';

async function expectNoSeriousViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const serious = results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${label}: ${v.id} (${v.impact}) x${String(v.nodes.length)}`);
  expect(serious).toEqual([]);
}

test.describe('Step 7: automated accessibility (axe, WCAG 2.2 AA tags)', () => {
  test('every route has no serious or critical violations', async ({ page }) => {
    await makeConflict(page); // leaves one conflict run, so Review has real content
    await goTo(page, 'Needs review', 'Needs review');
    await expectNoSeriousViolations(page, 'review');

    await page.getByRole('button', { name: /^Keep local only for run / }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectNoSeriousViolations(page, 'review dialog');
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm keep local only' }).click();
    await expect(page.getByText('No conflicts.')).toBeVisible();

    await page.getByRole('link', { name: 'Run history' }).click();
    await expect(page.getByRole('link', { name: /^Open run/ })).toBeVisible();
    await expectNoSeriousViolations(page, 'run history');

    await page.getByRole('link', { name: /^Open run/ }).click();
    await expect(page.getByRole('table')).toBeVisible();
    await expectNoSeriousViolations(page, 'run detail');

    await page.getByRole('link', { name: 'Compare stocks' }).click();
    await page.getByRole('combobox').first().selectOption({ index: 1 });
    await expectNoSeriousViolations(page, 'comparison');

    await page.getByRole('link', { name: 'Backup', exact: true }).click();
    await expectNoSeriousViolations(page, 'backup');
  });
});
