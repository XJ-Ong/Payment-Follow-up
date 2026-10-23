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
  await page.getByRole('button', { name: 'Invoices & Payments', exact: true }).click();
  await page.getByRole('button', { name: number, exact: true }).click();
  await page.getByLabel('Payment amount (MYR)').fill('30.10');
  await page.getByLabel('Received date').fill('2026-10-23');
  await page.getByRole('button', { name: 'Record payment', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('MYR 60.00');
  await page.reload();
  await page.getByRole('button', { name: 'Invoices & Payments', exact: true }).click();
  await page.getByRole('button', { name: number, exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('MYR 60.00');
  await page.getByLabel('Payment amount (MYR)').fill('60');
  await page.getByLabel('Received date').fill('2026-10-23');
  await page.getByRole('button', { name: 'Record payment', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Financial status: paid');
  await page.reload();
  await page.getByRole('button', { name: 'Invoices & Payments', exact: true }).click();
  await page.getByRole('button', { name: number, exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Financial status: paid');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByLabel('DEMO ROLE').selectOption('Other Staff');
  await expect(page.getByRole('heading', { name: 'Access restricted' })).toBeVisible();
});

test('backend rankings, exclusions, alerts and payment-driven queue removal', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Overdue Invoice Rankings', exact: true }),
  ).toBeVisible();
  await expect(page.locator('tbody tr').filter({ hasText: 'QUEUE-DNC' })).toContainText(
    'do not contact',
  );
  const top = page.locator('tbody tr').filter({ hasText: 'QUEUE-TOP' });
  await expect(top).toContainText('100,000');
  await page.getByRole('button', { name: 'QUEUE-DNC', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(
    'Customer is marked do not contact',
  );
  await expect(page.getByRole('dialog')).toContainText('165000.00 RM-days');
  await expect(page.getByRole('button', { name: 'Approve simulated send' })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'QUEUE-SPACED', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Reminder spacing: wait until');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  const queue = page
    .getByRole('navigation')
    .getByRole('button')
    .filter({ hasText: 'Queue' });
  await queue.click();
  await expect(page.getByRole('button', { name: 'QUEUE-DNC', exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole('button', { name: 'QUEUE-SPACED', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'QUEUE-SAFETY', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'QUEUE-TOP', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('100000.00 RM-days');
  await page.getByLabel('Payment amount (MYR)').fill('2500');
  await page.getByRole('button', { name: 'Record payment', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Financial status: paid');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('button', { name: 'QUEUE-TOP', exact: true })).toHaveCount(
    0,
  );
  await page.reload();
  await queue.click();
  await expect(page.getByRole('button', { name: 'QUEUE-TOP', exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole('button', { name: 'QUEUE-SAFETY', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Rules & Settings', exact: true }).click();
  const grace = page.getByRole('spinbutton').first();
  await expect(grace).toHaveAttribute('readonly', '');
  await expect(
    page.getByText('Saved rules are read-only in this milestone.'),
  ).toBeVisible();
});
