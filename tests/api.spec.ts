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
  await expandInvoiceDetails(page);
  await page.getByLabel('Payment amount (MYR)').fill('30.10');
  await page.getByLabel('Received date').fill('2026-10-23');
  await page.getByRole('button', { name: 'Record payment', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('MYR 60.00');
  await page.reload();
  await page.getByRole('button', { name: 'Invoices & Payments', exact: true }).click();
  await page.getByRole('button', { name: number, exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('MYR 60.00');
  await expandInvoiceDetails(page);
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
  await expandInvoiceDetails(page);
  await expect(page.getByRole('dialog')).toContainText('165000.00 RM-days');
  await expect(page.getByRole('button', { name: 'Approve simulated send' })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'QUEUE-SPACED', exact: true }).click();
  await expandInvoiceDetails(page);
  await expect(page.getByRole('dialog')).toContainText('Reminder spacing: wait until');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  const queue = page
    .getByRole('navigation')
    .getByRole('button', { name: 'Follow-ups', exact: true });
  await queue.click();
  await expect(page.getByRole('button', { name: 'QUEUE-DNC', exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole('button', { name: 'QUEUE-SPACED', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator('.followup-row').filter({ hasText: 'QUEUE-SAFETY' }),
  ).toBeVisible();
  await page
    .locator('.followup-row')
    .filter({ hasText: 'QUEUE-TOP' })
    .getByRole('button', { name: 'Prepare reminder' })
    .click();
  await expandInvoiceDetails(page);
  await expect(page.getByRole('dialog')).toContainText('100000.00 RM-days');
  await expandInvoiceDetails(page);
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
    page.locator('.followup-row').filter({ hasText: 'QUEUE-SAFETY' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Rules & Settings', exact: true }).click();
  const grace = page.getByRole('spinbutton').first();
  await expect(grace).toHaveAttribute('readonly', '');
  await expect(
    page.getByText('Saved rules are read-only in this milestone.'),
  ).toBeVisible();
});

async function openInvoice(page: import('@playwright/test').Page, number: string) {
  await page.getByRole('button', { name: 'Invoices & Payments', exact: true }).click();
  await page.getByRole('button', { name: number, exact: true }).click();
}
async function closeDrawer(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Close dialog' }).click();
}

test('saved draft versions, standard approval and simulated outbox survive reload', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('DEMO ROLE').selectOption('Finance');
  await openInvoice(page, 'WF-STANDARD');
  await page.getByRole('button', { name: 'Create template draft', exact: true }).click();
  const body = page.getByLabel('Saved reminder text');
  const original = await body.inputValue();
  await body.fill(original + '\nPlease confirm receipt.');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Version 2');
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page
      .locator('.drawer-body')
      .evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: 'test-results/workflow-mobile.png', fullPage: true });
  if (viewport) await page.setViewportSize(viewport);
  await closeDrawer(page);
  await page.reload();
  await page.getByLabel('DEMO ROLE').selectOption('Finance');
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Follow-ups', exact: true })
    .click();
  await page.getByRole('tab', { name: /^Drafts/ }).click();
  await page
    .locator('.followup-row')
    .filter({ hasText: 'WF-STANDARD' })
    .getByRole('button', { name: 'Continue draft' })
    .click();
  await expect(body).toHaveValue(original + '\nPlease confirm receipt.');
  await page
    .getByRole('button', { name: 'Submit for Finance approval', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Approve current version', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toContainText('Approved preview');
  await page.getByRole('button', { name: 'Simulate send', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Simulated dispatch saved');
  await closeDrawer(page);
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Follow-ups', exact: true })
    .click();
  await page.getByRole('tab', { name: /^Sent/ }).click();
  await expect(page.getByRole('main')).toContainText('WF-STANDARD');
  await page
    .locator('.followup-row')
    .filter({ hasText: 'WF-STANDARD' })
    .getByText('View saved receipt')
    .click();
  await expect(page.getByRole('main')).toContainText('Please confirm receipt.');
  await page.reload();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Follow-ups', exact: true })
    .click();
  await page.getByRole('tab', { name: /^Sent/ }).click();
  await expect(page.getByRole('main')).toContainText('WF-STANDARD');
  const receipt = page.locator('.followup-row').filter({ hasText: 'WF-STANDARD' });
  await receipt.getByText('View saved receipt').click();
  await receipt.getByRole('button', { name: 'View reminder history' }).click();
  await expect(
    page.getByRole('dialog').getByText('Draft version history (2)'),
  ).toBeVisible();
  await closeDrawer(page);
  await expect(page.getByRole('tab', { name: /^Sent/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('button', { name: 'Activity Log', exact: true }).click();
  await expect(page.getByRole('main')).toContainText('Simulated reminder sent');
});

test('high value requires Finance then Owner and edits reset approvals', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('DEMO ROLE').selectOption('Finance');
  await openInvoice(page, 'WF-HIGH');
  await page.getByRole('button', { name: 'Create template draft', exact: true }).click();
  await page
    .getByRole('button', { name: 'Submit for Finance approval', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Approve current version', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toContainText('Awaiting Owner approval');
  await expect(
    page.getByRole('button', { name: 'Simulate send', exact: true }),
  ).toHaveCount(0);
  await closeDrawer(page);
  await page.getByLabel('DEMO ROLE').selectOption('Owner');
  await openInvoice(page, 'WF-HIGH');
  await page.getByRole('button', { name: 'Edit reminder', exact: true }).click();
  const text = page.getByLabel('Saved reminder text');
  await text.fill((await text.inputValue()) + '\nThank you for your response.');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Version 2');
  await page
    .getByRole('button', { name: 'Submit for Finance approval', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Approve current version', exact: true }),
  ).toHaveCount(0);
  await closeDrawer(page);
  await page.getByLabel('DEMO ROLE').selectOption('Finance');
  await openInvoice(page, 'WF-HIGH');
  await page
    .getByRole('button', { name: 'Approve current version', exact: true })
    .click();
  await closeDrawer(page);
  await page.reload();
  await openInvoice(page, 'WF-HIGH');
  await page
    .getByRole('button', { name: 'Approve current version', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toContainText('Approval progress - 2 / 2');
  await page.getByRole('button', { name: 'Simulate send', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Simulated dispatch saved');
});

test('backup Finance routing, Owner leave and payment invalidation', async ({
  page,
  request,
}) => {
  await request.post('http://127.0.0.1:8001/__test/leave', {
    data: { finance: true, owner: true },
  });
  await page.goto('/');
  await page.getByLabel('DEMO ROLE').selectOption('Finance');
  await openInvoice(page, 'WF-LEAVE');
  await page.getByRole('button', { name: 'Create template draft', exact: true }).click();
  await page
    .getByRole('button', { name: 'Submit for Finance approval', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toContainText('routed to backup Finance');
  await expect(
    page.getByRole('button', { name: 'Approve current version', exact: true }),
  ).toHaveCount(0);
  await closeDrawer(page);
  const backup = page.getByLabel('DEMO USER');
  const backupId = await backup
    .locator('option')
    .filter({ hasText: 'Backup Finance' })
    .getAttribute('value');
  await backup.selectOption(backupId!);
  await openInvoice(page, 'WF-LEAVE');
  await page
    .getByRole('button', { name: 'Approve current version', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toContainText('Waiting for Owner');
  await closeDrawer(page);
  await request.post('http://127.0.0.1:8001/__test/leave', {
    data: { finance: false, owner: false },
  });
  await page.getByLabel('DEMO ROLE').selectOption('Owner');
  await openInvoice(page, 'WF-LEAVE');
  await page
    .getByRole('button', { name: 'Approve current version', exact: true })
    .click();
  await expandInvoiceDetails(page);
  await page.getByLabel('Payment amount (MYR)').fill('1');
  await page.getByRole('button', { name: 'Record payment', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Invalidated');
  await expect(
    page.getByRole('button', { name: 'Simulate send', exact: true }),
  ).toHaveCount(0);
  await closeDrawer(page);
  await page.reload();
  await openInvoice(page, 'WF-LEAVE');
  await expect(page.getByRole('dialog')).toContainText('Invalidated');
  await expect(
    page.getByRole('button', { name: 'Create template draft', exact: true }),
  ).toBeVisible();
});

async function expandInvoiceDetails(page: import('@playwright/test').Page) {
  const details = page.locator('.invoice-secondary');
  if (!(await details.getAttribute('open'))) {
    if (!(await details.evaluate((node) => (node as HTMLDetailsElement).open)))
      await details.locator('summary').first().click();
  }
}

test('unified stages keep drafts visible, defer persists, and keyboard tabs work', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('DEMO ROLE').selectOption('Finance');
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Follow-ups', exact: true })
    .click();
  await expect(page.getByRole('tablist', { name: 'Reminder stages' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Reminder Workflow', exact: true }),
  ).toHaveCount(0);
  const row = page.locator('.followup-row').filter({ hasText: 'WF-INVALID' });
  await row.getByRole('button', { name: 'Prepare reminder' }).click();
  await page.getByRole('button', { name: 'Create template draft', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(
    'Next: Submit for Finance approval',
  );
  await closeDrawer(page);
  await expect(page.getByRole('tab', { name: /^Drafts/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await row.getByRole('button', { name: 'Continue draft' }).click();
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('button', { name: 'Snooze', exact: true }).click();
  await page.getByLabel('Snooze until (Malaysia date)').fill('2099-01-01');
  await page.getByLabel('Decision reason').fill('Customer requested time');
  await page.getByRole('button', { name: 'Confirm snooze' }).click();
  await expect(page.getByRole('dialog')).toContainText('Deferred until 2099-01-01');
  await closeDrawer(page);
  await expect(page.getByRole('tab', { name: /^Deferred/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(row).toContainText('Customer requested time');
  await page.reload();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Follow-ups', exact: true })
    .click();
  const ready = page.getByRole('tab', { name: /^Ready / }).first();
  await ready.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /^Drafts/ })).toBeFocused();
  await page.getByRole('tab', { name: /^Deferred/ }).click();
  await expect(row).toContainText('2099-01-01');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.main-shell')).toHaveCSS('margin-left', '0px');
  await page.screenshot({
    path: 'test-results/followups-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  const overflow = await page.locator('main').evaluate((node) => ({
    width: node.clientWidth,
    scroll: node.scrollWidth,
    elements: [...node.querySelectorAll('*')]
      .filter(
        (el) => el.getBoundingClientRect().right > node.getBoundingClientRect().right + 1,
      )
      .map((el) => `${el.tagName}.${el.className}: ${el.getBoundingClientRect().width}`)
      .slice(0, 10),
  }));
  expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width);
});

test('failed draft edits retain text and skip moves to Deferred across reload', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Follow-ups', exact: true })
    .click();
  const row = page.locator('.followup-row').filter({ hasText: 'QUEUE-SAFETY' });
  await row.getByRole('button', { name: 'Prepare reminder' }).click();
  await page.getByRole('button', { name: 'Create template draft', exact: true }).click();
  const body = page.getByLabel('Saved reminder text');
  const edited = (await body.inputValue()) + '\nPlease confirm receipt.';
  await body.fill(edited);
  await page.route('**/api/drafts/*/versions', (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Test conflict: please retry' }),
    }),
  );
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'Test conflict',
  );
  await expect(body).toHaveValue(edited);
  await page.unroute('**/api/drafts/*/versions');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Version 2');
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('button', { name: 'Skip today', exact: true }).click();
  await page.getByLabel('Decision reason').fill('Follow up tomorrow');
  await page.getByRole('button', { name: 'Confirm skip', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Skipped');
  await closeDrawer(page);
  await expect(page.getByRole('tab', { name: /^Deferred/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(row).toContainText('Follow up tomorrow');
  await page.reload();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Follow-ups', exact: true })
    .click();
  await page.getByRole('tab', { name: /^Deferred/ }).click();
  await expect(row).toContainText('Follow up tomorrow');
});

test('temporary seed button adds persistent examples without replacing existing invoices', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await page.getByLabel('DEMO ROLE').selectOption('Finance');
  const before = await request.get('http://127.0.0.1:8001/api/invoices', {
    headers: { 'X-Role': 'Finance' },
  });
  const previous = (await before.json()).invoices;
  const seed = page.getByRole('button', { name: 'Add test data', exact: true });
  await expect(seed).toBeVisible();
  await seed.click();
  await expect(page.getByRole('heading', { name: 'Follow-ups', level: 1 })).toBeVisible();
  const after = await request.get('http://127.0.0.1:8001/api/invoices', {
    headers: { 'X-Role': 'Finance' },
  });
  const saved = (await after.json()).invoices;
  expect(saved.length).toBe(previous.length + 7);
  expect(
    previous.every((old: { id: string }) =>
      saved.some((row: { id: string }) => row.id === old.id),
    ),
  ).toBe(true);
  const examples = saved.filter((row: { invoice_no: string }) =>
    row.invoice_no.startsWith('TEST-'),
  );
  expect(examples).toHaveLength(7);
  expect(
    examples.find((row: { invoice_no: string }) => row.invoice_no.endsWith('-PARTIAL'))
      .outstanding_amount,
  ).toBe('1000.00');
  expect(
    examples.find((row: { invoice_no: string }) => row.invoice_no.endsWith('-PAID'))
      .status,
  ).toBe('paid');
  const rows = page.locator('.followup-row');
  await expect(rows.filter({ hasText: '-STANDARD' })).toHaveCount(1);
  await expect(rows.filter({ hasText: '-HIGH-VALUE' })).toHaveCount(1);
  await expect(rows.filter({ hasText: '-AT-THRESHOLD' })).toHaveCount(1);
  await expect(rows.filter({ hasText: '-DO-NOT-CONTACT' })).toHaveCount(0);
  await expect(rows.filter({ hasText: '-FUTURE' })).toHaveCount(0);
  await expect(rows.filter({ hasText: '-PAID' })).toHaveCount(0);
  await page.reload();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Follow-ups', exact: true })
    .click();
  await expect(rows.filter({ hasText: '-STANDARD' })).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.main-shell')).toHaveCSS('margin-left', '0px');
  await expect(seed).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
