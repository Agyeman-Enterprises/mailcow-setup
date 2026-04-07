import { test, expect } from '@playwright/test';

/**
 * 00.smoke.spec.ts — Gate 2: App Loads
 * Covers: app starts, renders, no console errors, correct title
 * Every app must pass this with zero modifications — it tests basics.
 */

test.describe('Gate 2 — App Loads', () => {
  const consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => {
      consoleErrors.push(err.message);
    });
  });

  test('app loads without crash', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  test('page title is not default', async ({ page }) => {
    await page.goto('/');
    const title = await page.title();
    expect(title).not.toBe('React App');
    expect(title).not.toBe('Next.js');
    expect(title).not.toBe('Vite App');
    expect(title).not.toBe('');
  });

  test('zero uncaught JS errors on load', async ({ page }) => {
    await page.goto('/');
    // Wait for page to fully settle
    await page.waitForLoadState('networkidle');
    expect(consoleErrors).toHaveLength(0);
  });

  test('zero failed network requests on load', async ({ page }) => {
    const failedRequests: string[] = [];
    page.on('requestfailed', (req) => {
      // Ignore known external services that may be unavailable in test
      if (!req.url().includes('analytics') && !req.url().includes('telemetry')) {
        failedRequests.push(req.url());
      }
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(failedRequests).toHaveLength(0);
  });

  test('main content area renders', async ({ page }) => {
    await page.goto('/');
    // Check that body has visible content — not a blank page
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.trim().length).toBeGreaterThan(0);
  });
});
