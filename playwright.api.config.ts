import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: 'api.spec.ts',
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:5188',
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge',
  },
});
