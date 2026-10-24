import { expect, test } from '@playwright/test';
import type { Profile } from '../src/frontend/settingsTypes';
import type { Draft } from '../src/frontend/workflowTypes';

test.use({ baseURL: 'http://127.0.0.1:5190' });

for (const scenario of [
  { source: 'ai', label: 'AI-generated', reason: null },
  { source: 'template', label: 'Template-generated', reason: 'ai_unavailable' },
  {
    source: 'template',
    label: 'Template-generated',
    reason: 'ai_error: secret provider details',
  },
  { source: 'template', label: 'Template-generated', reason: 'verification_failed' },
  { source: 'human', label: 'Human-written', reason: null },
] as const) {
  test(`saved draft source: ${scenario.source} ${scenario.reason ?? ''}`, async ({
    page,
  }) => {
    let current: Draft | null = null;
    const history: Draft[] = [];
    let conflict = false;
    let profile: Profile = {
      client_id: 'customer-1',
      name: 'Source Customer',
      email: 'customer@example.test',
      phone: '0123456789',
      grace_days: 3,
      revision: 1,
      relationship_tier: 'New',
      preferred_channel: 'Email',
      telegram_chat_id: null,
      language: 'English',
      tone: 'Friendly',
      do_not_contact: false,
    };
    const rules = {
      revision: 1,
      grace_days_by_tier: { New: 3, Regular: 7, Key: 14 },
      alert_threshold: '100',
      safety_flag_days: 30,
      min_spacing_days: 3,
      skip_holidays: false,
      primary_approver_id: 'owner',
    };
    const makeDraft = (source: Draft['written_by'], version: number): Draft => ({
      id: `draft-${version}`,
      invoice_id: 'invoice-1',
      invoice_no: 'INV-SOURCE',
      version,
      status: 'draft',
      body: 'Saved reminder message',
      channel: profile.preferred_channel,
      language: profile.language,
      tone: profile.tone,
      written_by: source,
      ai_model: source === 'ai' ? 'test-model' : null,
      prompt_version: source === 'ai' ? 'v1' : null,
      verification_result: scenario.reason ? { fallback_reason: scenario.reason } : null,
      recipient: 'customer@example.test',
      prepared_by: 'owner',
      author_name: 'Owner',
      historical: false,
      is_current: true,
      supersedes_id: null,
      created_at: '2026-10-25T00:00:00Z',
      required_approvals: 2,
      assigned_approver_id: null,
      assigned_approver_name: null,
      waiting_reason: null,
      allowed_actions: ['versions', 'submit'],
      approvals: [],
    });
    const workspace = () => ({
      as_of_date: '2026-10-25',
      computed_at: '2026-10-25T00:00:00Z',
      rules,
      customers: [
        {
          id: 'customer-1',
          name: 'Source Customer',
          contact: 'customer@example.test',
          initials: 'SC',
          color: '#123456',
          graceDays: 3,
          doNotContact: profile.do_not_contact,
          profile,
        },
      ],
      invoices: [
        {
          id: 'invoice-1',
          invoice_no: 'INV-SOURCE',
          explanation:
            scenario.source === 'ai' ? 'This invoice has a high overdue balance.' : null,
          client_id: 'customer-1',
          issue_date: '2026-08-01',
          due_date: '2026-09-01',
          total_amount: '1000.00',
          payments: '0.00',
          status: 'open',
          workflow: {
            current,
            latest: current,
            suppressed_until: null,
            suppression_reason: null,
          },
          calculation: {
            outstanding_amount: '1000.00',
            days_overdue: 54,
            grace_days: 3,
            effective_days: 51,
            score: '51000.00',
            rank: 1,
            trigger_type: 'both',
            eligible: !profile.do_not_contact,
            exclusion_reasons: profile.do_not_contact
              ? ['Customer is marked do not contact']
              : [],
            holidays_excluded: [],
            last_sent_date: null,
            reason: 'Ready for follow-up',
          },
        },
      ],
      dashboard: {
        total_outstanding: '1000.00',
        total_overdue: '1000.00',
        queue_count: 1,
        alert_count: 0,
        customer_balances: [],
        ranking_ids: ['invoice-1'],
      },
      alerts: [],
    });
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      let json: unknown = [];
      if (path === '/api/customers/customer-1/profile') {
        if (route.request().method() === 'POST') {
          if (conflict) {
            conflict = false;
            await route.fulfill({
              status: 409,
              json: { detail: 'Preferences changed; reload saved values.' },
            });
            return;
          }
          profile = {
            ...profile,
            ...route.request().postDataJSON(),
            revision: profile.revision + 1,
          };
          if (current) {
            history[0] = {
              ...current,
              status: 'invalidated',
              historical: true,
              is_current: false,
            };
            current = null;
          }
          json = { workspace: workspace(), invalidated_journeys: 1 };
        } else json = profile;
      } else if (path === '/api/settings/rules') json = rules;
      else if (path.startsWith('/api/followups')) json = workspace();
      else if (path === '/api/users')
        json = [{ id: 'owner', name: 'Owner', role: 'owner', is_default: true }];
      else if (path === '/api/invoices/invoice-1/drafts') {
        if (route.request().method() === 'POST') {
          current = makeDraft(scenario.source, 1);
          history.unshift(current);
          json = current;
        } else json = history;
      } else if (path.endsWith('/versions')) {
        history[0] = {
          ...history[0],
          historical: true,
          is_current: false,
          status: 'superseded',
        };
        current = { ...makeDraft('human', 2), body: route.request().postDataJSON().body };
        history.unshift(current);
        json = current;
      }
      await route.fulfill({ json });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'INV-SOURCE', exact: true }).first().click();
    const explanation = page.getByRole('region', {
      name: 'Why this invoice needs attention',
    });
    await expect(explanation).toHaveCount(scenario.source === 'ai' ? 1 : 0);
    if (scenario.source === 'ai') {
      await expect(explanation).toContainText('This invoice has a high overdue balance.');
      await expect(explanation).toContainText('Template-generated');
      await explanation.screenshot({ path: 'test-results/ranking-explanation.png' });
    }
    await page.getByRole('button', { name: 'Review follow-up', exact: true }).click();
    await expect(explanation).toHaveCount(scenario.source === 'ai' ? 1 : 0);
    if (scenario.source === 'ai')
      await expect(explanation).toContainText('This invoice has a high overdue balance.');

    const panel = page.locator('.workflow-panel');
    await expect(panel).toContainText(
      'Uses AI when configured; otherwise uses a template. Review the message before approval.',
    );
    await panel
      .getByRole('button', { name: 'Create reminder draft', exact: true })
      .click();
    await expect(panel.locator('.draft-source').first()).toContainText(scenario.label);
    if (
      scenario.reason?.startsWith('ai_error:') ||
      scenario.reason === 'verification_failed'
    ) {
      await expect(panel).toContainText(
        'AI could not produce a usable reminder. A template was used instead.',
      );
    } else if (scenario.source === 'template') {
      await expect(panel).toContainText('This reminder was prepared using a template.');
      await expect(panel).not.toContainText('AI could not produce');
    }
    await expect(panel).not.toContainText('secret provider details');
    await panel.getByLabel('Saved reminder text').fill('Human edited reminder');
    await expect(panel.locator('.draft-source').first()).toContainText(scenario.label);
    await panel.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(panel.locator('.draft-source').first()).toContainText('Human-written');
    await panel.getByText('Draft version history', { exact: false }).click();
    const original = panel.locator('details article').filter({ hasText: 'Version 1' });
    await expect(original).toContainText('(historical)');
    await expect(original.locator('.draft-source')).toContainText(scenario.label);
    if (scenario.source !== 'ai') return;
    const preferences = panel.getByRole('button', {
      name: 'Edit customer preferences',
      exact: true,
    });
    await expect(
      panel.getByRole('region', { name: 'Customer reminder preferences' }),
    ).toContainText('English ? Friendly ? Email');
    await panel.getByLabel('Saved reminder text').fill('Unsaved message');
    page.once('dialog', (dialog) => dialog.dismiss());
    await preferences.click();
    await expect(panel.getByLabel('Saved reminder text')).toHaveValue('Unsaved message');
    page.once('dialog', (dialog) => dialog.accept());
    await preferences.click();
    const editor = page.getByRole('dialog', { name: 'Edit customer preferences' });
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await editor.getByLabel('Language', { exact: true }).selectOption('Bahasa Malaysia');
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(panel.getByLabel('Saved reminder text')).toHaveValue(
      'Human edited reminder',
    );
    await expect(
      panel.getByRole('region', { name: 'Customer reminder preferences' }),
    ).toContainText('English ? Friendly ? Email');
    await preferences.click();
    await expect(
      editor.getByRole('button', { name: 'Save and recalculate' }),
    ).toBeDisabled();
    await editor.getByLabel('Language', { exact: true }).selectOption('Bahasa Malaysia');
    conflict = true;
    await editor.getByRole('button', { name: 'Save and recalculate' }).click();
    await expect(editor.getByRole('alert')).toContainText('Preferences changed');
    await editor.getByRole('button', { name: 'Reload saved values' }).click();
    await expect(editor.getByLabel('Language', { exact: true })).toHaveValue('English');
    await editor.getByLabel('Language', { exact: true }).selectOption('Bahasa Malaysia');
    await editor.getByLabel('Tone', { exact: true }).selectOption('Firm');
    await editor
      .getByLabel('Preferred channel', { exact: true })
      .selectOption('Telegram');
    await expect(editor.getByRole('textbox', { name: /Telegram/ })).toBeVisible();
    await editor.getByRole('button', { name: 'Save and recalculate' }).click();
    await expect(editor).toBeVisible(); // Telegram chat ID is required.
    await editor.getByRole('textbox', { name: /Telegram/ }).fill('123456');
    await editor.getByRole('button', { name: 'Save and recalculate' }).click();
    await expect(editor).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Review follow-up' })).toContainText(
      'INV-SOURCE',
    );
    await expect(
      panel.getByRole('region', { name: 'Customer reminder preferences' }),
    ).toContainText('Bahasa Malaysia ? Firm ? Telegram');
    await expect(panel.getByLabel('Saved reminder text')).toHaveCount(0);
    await panel.getByRole('button', { name: 'Create reminder draft' }).click();
    await expect(panel.locator('.reminder-recipient')).toContainText(
      'Telegram - Bahasa Malaysia - Firm',
    );
    await preferences.click();
    await editor.getByLabel('Do not contact', { exact: true }).check();
    await editor.getByRole('button', { name: 'Save and recalculate' }).click();
    await expect(
      panel.getByRole('button', { name: 'Create reminder draft' }),
    ).toHaveCount(0);
    await expect(preferences).toBeVisible();
    await preferences.click();
    await editor.getByLabel('Do not contact', { exact: true }).uncheck();
    await editor.getByRole('button', { name: 'Save and recalculate' }).click();
    await expect(
      panel.getByRole('button', { name: 'Create reminder draft' }),
    ).toBeVisible();
  });
}
