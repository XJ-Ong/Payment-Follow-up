import { expect, test, type Page } from '@playwright/test';

import { customer, workspace, summary } from './fixtures/weekly';
async function setup(page: Page, options = { failOnce: false, slow: false }) {
  let retryRequested = false;
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/reports/weekly-summary')) {
      if (options.slow) await new Promise((resolve) => setTimeout(resolve, 300));
      if (options.failOnce && !retryRequested)
        return route.fulfill({
          status: 503,
          json: { detail: 'Report temporarily unavailable' },
        });
      if (url.searchParams.get('week_start') === '2026-10-12')
        return route.fulfill({
          json: {
            ...summary,
            week_start: '2026-10-12',
            week_end: '2026-10-18',
            period_end: '2026-10-18',
            is_current_week: false,
            totals: {
              payments_received: '0.00',
              invoices_fully_paid: 0,
              customers_paid: 0,
            },
            daily: Array.from({ length: 7 }, (_, n) => ({
              date: `2026-10-${12 + n}`,
              amount: '0.00',
            })),
            customers: [],
            payments: [],
          },
        });
      return route.fulfill({ json: summary });
    }
    if (
      url.pathname.endsWith('/followups') ||
      url.pathname.endsWith('/followups/refresh')
    )
      return route.fulfill({ json: workspace });
    if (url.pathname.endsWith('/users'))
      return route.fulfill({
        json: [
          { id: 'owner', name: 'Owner', role: 'owner', is_default: true },
          { id: 'finance', name: 'Finance', role: 'finance', is_default: true },
        ],
      });
    if (url.pathname.endsWith('/outbox') || url.pathname.endsWith('/activity'))
      return route.fulfill({ json: [] });
    return route.fulfill({ status: 404, json: { detail: 'Unexpected request' } });
  });
  await page.exposeFunction('allowReportRetry', () => {
    retryRequested = true;
  });
  await page.goto('/');
  await expect(page.locator('.chart-total')).toContainText('MYR 400.00');
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Weekly Summary', exact: true })
    .click();
}

test('weekly collections navigation, invoice details and mobile containment', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await setup(page);
  const report = page.locator('.weekly-report');
  await expect(report).toContainText('Week to date');
  await expect(report.locator('.summary-value').first()).toHaveText('MYR 600.00');
  await expect(
    page.getByRole('button', { name: 'Next week', exact: true }),
  ).toBeDisabled();
  await expect(page.locator('.weekly-daily-chart li')).toHaveCount(7);
  await page.getByRole('button', { name: 'WEEK-001', exact: true }).click();
  await expect(page.locator('#invoice-action-card')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'WEEK-001', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Previous week', exact: true }).click();
  await expect(report).toContainText('12 Oct 2026 to 18 Oct 2026');
  await expect(report).toContainText('No payments received during this week.');
  await expect(report.locator('.weekly-outstanding')).toContainText('MYR 400.00');
  await expect(
    page.getByRole('button', { name: 'Next week', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'This week', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(report).toContainText('Week to date');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await page.screenshot({ path: 'test-results/weekly-desktop.png', fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/weekly-mobile.png', fullPage: true });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await expect(page.getByRole('button', { name: 'WEEK-001', exact: true })).toBeVisible();
});

test('weekly collections loading and retry recover without showing stale totals', async ({
  page,
}) => {
  await setup(page, { failOnce: true, slow: true });
  await expect(
    page.getByRole('status').filter({ hasText: 'Loading weekly collections' }),
  ).toBeVisible();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Report temporarily unavailable' }),
  ).toBeVisible();
  await expect(page.locator('.weekly-report-metrics')).toHaveCount(0);
  await page.evaluate(() =>
    (window as unknown as { allowReportRetry: () => Promise<void> }).allowReportRetry(),
  );
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('.weekly-report-metrics')).toContainText('MYR 600.00');
});
