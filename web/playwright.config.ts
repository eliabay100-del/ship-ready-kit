import { defineConfig, devices } from '@playwright/test';
import { config } from './lib/config';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 4 : undefined,
  reporter: isCI
    ? [['github'], ['html', { open: 'never' }], ['json', { outputFile: '.cache/results.json' }]]
    : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: config.baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    ignoreHTTPSErrors: false,
    extraHTTPHeaders: { 'x-ship-ready-audit': '1' },
  },

  // Only used by `npm run test:fixtures` (the reference site).
  webServer:
    process.env.FIXTURE_SITE === '1'
      ? {
          command: 'node fixtures/site/server.mjs',
          url: 'http://localhost:4173',
          reuseExistingServer: !isCI,
          stdout: 'ignore',
          stderr: 'pipe',
        }
      : undefined,

  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      testIgnore: /05-mobile-and-responsive\.spec\.ts/,
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
      testMatch: /05-mobile-and-responsive\.spec\.ts/,
    },
  ],
});
