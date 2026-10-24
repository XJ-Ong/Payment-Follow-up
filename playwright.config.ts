import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testIgnore: ['api.spec.ts', 'weekly.spec.ts'],
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:5187',
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL,
  },
  webServer: {
    env: { VITE_DATA_MODE: 'demo' },
    command: 'npm.cmd run dev -- --port 5187 --strictPort',
    url: 'http://127.0.0.1:5187',
    reuseExistingServer: true,
  },
});
