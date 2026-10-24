import { expect, test, type Page } from '@playwright/test';
import { workspace } from './fixtures/weekly';

test.use({ baseURL: 'http://127.0.0.1:5283' });

async function setup(
  page: Page,
  options: {
    role?: 'Owner' | 'Finance';
    failSessionOnce?: boolean;
    demoAccounts?: boolean;
    existingOwner?: boolean;
  } = {},
) {
  let signedIn = false;
  let sessionFailed = false;
  let workspaceRequests = 0;
  const session = {
    user: { id: 'staff-1', name: 'Team Member', role: options.role ?? 'Owner' },
    csrf_token: 'test-csrf-token',
  };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const headers = route.request().headers();
    expect(headers['x-role']).toBeUndefined();
    expect(headers['x-user-id']).toBeUndefined();
    if (path === '/api/auth/demo-accounts')
      return route.fulfill({
        json: {
          accounts: options.demoAccounts
            ? [
                {
                  label: 'Owner',
                  email: 'admin@test.com',
                  password: options.existingOwner ? null : 'admintest12345',
                },
              ]
            : [],
        },
      });
    if (path === '/api/auth/me') {
      if (options.failSessionOnce && !sessionFailed) {
        return route.abort('failed');
      }
      return route.fulfill(
        signedIn
          ? { json: session }
          : { status: 401, json: { detail: 'Sign in to continue' } },
      );
    }
    if (path === '/api/auth/login') {
      const input = route.request().postDataJSON();
      if (
        input.password !== 'a-private-test-password' &&
        input.password !== 'admintest12345'
      )
        return route.fulfill({
          status: 401,
          json: { detail: 'Invalid email or password' },
        });
      signedIn = true;
      return route.fulfill({ json: session });
    }
    if (route.request().method() === 'POST')
      expect(headers['x-csrf-token']).toBe(session.csrf_token);
    if (path === '/api/auth/logout') {
      signedIn = false;
      return route.fulfill({ status: 204 });
    }
    if (!signedIn)
      return route.fulfill({ status: 401, json: { detail: 'Sign in to continue' } });
    if (path.startsWith('/api/followups')) {
      workspaceRequests += 1;
      return route.fulfill({ json: workspace });
    }
    if (path === '/api/users')
      return route.fulfill({
        json: [
          { ...session.user, role: session.user.role.toLowerCase(), is_default: true },
        ],
      });
    return route.fulfill({ json: [] });
  });
  await page.goto('/');
  return {
    allowSessionRetry: () => {
      sessionFailed = true;
    },
    expire: () => {
      signedIn = false;
    },
    workspaceRequests: () => workspaceRequests,
  };
}

async function signIn(page: Page) {
  await page.getByLabel('Email address', { exact: true }).fill('team@example.test');
  await page.getByLabel('Password', { exact: true }).fill('a-private-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Payment Follow-up', exact: true }),
  ).toBeVisible();
}

test('private login handles invalid credentials, persists reload and signs out', async ({
  page,
}) => {
  const state = await setup(page);
  await expect(
    page.getByRole('heading', { name: 'Welcome back', exact: true }),
  ).toBeVisible();
  expect(state.workspaceRequests()).toBe(0);
  await page.screenshot({ path: 'test-results/login-desktop.png', fullPage: true });
  await page.getByLabel('Email address', { exact: true }).fill('team@example.test');
  await page.getByLabel('Password', { exact: true }).fill('incorrect-password');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute(
    'type',
    'text',
  );
  await page.getByRole('button', { name: 'Hide password' }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Invalid email or password');
  expect(state.workspaceRequests()).toBe(0);
  await signIn(page);
  await expect(page.getByLabel('DEMO ROLE')).toHaveCount(0);
  await expect(page.getByLabel('DEMO USER')).toHaveCount(0);
  await expect(page.locator('.sidebar .user')).toContainText('Team Member');
  await expect(page.locator('.sidebar .user')).toContainText('Owner');
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Payment Follow-up', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Welcome back', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Welcome back', exact: true }),
  ).toBeVisible();
});

test('session expiry clears the workspace and Finance cannot select another identity', async ({
  page,
}) => {
  const state = await setup(page, { role: 'Finance' });
  await signIn(page);
  await expect(page.locator('.sidebar .user')).toContainText('Finance');
  await expect(page.getByLabel('DEMO ROLE')).toHaveCount(0);
  const refresh = page.getByRole('button', { name: 'Refresh now', exact: true });
  await expect(refresh).toBeEnabled();
  state.expire();
  await refresh.click();
  await expect(
    page.getByRole('heading', { name: 'Welcome back', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Your session has ended');
  await expect(page.getByRole('navigation')).toHaveCount(0);
});

test('session connection errors can be retried and mobile login fits the viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await setup(page, { failSessionOnce: true });
  await expect(page.getByRole('alert')).toContainText('Unable to connect');
  state.allowSessionRetry();
  await page.getByRole('button', { name: 'Retry connection' }).click();
  await expect(page.getByLabel('Email address', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/login-mobile.png', fullPage: true });
  await signIn(page);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
});

test('seeded demo account credentials appear below login and fill the form', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, { demoAccounts: true });
  const accounts = page.getByRole('region', { name: 'Demo accounts', exact: true });
  await expect(accounts).toContainText('admin@test.com');
  await expect(accounts).toContainText('admintest12345');
  await accounts.getByRole('button', { name: 'Use Owner demo account' }).click();
  await expect(page.getByLabel('Email address', { exact: true })).toHaveValue(
    'admin@test.com',
  );
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue(
    'admintest12345',
  );
  await expect(
    page.getByRole('heading', { name: 'Welcome back', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await accounts.screenshot({ path: 'test-results/demo-accounts.png' });
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Payment Follow-up', exact: true }),
  ).toBeVisible();
});

test('existing Owner is listed without exposing or replacing the password', async ({
  page,
}) => {
  await setup(page, { demoAccounts: true, existingOwner: true });
  const accounts = page.getByRole('region', { name: 'Demo accounts', exact: true });
  await expect(accounts).toContainText('admin@test.com');
  await expect(accounts).toContainText('Use your existing Owner password');
  await expect(accounts).not.toContainText('admintest12345');
  await page.getByLabel('Password', { exact: true }).fill('previous-unsaved-password');
  await accounts.getByRole('button', { name: 'Use Owner demo account' }).click();
  await expect(page.getByLabel('Email address', { exact: true })).toHaveValue(
    'admin@test.com',
  );
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  await page.getByLabel('Password', { exact: true }).fill('a-private-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Payment Follow-up', exact: true }),
  ).toBeVisible();
});
