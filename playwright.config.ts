import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testIgnore: ['api.spec.ts', 'weekly.spec.ts'],
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:5277',
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL,
  },
  webServer: [
    {
      env: { VITE_AUTH_MODE: 'demo', VITE_DATA_MODE: 'demo' },
      command: 'npm.cmd run dev -- --port 5277 --strictPort',
      url: 'http://127.0.0.1:5277',
      reuseExistingServer: false,
    },
    {
      env: {
        VITE_AUTH_MODE: 'demo',
        VITE_DATA_MODE: 'api',
        VITE_API_URL: 'http://127.0.0.1:5280',
      },
      command: 'npm.cmd run dev -- --port 5280 --strictPort',
      url: 'http://127.0.0.1:5280',
      reuseExistingServer: false,
    },
    {
      env: {
        VITE_AUTH_MODE: 'session',
        VITE_DATA_MODE: 'api',
        VITE_API_URL: 'http://127.0.0.1:5283',
      },
      command: 'npm.cmd run dev -- --port 5283 --strictPort',
      url: 'http://127.0.0.1:5283',
      reuseExistingServer: false,
    },
  ],
});
