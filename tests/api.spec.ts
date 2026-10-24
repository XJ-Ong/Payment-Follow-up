import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('WhatsApp demo preferences and approved simulation persist without external sending', async ({
  page,
  request,
}) => {
  const api = 'http://127.0.0.1:8001/api';
  const headers = { 'X-Role': 'Finance' };
  const initial = await (await request.get(`${api}/invoices`, { headers })).json();
  const customer = initial.customers[1];
  const url = `${api}/customers/${customer.id}/profile`;
  const original = await (await request.get(url, { headers })).json();
  const calls = await (await request.get('http://127.0.0.1:8001/__test/telegram')).json();
  await page.goto('/');
  await page.getByLabel('DEMO ROLE').selectOption('Finance');
  await page.getByRole('button', { name: 'Customer Profiles', exact: true }).click();
  await page
    .locator('.customer-profile')
    .filter({ hasText: customer.name })
    .getByRole('button', { name: 'Edit preferences' })
    .click();
  await page.getByLabel('Preferred channel').selectOption('WhatsApp');
  await expect(page.getByRole('dialog')).toContainText('WhatsApp is demo only');
  await page
    .getByLabel('Tone', { exact: true })
    .selectOption(original.tone === 'Firm' ? 'Friendly' : 'Firm');
  await page.getByRole('button', { name: 'Save and recalculate', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const number = `WHATSAPP-DEMO-${Date.now()}`;
  const today = new Date(`${initial.as_of_date}T00:00:00Z`);
  const before = (days: number) =>
    new Date(today.getTime() - days * 86400000).toISOString().slice(0, 10);
  expect(
    (
      await request.post(`${api}/invoices`, {
        headers,
        data: {
          invoice_no: number,
          client_id: customer.id,
          issue_date: before(60),
          due_date: before(40),
          total_amount: '1000',
          initial_payment: '0',
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.reload();
  await page.getByLabel('DEMO ROLE').selectOption('Finance');
  await openInvoice(page, number);
  await page.getByRole('button', { name: 'Create template draft', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(
    'Sending also records your approval.',
  );
  await page.getByRole('button', { name: 'Simulate send', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Simulated dispatch saved');
  expect(
    (await (await request.get('http://127.0.0.1:8001/__test/telegram')).json()).calls,
  ).toBe(calls.calls);
  await page.reload();
  await openInvoice(page, number);
  await expect(page.getByRole('dialog')).toContainText('Simulated dispatch saved');
  const receipts = await (await request.get(`${api}/outbox`, { headers })).json();
  expect(
    receipts.find((r: { invoice_no: string }) => r.invoice_no === number),
  ).toMatchObject({ channel: 'WhatsApp', status: 'simulated' });
  const saved = await (await request.get(url, { headers })).json();
  const {
    relationship_tier,
    preferred_channel,
    telegram_chat_id,
    language,
    tone,
    do_not_contact,
  } = original;
  expect(
    (
      await request.post(url, {
        headers,
        data: {
          revision: saved.revision,
          relationship_tier,
          preferred_channel,
          telegram_chat_id,
          language,
          tone,
          do_not_contact,
        },
      })
    ).ok(),
  ).toBeTruthy();
});

for (const total of ['1000', '30000']) {
  test(`Telegram customer setup and ${total === '1000' ? 'standard' : 'high-value'} reminder survive reload`, async ({
    page,
    request,
  }) => {
    const api = 'http://127.0.0.1:8001/api';
    const headers = { 'X-Role': 'Finance' };
    const initial = await (await request.get(`${api}/invoices`, { headers })).json();
    const customer = initial.customers[0];
    await page.goto('/');
    await page.getByLabel('DEMO ROLE').selectOption('Finance');
    await page.getByRole('button', { name: 'Customer Profiles', exact: true }).click();
    await page
      .locator('.customer-profile')
      .filter({ hasText: customer.name })
      .getByRole('button', { name: 'Edit preferences' })
      .click();
    await expect(
      page.getByLabel('Preferred channel').locator('option[value="WhatsApp"]'),
    ).not.toHaveAttribute('disabled', '');
    await page.getByLabel('Preferred channel').selectOption('Telegram');
    await page
      .getByLabel('Telegram chat ID')
      .fill(total === '1000' ? '123456789' : '987654321');
    await page.getByRole('button', { name: 'Save and recalculate', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const number = `TELEGRAM-${total}-${Date.now()}`;
    const today = new Date(`${initial.as_of_date}T00:00:00Z`);
    const before = (days: number) =>
      new Date(today.getTime() - days * 86400000).toISOString().slice(0, 10);
    const created = await request.post(`${api}/invoices`, {
      headers,
      data: {
        invoice_no: number,
        client_id: customer.id,
        issue_date: before(60),
        due_date: before(40),
        total_amount: total,
        initial_payment: '0',
      },
    });
    expect(created.ok()).toBeTruthy();
    await page.reload();
    await page.getByLabel('DEMO ROLE').selectOption('Finance');
    await openInvoice(page, number);
    await page
      .getByRole('button', { name: 'Create template draft', exact: true })
      .click();
    if (total === '30000') {
      await page
        .getByRole('button', { name: 'Submit for Finance approval', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Approve current version', exact: true })
        .click();

      await expect(page.getByRole('dialog')).toContainText('Awaiting Owner approval');
      await closeDrawer(page);
      await page.getByLabel('DEMO ROLE').selectOption('Owner');
      await openInvoice(page, number);
      await page
        .getByRole('button', { name: 'Approve current version', exact: true })
        .click();
    }
    const body =
      total === '30000'
        ? await page.locator('.approved-message pre').innerText()
        : await page.getByLabel('Saved reminder text').inputValue();
    const calls = await (
      await request.get('http://127.0.0.1:8001/__test/telegram')
    ).json();
    const response = page.waitForResponse(
      (r) => r.url().endsWith('/send') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Send via Telegram', exact: true }).click();
    const sent = await (await response).json();
    await expect(page.getByRole('dialog')).toContainText('Telegram delivery saved');
    expect(sent.delivery.status).toBe('sent');
    expect(
      (
        await request.post(`${api}/drafts/${sent.id}/send`, {
          headers: { 'X-Role': total === '30000' ? 'Owner' : 'Finance' },
          data: { version: sent.version },
        })
      ).ok(),
    ).toBeTruthy();
    expect(
      (await (await request.get('http://127.0.0.1:8001/__test/telegram')).json()).calls,
    ).toBe(calls.calls + 1);
    await closeDrawer(page);
    await page.reload();
    await page
      .getByRole('navigation')
      .getByRole('button', { name: 'Follow-ups', exact: true })
      .click();
    await page.getByRole('tab', { name: /^Sent/ }).click();
    const row = page.locator('.followup-row').filter({ hasText: number });
    await row.getByText('View saved receipt', { exact: true }).click();
    await expect(row).toContainText('Telegram accepted');
    await expect(row).toContainText(sent.delivery.provider_message_id);
    await expect(row.locator('.receipt-message-text')).toHaveText(body);
    await row.screenshot({ path: `test-results/telegram-${total}.png` });
    // Restore the profile so older independent browser journeys retain their fixtures.
    const url = `${api}/customers/${customer.id}/profile`;
    const saved = await (await request.get(url, { headers })).json();
    const { revision, relationship_tier, language, tone, do_not_contact } = saved;
    expect(
      (
        await request.post(url, {
          headers,
          data: {
            revision,
            relationship_tier,
            preferred_channel: 'Email',
            telegram_chat_id: null,
            language,
            tone,
            do_not_contact,
          },
        })
      ).ok(),
    ).toBeTruthy();
  });
}

test('Audit Log searches saved events, preserves filters and shows recorded changes', async ({
  page,
  request,
}) => {
  const headers = { 'X-Role': 'Finance' };
  const api = 'http://127.0.0.1:8001/api';
  const original = await (await request.get(`${api}/invoices`, { headers })).json();
  const customer = original.customers[0];
  const number = `AUDIT-BROWSER-${Date.now()}`;
  const created = await request.post(`${api}/invoices`, {
    headers,
    data: {
      invoice_no: number,
      client_id: customer.id,
      issue_date: '2026-10-01',
      due_date: '2026-10-02',
      total_amount: '125.50',
      initial_payment: '0',
    },
  });
  expect(created.ok()).toBeTruthy();
  await page.goto('/');
  await page.getByLabel('DEMO ROLE').selectOption('Finance');
  await page.getByRole('button', { name: 'Audit Log', exact: true }).click();
  await page.getByLabel('Search audit log').fill(number);
  await expect(page.getByRole('status')).toHaveText(
    '1 saved events matching your filters',
  );
  const row = page.locator('.audit-event').filter({ hasText: number });
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toContainText('125.50');
  await expect(page.getByRole('dialog')).toContainText(
    'The earlier value was not recorded',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Search audit log')).toHaveValue(number);
  await expect(row).toBeFocused();
  await page.getByLabel('Action', { exact: true }).selectOption('invoice.created');
  await expect(row).toBeVisible();
  await page.getByLabel('Actor type', { exact: true }).selectOption('system');
  await expect(
    page.getByText('No events match these filters. Try clearing or changing them.'),
  ).toBeVisible();
  await page.getByLabel('Actor type', { exact: true }).selectOption('user');
  await expect(row).toBeVisible();
  const users = await (await request.get(`${api}/users`, { headers })).json();
  await page
    .getByLabel('Actor', { exact: true })
    .selectOption(
      users.find(
        (u: { role: string; is_default: boolean }) =>
          u.role === 'finance' && u.is_default,
      ).id,
    );
  await expect(row).toBeVisible();
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  await page.getByLabel('From date', { exact: true }).fill(today);
  await page.getByLabel('To date', { exact: true }).fill(today);
  await expect(row).toBeVisible();
  await page.getByLabel('Search audit log').fill('NO-MATCH-AUDIT');
  await expect(
    page.getByText('No events match these filters. Try clearing or changing them.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page.locator('.audit-event').first()).toBeVisible();
  await page.getByLabel('Search audit log').fill(number);
  await expect(row).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Audit Log', exact: true }).click();
  await page.getByLabel('Search audit log').fill(number);
  await expect(row).toBeVisible();

  const url = `${api}/customers/${customer.id}/profile`;
  const profile = await (await request.get(url, { headers })).json();
  const { revision, relationship_tier, preferred_channel, language, do_not_contact } =
    profile;
  const tone = profile.tone === 'Friendly' ? 'Firm' : 'Friendly';
  expect(
    (
      await request.post(url, {
        headers,
        data: {
          revision,
          relationship_tier,
          preferred_channel,
          language,
          tone,
          do_not_contact,
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh log', exact: true }).click();
  await page
    .getByLabel('Action', { exact: true })
    .selectOption('customer.profile_updated');
  await page.locator('.audit-event').filter({ hasText: customer.name }).first().click();
  await expect(page.getByRole('dialog')).toContainText('Recorded changes');
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: 'Tone', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText(profile.tone);
  await expect(page.getByRole('dialog')).toContainText(tone);
  await closeDrawer(page);
  await page.getByLabel('DEMO ROLE').selectOption('Owner');
  await expect(page.getByLabel('Search audit log')).toHaveValue('');
  await expect(page.locator('.audit-event').first()).toBeVisible();
  const saved = await (await request.get(url, { headers })).json();
  expect(
    (
      await request.post(url, {
        headers,
        data: {
          revision: saved.revision,
          relationship_tier,
          preferred_channel,
          language,
          tone: profile.tone,
          do_not_contact,
        },
      })
    ).ok(),
  ).toBeTruthy();
});

test('Audit Log retries failures and fits a mobile viewport', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Audit Log', exact: true }).click();
  await expect(page.locator('.audit-event').first()).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  expect(
    await page
      .locator('.audit-page')
      .evaluate(
        (el) =>
          el.getBoundingClientRect().left >=
          document.querySelector('.sidebar')!.getBoundingClientRect().right,
      ),
  ).toBeTruthy();
  await page.screenshot({ path: 'test-results/audit-desktop.png' });
  await page.route('**/api/audit?*', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Audit temporarily unavailable' }),
    }),
  );
  await page.getByRole('button', { name: 'Refresh log', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Audit temporarily unavailable');
  await page.unroute('**/api/audit?*');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('.audit-event').first()).toBeVisible();
  await page.route('**/api/audit/*', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Event temporarily unavailable' }),
    }),
  );
  await page.locator('.audit-event').first().click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'Event temporarily unavailable',
  );
  await page.unroute('**/api/audit/*');
  await page.getByRole('button', { name: 'Retry event', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: /^Recorded (facts|changes)$/ }),
  ).toBeVisible();
  await closeDrawer(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Search audit log')).toBeVisible();
  await page.screenshot({ path: 'test-results/audit-mobile.png' });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.locator('.audit-event').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: /^Recorded (facts|changes)$/ }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/audit-detail-mobile.png' });
  await page.locator('.audit-detail').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: /^Recorded (facts|changes)$/ }),
  ).toBeInViewport();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
});

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
  await page.getByLabel('DEMO ROLE').selectOption('Finance');
  const grace = page.getByRole('spinbutton').first();
  await expect(grace).toHaveAttribute('readonly', '');
  await expect(
    page.getByText('Only Owner can edit company-wide rules.', { exact: false }),
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
  await page.getByRole('tab', { name: /^Ready to send/ }).click();
  await page
    .locator('.followup-row')
    .filter({ hasText: 'WF-STANDARD' })
    .getByRole('button', { name: 'Preview and send' })
    .click();
  await expect(body).toHaveValue(original + '\nPlease confirm receipt.');
  await expect(page.getByRole('dialog')).toContainText(
    'Sending also records your approval.',
  );
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
  await page.getByRole('button', { name: 'Audit Log', exact: true }).click();
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
  await expect(page.getByRole('dialog')).toContainText('Next: Preview and simulate send');
  await closeDrawer(page);
  await expect(page.getByRole('tab', { name: /^Ready to send/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await row.getByRole('button', { name: 'Preview and send' }).click();
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
  await expect(page.getByRole('tab', { name: /^Ready to send/ })).toBeFocused();
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

test('customer preferences support cancel, failed saves, conflicts and reminder invalidation', async ({
  page,
  request,
}) => {
  const headers = { 'X-Role': 'Finance' };
  const original = await request.get('http://127.0.0.1:8001/api/invoices', { headers });
  const data = await original.json();
  const customer = data.customers.find(
    (c: { name: string }) => c.name === 'Kedai Kopi Harmoni',
  );
  const number = `CONFIG-${Date.now()}`;
  const due = new Date(`${data.as_of_date}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() - 60);
  const created = await request.post('http://127.0.0.1:8001/api/invoices', {
    headers,
    data: {
      invoice_no: number,
      client_id: customer.id,
      issue_date: due.toISOString().slice(0, 10),
      due_date: due.toISOString().slice(0, 10),
      total_amount: '2000.00',
    },
  });
  expect(created.ok()).toBeTruthy();
  await page.goto('/');
  await page.getByLabel('DEMO ROLE').selectOption('Finance');
  await openInvoice(page, number);
  await page.getByRole('button', { name: 'Create template draft', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(
    'Sending also records your approval.',
  );
  await closeDrawer(page);
  await page.getByRole('button', { name: 'Customer Profiles', exact: true }).click();
  const card = page
    .locator('.customer-profile')
    .filter({ hasText: 'Kedai Kopi Harmoni' });
  await card.getByRole('button', { name: 'Edit preferences' }).click();
  await page.getByLabel('Tone', { exact: true }).focus();
  await page.getByLabel('Tone', { exact: true }).selectOption('Firm');
  await expect(page.getByLabel('Tone', { exact: true })).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.main-shell')).toHaveCSS('margin-left', '0px');
  expect(
    await page
      .getByRole('dialog')
      .evaluate(
        (node) =>
          node.scrollWidth <= node.clientWidth &&
          node.getBoundingClientRect().right <= window.innerWidth,
      ),
  ).toBe(true);
  await page.screenshot({
    path: 'test-results/preferences-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(card).toContainText('Friendly');
  await card.getByRole('button', { name: 'Edit preferences' }).click();
  await page.getByLabel('Tone', { exact: true }).selectOption('Firm');
  await page.route('**/api/customers/*/profile', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 422,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Injected preference error' }),
        })
      : route.continue(),
  );
  await page.getByRole('button', { name: 'Save and recalculate', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'Injected preference error',
  );
  await expect(page.getByLabel('Tone', { exact: true })).toHaveValue('Firm');
  await page.unroute('**/api/customers/*/profile');
  const url = `http://127.0.0.1:8001/api/customers/${customer.id}/profile`;
  const profile = await (await request.get(url, { headers })).json();
  const {
    revision,
    relationship_tier,
    preferred_channel,
    language,
    tone,
    do_not_contact,
  } = profile;
  const concurrent = await request.post(url, {
    headers,
    data: {
      revision,
      relationship_tier,
      preferred_channel,
      language: 'English',
      tone,
      do_not_contact,
    },
  });
  expect(concurrent.ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Save and recalculate', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'Saved values changed',
  );
  await expect(page.getByLabel('Tone', { exact: true })).toHaveValue('Firm');
  await page.getByRole('button', { name: 'Reload saved values', exact: true }).click();
  await expect(page.getByLabel('Language', { exact: true })).toHaveValue('English');
  await page.getByLabel('Tone', { exact: true }).selectOption('Firm');
  await page.getByRole('button', { name: 'Save and recalculate', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(card).toContainText('English / Firm');
  await page.reload();
  await openInvoice(page, number);
  await expect(page.getByRole('dialog')).toContainText('Invalidated');
  await expect(
    page.getByRole('button', { name: 'Simulate send', exact: true }),
  ).toHaveCount(0);
});

test('Owner rules editing handles conflicts and persists while Finance remains read-only', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Rules & Settings', exact: true }).click();
  const key = page.getByLabel('Key grace days', { exact: true });
  await expect(key).toHaveValue('14');
  await key.fill('21');
  await page.getByRole('button', { name: 'Cancel changes', exact: true }).click();
  await expect(key).toHaveValue('14');
  await key.fill('21');
  await page.route('**/api/settings/rules', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 422,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Injected rules error' }),
        })
      : route.continue(),
  );
  await page.getByRole('button', { name: 'Save and recalculate', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Injected rules error');
  await expect(key).toHaveValue('21');
  await page.unroute('**/api/settings/rules');
  const headers = { 'X-Role': 'Owner' };
  const url = 'http://127.0.0.1:8001/api/settings/rules';
  const saved = await (await request.get(url, { headers })).json();
  const {
    revision,
    grace_days_by_tier,
    alert_threshold,
    min_spacing_days,
    skip_holidays,
    second_approval_amount,
  } = saved;
  expect(
    (
      await request.post(url, {
        headers,
        data: {
          revision,
          grace_days_by_tier,
          alert_threshold,
          safety_flag_days: 31,
          min_spacing_days,
          skip_holidays,
          second_approval_amount,
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.getByRole('button', { name: 'Save and recalculate', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Saved values changed');
  await expect(key).toHaveValue('21');
  await page.getByRole('button', { name: 'Reload saved values', exact: true }).click();
  await expect(key).toHaveValue('14');
  await expect(page.getByLabel('Safety days', { exact: true })).toHaveValue('31');
  await key.fill('21');
  await page.getByRole('button', { name: 'Save and recalculate', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Save and recalculate', exact: true }),
  ).toBeDisabled();
  await page.reload();
  await page.getByRole('button', { name: 'Rules & Settings', exact: true }).click();
  await expect(key).toHaveValue('21');
  await page.getByLabel('DEMO ROLE').selectOption('Finance');
  await expect(
    page.getByText('Only Owner can edit company-wide rules.', { exact: false }),
  ).toBeVisible();
  await expect(key).toHaveAttribute('readonly', '');
  await expect(
    page.getByRole('button', { name: 'Save and recalculate', exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.main-shell')).toHaveCSS('margin-left', '0px');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: 'test-results/rules-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
});

test('fixed CSV template download, row correction, atomic import and reload', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await page.getByLabel('DEMO ROLE').selectOption('Finance');
  await page.getByRole('button', { name: 'Add Invoice', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Import CSV', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Import invoices from CSV');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV template', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('invoice-template.csv');
  const filePath = await download.path();
  expect(filePath).toBeTruthy();
  await page.getByLabel('CSV file', { exact: true }).setInputFiles({
    name: download.suggestedFilename(),
    mimeType: 'text/csv',
    buffer: await readFile(filePath!),
  });
  await page.getByRole('button', { name: 'Preview CSV', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Preview: 1 valid, 0 invalid' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Import 1 invoices', exact: true }).click();
  await expect(page.getByRole('heading', { name: '1 invoices imported' })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const headers = { 'X-Role': 'Finance' };
  const loaded = await (
    await request.get('http://127.0.0.1:8001/api/invoices', { headers })
  ).json();
  const customer = loaded.customers.find(
    (c: { name: string }) => c.name === 'Kedai Kopi Harmoni',
  );
  const blocked = loaded.customers.find((c: { doNotContact: boolean }) => c.doNotContact);
  const suffix = Date.now();
  const due = new Date(`${loaded.as_of_date}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() - 40);
  const past = due.toISOString().slice(0, 10);
  const future = new Date(`${loaded.as_of_date}T00:00:00Z`);
  future.setUTCDate(future.getUTCDate() + 14);
  const header =
    'invoice_no,client_id,project_id,issue_date,due_date,total_amount,deposit_paid';
  const rows = [
    `CSV-${suffix}-PARTIAL,${customer.id},,${past},${past},1000.10,100.10`,
    `CSV-${suffix}-PAID,${customer.id},,${past},${past},1000.10,1000.10`,
    `CSV-${suffix}-FUTURE,${customer.id},,${past},${future.toISOString().slice(0, 10)},1000.10,0`,
    `CSV-${suffix}-BLOCKED,${blocked.id},,${past},${past},1000.10,0`,
  ];
  const valid = header + '\r\n' + rows.join('\r\n');
  const invalid = valid.replace(',1000.10,100.10', ',1000.10,1001.00');
  await page.getByRole('button', { name: 'Import CSV', exact: true }).click();
  const input = page.getByLabel('CSV file', { exact: true });
  await input.setInputFiles({
    name: 'invalid.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(invalid),
  });
  await page.getByRole('button', { name: 'Preview CSV', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Preview: 3 valid, 1 invalid' }),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Payment exceeds invoice total');
  await expect(
    page.getByRole('button', { name: 'Import 3 invoices', exact: true }),
  ).toBeDisabled();
  const before = await (
    await request.get('http://127.0.0.1:8001/api/invoices', { headers })
  ).json();
  expect(before.invoices).toHaveLength(loaded.invoices.length);
  await input.setInputFiles({
    name: 'corrected.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(valid),
  });
  await expect(
    page.getByRole('region', { name: 'CSV preview', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Preview CSV', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Preview: 4 valid, 0 invalid' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Import 4 invoices', exact: true }).click();
  await expect(page.getByRole('heading', { name: '4 invoices imported' })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  await openInvoice(page, `CSV-${suffix}-PARTIAL`);
  await expect(page.getByRole('dialog')).toContainText('MYR 900.00');
  await closeDrawer(page);
  const workspace = await (
    await request.get('http://127.0.0.1:8001/api/followups', { headers })
  ).json();
  const imported = workspace.invoices.filter((i: { invoice_no: string }) =>
    i.invoice_no.startsWith(`CSV-${suffix}`),
  );
  expect(imported).toHaveLength(4);
  for (const i of imported)
    expect(workspace.queue_ids.includes(i.id)).toBe(i.invoice_no.endsWith('-PARTIAL'));
  await page.getByRole('button', { name: 'Import CSV', exact: true }).click();
  await input.setInputFiles({
    name: 'same.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(valid),
  });
  await page.getByRole('button', { name: 'Preview CSV', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Preview: 0 valid, 4 invalid' }),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('already exists');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page
      .getByRole('dialog')
      .evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await page.screenshot({
    path: 'test-results/csv-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
});

test('CSV encoding errors and stale preview conflicts keep the import review open', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Invoices & Payments', exact: true }).click();
  await page.getByRole('button', { name: 'Import CSV', exact: true }).click();
  const input = page.getByLabel('CSV file', { exact: true });
  await input.setInputFiles({
    name: 'bad.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from([0xff, 0xfe, 0x41]),
  });
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('UTF-8');
  await input.setInputFiles({
    name: 'large.csv',
    mimeType: 'text/csv',
    buffer: Buffer.alloc(1024 * 1024 + 1, 65),
  });
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('1 MiB');
  const headers = { 'X-Role': 'Owner' };
  const loaded = await (
    await request.get('http://127.0.0.1:8001/api/invoices', { headers })
  ).json();
  const customer = loaded.customers[0];
  const number = `CSV-CONFLICT-${Date.now()}`;
  const text = `invoice_no,client_id,project_id,issue_date,due_date,total_amount,deposit_paid\n${number},${customer.id},,2026-10-01,2026-10-23,1000.00,0`;
  await input.setInputFiles({
    name: 'conflict.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(text),
  });
  await page.getByRole('button', { name: 'Preview CSV', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Preview: 1 valid, 0 invalid' }),
  ).toBeVisible();
  expect(
    (
      await request.post('http://127.0.0.1:8001/api/invoices', {
        headers,
        data: {
          invoice_no: number,
          client_id: customer.id,
          issue_date: '2026-10-01',
          due_date: '2026-10-23',
          total_amount: '1000.00',
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.getByRole('button', { name: 'Import 1 invoices', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'No invoices were saved',
  );
  await expect(
    page.getByRole('heading', { name: 'Preview: 0 valid, 1 invalid' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Import 0 invoices', exact: true }),
  ).toBeDisabled();
});

test('team seven-column CSV imports client codes, optional projects and deposits', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add Invoice', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Import CSV', exact: true })
    .click();
  await page.getByText('Client and project reference list', { exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('CLI-02');
  await expect(page.getByRole('dialog')).toContainText(
    'PRJ-02: Q3 Bulk Wholesale Hardware Supply',
  );
  await page
    .getByLabel('CSV file', { exact: true })
    .setInputFiles('seed_data/valid_invoices_import.csv');
  await page.getByRole('button', { name: 'Preview CSV', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Preview: 4 valid, 0 invalid' }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'CSV preview', exact: true }),
  ).toContainText('31600.00');
  await expect(
    page.getByRole('region', { name: 'CSV preview', exact: true }),
  ).toContainText('Q3 Bulk Wholesale Hardware Supply');
  await page.getByRole('button', { name: 'Import 4 invoices', exact: true }).click();
  await expect(page.getByRole('heading', { name: '4 invoices imported' })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  await openInvoice(page, 'INV-3002');
  await expandInvoiceDetails(page);
  await expect(page.getByRole('dialog')).toContainText('MYR 5,000.00');
});
