import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config — Agyeman Enterprises standard
 * Gate coverage:
 *   00.smoke        → Gate 2 (App Loads)
 *   01.auth         → Gate 3 (Auth Flow)
 *   02.crud         → Gate 4 (CRUD)
 *   03.persistence  → Gates 5+6 (Navigation + Data Integrity)
 *   04.navigation   → Gate 5 (Navigation + Mobile)
 *   05.behavioral   → Gates 7+8 (GATE7.txt behavioral spec)
 */
export default defineConfig({
  testDir: './e2e/specs',
  fullyParallel: false, // run sequentially — state depends on order
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      use: {
        ...devices['iPhone SE'],
        viewport: { width: 375, height: 667 },
      },
      testMatch: '**/04.navigation.spec.ts',
    },
  ],
});
