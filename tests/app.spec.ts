import { expect, test } from '@playwright/test';

test('desktop filters, invoice validation and simulated approval reconcile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Payment Follow-up', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.summary-card').first()).toContainText('MYR 45,000.00');
  await expect(page.locator('tbody tr')).toHaveCount(7);
  await page.screenshot({ path: 'artifacts/desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  await expect(page.locator('.sidebar')).toHaveCSS('width', '80px');
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
  await expect(page.locator('.sidebar')).toHaveCSS('width', '300px');
  await page.getByPlaceholder('Search invoice or customer…').fill('nothing matches');
  await page.getByRole('button', { name: 'Apply Filter' }).click();
  await expect(page.getByRole('heading', { name: 'No invoices found' })).toBeVisible();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(7);
  await page.getByLabel('Due date from', { exact: true }).fill('2026-10-05');
  await page.getByLabel('Due date to', { exact: true }).fill('2026-10-10');
  await page.getByRole('button', { name: 'Apply Filter' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(3);
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.getByRole('button', { name: 'Add Invoice', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await page.getByLabel('Invoice number').fill('INV-2026-042');
  await page.getByLabel('Invoice total (MYR)').fill('100');
  await page.getByLabel('Payments received (MYR)').fill('20');
  await page.getByLabel('Issue date', { exact: true }).fill('2026-10-01');
  await page.getByLabel('Due date', { exact: true }).fill('2026-10-01');
  await dialog.getByRole('button', { name: 'Add Invoice', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('unique');
  await page.getByLabel('Invoice number').fill('INV-TEST-001');
  await dialog.getByRole('button', { name: 'Add Invoice', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.summary-card').first()).toContainText('MYR 45,080.00');
  await page.getByRole('button', { name: 'INV-2026-042', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('262,500');
  await page.getByRole('button', { name: 'Approve simulated send' }).click();
  await expect(page.getByRole('dialog')).toContainText('Simulated sent');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.locator('.summary-card').nth(1)).toContainText('02');
  await expect(page.locator('.summary-card').nth(3)).toContainText('02');
});

test('role restrictions, draft text retention and do-not-contact blocking', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('DEMO ROLE').selectOption('Finance');
  await page.getByRole('button', { name: 'INV-2026-042', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Approve simulated send' }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'INV-2026-041', exact: true }).click();
  await page.getByLabel('Reminder text').fill('A custom template reminder for the demo.');
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'INV-2026-041', exact: true }).click();
  await expect(page.getByLabel('Reminder text')).toHaveValue(
    'A custom template reminder for the demo.',
  );
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'INV-2026-044', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(
    'This customer is marked do not contact',
  );
  await expect(page.getByRole('button', { name: 'Prepare draft' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByLabel('DEMO ROLE').selectOption('Other Staff');
  await expect(page.getByRole('heading', { name: 'Access restricted' })).toBeVisible();
  await expect(page.locator('table')).toHaveCount(0);
});

test('mobile navigation, responsive containment and accessible dialogs', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await page.screenshot({ path: 'artifacts/mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('dialog', { name: 'Main navigation' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Main navigation' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Today’s Queue', exact: false }).click();
  await expect(page.locator('tbody tr')).toHaveCount(3);
  await page.getByRole('button', { name: 'Add Invoice', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('simulated loading failure can be recovered', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Rules & Settings', exact: true }).click();
  await page.getByLabel('Simulate an error on the next refresh').check();
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh now' }).click();
  await expect(
    page.getByRole('heading', { name: 'Refreshing your workspace…' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'We couldn’t refresh your invoices' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Retry demo connection' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(7);
});
