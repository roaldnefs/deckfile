import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'test',
  testMatch: '**/*.spec.mjs',
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: { viewport: { width: 1600, height: 900 } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 } } }],
});
