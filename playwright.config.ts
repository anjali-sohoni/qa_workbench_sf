import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  // Look for spec files in all subdirectories of tests/
  testDir: './tests',
  testMatch: '**/*.spec.ts',

  // Per-test timeout. Cross-app beforeAll authenticates two apps — needs headroom.
  timeout: 180_000,
  expect: { timeout: 15_000 },

  // Run tests in a single worker in CI (avoids SF rate-limit / session conflicts)
  workers: process.env.CI ? 1 : undefined,
  fullyParallel: false,

  // Retry once on failure (flaky network / SF load)
  retries: process.env.CI ? 1 : 0,

  reporter: [
    ['list'],
    ['json',  { outputFile: 'test-results.json' }],
    ['html',  { outputFolder: 'playwright-report', open: 'never' }],
  ],

  use: {
    // Headed in local dev, headless in CI
    headless: !!process.env.CI,
    viewport: { width: 1280, height: 800 },
    // 'only-on-failure' captures screenshots at the exact point of failure (not test end).
    // 'on' captures end-of-test state which is often post-cleanup and doesn't show the error.
    // Video: 'on' covers the full flow including beforeAll login for auth debugging.
    screenshot: 'only-on-failure',
    video:      'on',
    trace:      'on',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
