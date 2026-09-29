import { defineConfig } from '@playwright/test';
const basePath = process.env.PLAYWRIGHT_BASE_PATH || '/';
export default defineConfig({
  webServer: { command: 'npm run preview -- --host 127.0.0.1 --port 4174 --strictPort', url: `http://127.0.0.1:4174${basePath}`, reuseExistingServer: false, env: { VITE_BASE_PATH: basePath } },
  testDir: './tests/e2e', timeout: 90000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:4174', headless: true,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {},
    trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
