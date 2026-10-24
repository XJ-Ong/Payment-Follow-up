import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  outputDir: 'test-results/weekly',
  testMatch: 'weekly.spec.ts',
  use: {
    baseURL: 'http://127.0.0.1:5192',
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge',
  },
  webServer: {
    env: {
      VITE_AUTH_MODE: 'demo',
      VITE_DATA_MODE: 'database',
      VITE_API_URL: 'http://127.0.0.1:8012',
    },
    command: 'npm.cmd run dev -- --port 5192 --strictPort',
    url: 'http://127.0.0.1:5192',
    reuseExistingServer: !process.env.CI,
  },
});
