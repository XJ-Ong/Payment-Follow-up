import { expect, test } from '@playwright/test';

test('API invoice creation, payment and reload persist', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('DEMO ROLE').locator('option')).toHaveText([
    'Owner',
    'Finance',
    'Other Staff',
  ]);
  await page.getByLabel('DEMO ROLE').selectOption('Finance');
  await expect(
    page.getByRole('heading', { name: 'Refreshing your workspace?' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Add Invoice', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const number = `BROWSER-${Date.now()}`;
  await page.getByLabel('Invoice number').fill(number);
  await expect(page.getByLabel('Customer').locator('option')).not.toHaveCount(0);
  await page.getByLabel('Invoice total (MYR)').fill('100.10');
  await page.getByLabel('Payments received (MYR)').fill('10');
  await page.getByLabel('Issue date', { exact: true }).fill('2026-10-01');
  await page.getByLabel('Due date', { exact: true }).fill('2026-10-23');
  await dialog.getByRole('button', { name: 'Add Invoice', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: number, exact: true }).click();
  await page.getByLabel('Payment amount (MYR)').fill('30.10');
  await page.getByLabel('Received date').fill('2026-10-23');
  await page.getByRole('button', { name: 'Record payment', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('MYR 60.00');
  await page.reload();
  await page.getByRole('button', { name: number, exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('MYR 60.00');
  await page.getByLabel('Payment amount (MYR)').fill('60');
  await page.getByLabel('Received date').fill('2026-10-23');
  await page.getByRole('button', { name: 'Record payment', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Financial status: paid');
  await page.reload();
  await page.getByRole('button', { name: number, exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Financial status: paid');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByLabel('DEMO ROLE').selectOption('Other Staff');
  await expect(page.getByRole('heading', { name: 'Access restricted' })).toBeVisible();
});
