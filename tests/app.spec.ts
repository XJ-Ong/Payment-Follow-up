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
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
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
  await expect(page.locator('[data-sonner-toast][data-type="success"]')).toContainText(
    'INV-TEST-001: invoice added.',
  );
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
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
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
  await expect(page.locator('[data-sonner-toast][data-type="loading"]')).toContainText(
    'Refreshing invoices',
  );
  await expect(
    page.getByRole('heading', { name: 'Refreshing your workspace…' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'We couldn’t refresh your invoices' }),
  ).toBeVisible();
  const notification = page.locator('[data-sonner-toast][data-type="error"]');
  await expect(notification).toContainText('Simulated connection failure');
  await notification.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(7);
  await expect(page.locator('[data-sonner-toast][data-type="success"]')).toContainText(
    'Invoices refreshed.',
  );
});

test('notification list opens invoice details and supports dismissal', async ({
  page,
}) => {
  await page.goto('/');
  const bell = page.getByRole('button', { name: 'Show review notifications' });
  await bell.click();
  const panel = page.getByRole('region', { name: 'Notifications', exact: true });
  await expect(panel).toBeVisible();
  await expect(
    panel.getByRole('button', { name: /Review reminder/ }).first(),
  ).toBeVisible();
  await panel
    .getByRole('button', { name: /Review reminder/ })
    .first()
    .click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await bell.click();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(bell).toBeFocused();
  await bell.click();
  await page.getByRole('heading', { name: 'Payment Follow-up', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page.getByLabel('DEMO ROLE').selectOption('Other Staff');
  await page.getByRole('button', { name: 'Close toast', exact: true }).click();
  await bell.click();
  await expect(panel).toContainText('No items need your attention');
});

test('customer profile search filters names and contacts and can be cleared', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Customer Profiles', exact: false }).click();
  const search = page.getByRole('searchbox', { name: 'Search customers' });
  const cards = page.locator('.customer-profile');
  const originalCount = await cards.count();
  expect(originalCount).toBeGreaterThan(1);
  await search.fill('  MERIDIAN  ');
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText('Meridian Studio');
  await search.fill('finance@bloom.example');
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText('Bloom & Co.');
  await search.fill('no matching customer');
  await expect(cards).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'No customers found' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(cards).toHaveCount(originalCount);
});

test('invoice sorting changes row order and reset restores priority', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Invoices & Payments', exact: false }).click();
  const sort = page.getByLabel('Sort by', { exact: true });
  const links = page.locator('tbody .invoice-link');
  const original = await links.allTextContents();
  await sort.selectOption('invoice-asc');
  const ascending = await links.allTextContents();
  expect(ascending).toEqual(
    [...original].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
  );
  await sort.selectOption('invoice-desc');
  expect(await links.allTextContents()).toEqual([...ascending].reverse());
  await sort.selectOption('balance-asc');
  const balances = (await page.locator('tbody .amount').allTextContents()).map((value) =>
    Number(value.replace(/[^0-9.-]/g, '')),
  );
  expect(balances).toEqual([...balances].sort((a, b) => a - b));
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(sort).toHaveValue('priority');
  expect(await links.allTextContents()).toEqual(original);
});
