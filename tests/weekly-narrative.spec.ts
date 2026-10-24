import { expect, test, type Page, type Route } from '@playwright/test';
import { summary, workspace } from './fixtures/weekly';

test.use({ baseURL: 'http://127.0.0.1:5190' });

async function setup(page: Page, generate: (route: Route) => Promise<void>) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/summaries/generate')) return generate(route);
    if (url.pathname.endsWith('/reports/weekly-summary')) {
      const previous = url.searchParams.get('week_start') === '2026-10-12';
      return route.fulfill({
        json: previous
          ? {
              ...summary,
              week_start: '2026-10-12',
              week_end: '2026-10-18',
              period_end: '2026-10-18',
              is_current_week: false,
            }
          : summary,
      });
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
    return route.fulfill({ json: [] });
  });
  await page.goto('/');
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Weekly Summary', exact: true })
    .click();
  await expect(
    page.getByRole('region', { name: 'Weekly narrative', exact: true }),
  ).toBeVisible();
}
function response(route: Route, source = 'template', narrative = 'Weekly summary text') {
  const input = route.request().postDataJSON();
  return route.fulfill({
    json: {
      id: 'summary-1',
      week_start: input.week_start,
      week_end: input.week_end,
      metrics: {},
      narrative,
      written_by: source,
      generated_at: '2026-10-24T04:00:00Z',
    },
  });
}

test('weekly narrative uses report cutoff, language, source and Malaysia timestamp', async ({
  page,
}) => {
  const inputs: unknown[] = [];
  await setup(page, async (route) => {
    inputs.push(route.request().postDataJSON());
    await response(
      route,
      inputs.length === 1 ? 'template' : 'ai',
      inputs.length === 1
        ? 'Collections and reminders this week.'
        : 'Ringkasan mingguan.',
    );
  });
  const panel = page.getByRole('region', { name: 'Weekly narrative', exact: true });
  await expect(panel).toContainText('replaces its saved summary, including its language');
  expect(inputs).toHaveLength(0);
  await panel.getByRole('button', { name: 'Generate summary', exact: true }).click();
  await expect(panel).toContainText('Template-generated');
  await expect(panel).toContainText('Collections and reminders this week.');
  await expect(panel).toContainText('19 Oct 2026 to 24 Oct 2026');
  await expect(panel).toContainText('12:00:00 (Malaysia time)');
  await panel.screenshot({ path: 'test-results/narrative-desktop.png' });
  expect(inputs[0]).toEqual({
    week_start: '2026-10-19',
    week_end: '2026-10-24',
    language: 'English',
  });
  await panel.getByLabel('Summary language').selectOption('Bahasa Malaysia');
  await expect(panel).not.toContainText('Collections and reminders this week.');
  await panel.getByRole('button', { name: 'Generate summary', exact: true }).click();
  await expect(panel).toContainText('AI-generated');
  await expect(panel).toContainText('Ringkasan mingguan.');
  expect(inputs[1]).toEqual({
    week_start: '2026-10-19',
    week_end: '2026-10-24',
    language: 'Bahasa Malaysia',
  });
  await page.getByRole('button', { name: 'Previous week', exact: true }).click();
  await expect(panel).not.toContainText('Ringkasan mingguan.');
  await panel.getByRole('button', { name: 'Generate summary', exact: true }).click();
  await expect(panel).toContainText('12 Oct 2026 to 18 Oct 2026');
  expect(inputs[2]).toEqual({
    week_start: '2026-10-12',
    week_end: '2026-10-18',
    language: 'English',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel).toBeVisible();
  expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBeTruthy();
  await panel.screenshot({ path: 'test-results/narrative-mobile.png' });
});

test('weekly narrative errors can be retried without hiding collections', async ({
  page,
}) => {
  let attempts = 0;
  await setup(page, async (route) => {
    if (++attempts === 1)
      await route.fulfill({ status: 503, json: { detail: 'Generation unavailable' } });
    else await response(route);
  });
  const panel = page.getByRole('region', { name: 'Weekly narrative', exact: true });
  await panel.getByRole('button', { name: 'Generate summary', exact: true }).click();
  await expect(panel.getByRole('alert')).toHaveText('Generation unavailable');
  await expect(
    page.getByRole('heading', { name: 'Daily collections', exact: true }),
  ).toBeVisible();
  await panel.getByRole('button', { name: 'Retry summary', exact: true }).click();
  await expect(panel).toContainText('Weekly summary text');
  await expect(panel.getByRole('alert')).toHaveCount(0);
});

for (const change of ['language', 'week', 'identity'] as const) {
  test(`late narrative response is ignored after changing ${change}`, async ({
    page,
  }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const received = new Promise<void>((resolve) => {
      started = resolve;
    });
    let completed!: () => void;
    const finished = new Promise<void>((resolve) => {
      completed = resolve;
    });
    let calls = 0;
    await setup(page, async (route) => {
      if (++calls === 1) {
        started();
        await gate;
        try {
          await response(route, 'template', 'Obsolete narrative');
        } finally {
          completed();
        }
      } else await response(route, 'template', 'Current narrative');
    });
    const panel = page.getByRole('region', { name: 'Weekly narrative', exact: true });
    await panel.getByRole('button', { name: 'Generate summary', exact: true }).click();
    await received;
    await expect(
      panel.getByRole('button', { name: 'Generating summary...', exact: true }),
    ).toBeDisabled();
    if (change === 'language')
      await panel.getByLabel('Summary language').selectOption('Bahasa Malaysia');
    if (change === 'week')
      await page.getByRole('button', { name: 'Previous week', exact: true }).click();
    if (change === 'identity') await page.getByLabel('DEMO ROLE').selectOption('Finance');
    await panel.getByRole('button', { name: 'Generate summary', exact: true }).click();
    await expect(panel).toContainText('Current narrative');
    release();
    await finished;
    await expect(panel).not.toContainText('Obsolete narrative');
    await expect(panel).toContainText('Current narrative');
  });
}
