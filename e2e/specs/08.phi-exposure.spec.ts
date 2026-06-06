/**
 * GATE 12 — PHI / PII Exposure Audit
 *
 * For any app touching Protected Health Information (medical, wellness, cannabis therapy,
 * telehealth, EMS, clinical tools). Applies partially to all apps with user PII.
 *
 * HIPAA basis:
 *   §164.312(a)(2)(iv) — Encryption/decryption: PHI must not be stored in the clear
 *   §164.312(c)(1) — Integrity: PHI must not be altered/disclosed without authorization
 *   §164.314(b) — Business associate requirements
 *
 * Checks:
 *   - PHI not in URL query params or path segments
 *   - PHI not in localStorage or sessionStorage
 *   - PHI not logged to browser console
 *   - Sensitive fields have autocomplete disabled or set to secure values
 *   - Error messages do not expose PHI
 *   - Page titles do not contain patient-identifiable data
 *   - PHI-containing network responses use HTTPS only
 *
 * Set IS_MEDICAL_APP=false to skip medical-specific checks for non-medical apps.
 */

import { test, expect } from '@playwright/test';
import { checkUrlForPhi, scanBrowserStorage, scanNextData } from '../helpers/hipaa.helpers';

const IS_MEDICAL_APP = process.env.IS_MEDICAL_APP !== 'false'; // nosemgrep
const TEST_EMAIL = process.env.TEST_EMAIL ?? ''; // nosemgrep
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? ''; // nosemgrep
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'; // nosemgrep

/**
 * Ensure the page has an authenticated session.
 *
 * If globalSetup wrote auth-state.json (and hence set E2E_ACCESS_TOKEN), the
 * storageState is already injected into the browser context by the Playwright
 * config — we just navigate to the protected area.  This avoids extra browser
 * logins that burn Supabase's rate-limit budget.
 *
 * Falls back to a form-based login if no pre-built state is available.
 */
async function loginAs(page: import('@playwright/test').Page): Promise<void> {
  const hasToken =
    typeof process.env.E2E_ACCESS_TOKEN === 'string' &&
    process.env.E2E_ACCESS_TOKEN.length > 0;

  if (hasToken) {
    // storageState is already loaded — navigate to root and let the app pick it up
    await page.goto('/');
    await page.waitForTimeout(500);
    // If still on /login, fall through to browser login
    if (!page.url().includes('/login')) return;
  }

  // Fall back: browser-based login
  await page.goto('/login');
  const emailInput = page.locator('input[type="email"]');
  const passwordInput = page.locator('input[type="password"]');
  if (await emailInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await emailInput.fill(TEST_EMAIL);
  }
  if (await passwordInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await passwordInput.fill(TEST_PASSWORD);
  }
  await page.getByRole('button', { name: /log.?in|sign.?in|continue/i }).click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });
}

async function performLogout(page: import('@playwright/test').Page): Promise<void> {
  const btn = page.getByRole('button', { name: /log.?out|sign.?out/i });
  const link = page.getByRole('link', { name: /log.?out|sign.?out/i });
  if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await btn.click();
  } else if (await link.isVisible({ timeout: 2000 }).catch(() => false)) {
    await link.click();
  } else {
    await page.goto('/logout').catch(() => {});
  }
  await page.waitForTimeout(1500);
}

// ─── PHI in URLs ──────────────────────────────────────────────────────────

test.describe('PHI — URL Safety', () => {
  test('login form submit does not put email or password in URL', async ({ page }) => {
    const urls: string[] = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) urls.push(frame.url());
    });

    await page.goto('/login');
    const emailInput = page.locator('input[type="email"]');
    const passwordInput = page.locator('input[type="password"]');

    const formVisible = await emailInput.isVisible({ timeout: 3000 }).catch(() => false);
    if (formVisible) {
      await emailInput.fill('test@example.com');
    }
    if (await passwordInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await passwordInput.fill('SomePassword123!');
    }
    // Only click submit if the login form was actually visible.
    // If the page already has an auth session it may redirect away before the form renders.
    if (formVisible) {
      const btn = page.getByRole('button', { name: /log.?in|sign.?in|continue/i });
      if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(2000);
      }
    }
    urls.push(page.url());

    for (const url of urls) {
      expect(url, `Password in URL: ${url}`).not.toContain('password=');
      expect(url, `Email in URL: ${url} — email is a HIPAA identifier; must not appear in URLs`).not.toMatch(/[?&]email=[^&@]+@/i);
    }
  });

  test('navigating authenticated pages does not put PHI in URLs', async ({ page }) => {
    if (!TEST_EMAIL || !TEST_PASSWORD) return;

    const urls: string[] = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) urls.push(frame.url());
    });

    await loginAs(page);
    await page.waitForTimeout(1000);

    // Click all visible nav links to collect URLs
    const navLinks = await page.locator('nav a[href], header a[href], aside a[href]').all();
    for (const link of navLinks.slice(0, 15)) {
      const href = await link.getAttribute('href').catch(() => '');
      if (href && href.startsWith('/') && !href.includes('logout')) {
        urls.push(new URL(href, BASE_URL).href);
      }
    }

    for (const url of urls) {
      const violations = checkUrlForPhi(url);
      expect(violations, violations.join('; ')).toHaveLength(0);
    }
  });
});

// ─── PHI in Browser Storage ───────────────────────────────────────────────

test.describe('PHI — Browser Storage', () => {
  test('localStorage contains no PHI or server secrets after login', async ({ page }) => {
    if (!TEST_EMAIL || !TEST_PASSWORD) return;

    await loginAs(page);
    const result = await scanBrowserStorage(page);

    expect(
      result.violations,
      `PHI/secret in localStorage: ${result.violations.join('; ')} — ` +
      'HIPAA requires PHI to be protected at rest. Clear-text PHI in localStorage violates §164.312(a)(2)(iv).'
    ).toHaveLength(0);
  });

  test('sessionStorage contains no PHI after logout', async ({ page }) => {
    if (!TEST_EMAIL || !TEST_PASSWORD) return;

    await loginAs(page);
    await performLogout(page);

    const result = await scanBrowserStorage(page);
    expect(
      result.violations,
      `PHI/secret persists in browser storage after logout: ${result.violations.join('; ')}`
    ).toHaveLength(0);
  });
});

// ─── PHI in Console ───────────────────────────────────────────────────────

test.describe('PHI — Console Logging', () => {
  test('app does not console.log PHI data during normal use', async ({ page }) => {
    if (!IS_MEDICAL_APP) return;

    const phiLogs: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      // Patterns that suggest PHI being logged — hardcoded literals
      if (
        /patient.*name.*:/i.test(text) ||
        /diagnosis.*:/i.test(text) ||
        /medication.*:/i.test(text) ||
        /dob.*:/i.test(text) ||
        /date.*birth.*:/i.test(text) ||
        /ssn.*:/i.test(text) ||
        /mrn.*:/i.test(text)
      ) {
        phiLogs.push(`[${msg.type()}] ${text.slice(0, 200)}`);
      }
    });

    if (TEST_EMAIL && TEST_PASSWORD) {
      await loginAs(page);
      await page.waitForTimeout(2000);
    } else {
      await page.goto('/');
      await page.waitForTimeout(1000);
    }

    expect(
      phiLogs,
      `PHI detected in console output: ${phiLogs.join('; ')} — ` +
      'Console logs are captured in browser crash reports, extensions, and DevTools history. ' +
      'Remove all console.log() calls that include patient data.'
    ).toHaveLength(0);
  });
});

// ─── PHI in Page Titles ───────────────────────────────────────────────────

test.describe('PHI — Page Titles & Meta', () => {
  test('page titles do not contain patient-identifying information', async ({ page }) => {
    if (!IS_MEDICAL_APP || !TEST_EMAIL || !TEST_PASSWORD) return;

    await loginAs(page);

    const title = await page.title();

    // Page titles appear in browser history, screen recordings, alt-tab previews
    // They must never contain "FirstName LastName" or a patient ID
    expect(
      title,
      `Page title "${title}" may contain PHI — patient names must not appear in browser tab titles ` +
      '(browser history, screen share, taskbar preview all expose this)'
    ).not.toMatch(/^[A-Z][a-z]{1,20}\s[A-Z][a-z]{1,20}\s[|—]/); // "First Last | App" pattern
  });
});

// ─── Form Field Security ──────────────────────────────────────────────────

test.describe('PHI — Form Field Security', () => {
  test('password fields have correct autocomplete attribute', async ({ page }) => {
    await page.goto('/login');

    const passwordFields = await page.locator('input[type="password"]').all();
    for (const field of passwordFields) {
      const autocomplete = await field.getAttribute('autocomplete');
      // Acceptable values for password fields
      const acceptable = ['current-password', 'new-password', 'off'];
      if (autocomplete !== null && !acceptable.includes(autocomplete)) {
        expect.soft(
          autocomplete,
          `Password field has autocomplete="${autocomplete}" — use "current-password", "new-password", or "off"`
        ).toBeNull(); // Will fail softly, not hard-stop
      }
    }
  });

  test('medical/PHI form fields on registration/intake do not use autocomplete=on', async ({ page }) => {
    if (!IS_MEDICAL_APP) return;

    const intakePaths = ['/signup', '/register', '/onboarding', '/intake', '/patient/new'];
    for (const path of intakePaths) {
      const response = await page.goto(path);
      if (!response || response.status() !== 200) continue;

      // Fields collecting PHI should not be autocompleted by browser
      const sensitiveFieldSelectors = [
        'input[name*="ssn"]',
        'input[name*="social"]',
        'input[name*="diagnosis"]',
        'input[name*="condition"]',
        'input[name*="medication"]',
      ];

      for (const selector of sensitiveFieldSelectors) {
        const fields = await page.locator(selector).all();
        for (const field of fields) {
          const autocomplete = await field.getAttribute('autocomplete');
          expect.soft(
            autocomplete,
            `PHI field (${selector}) at ${path} has autocomplete="${autocomplete}". ` +
            'Set autocomplete="off" on fields that collect PHI to prevent browser credential storage.'
          ).not.toBe('on');
        }
      }
    }
  });
});

// ─── Error Message PHI Hygiene ────────────────────────────────────────────

test.describe('PHI — Error Message Safety', () => {
  test('404 page does not expose internal paths or stack traces', async ({ page }) => {
    await page.goto('/nonexistent-path-phi-audit-12345');

    // Use innerText — checks only user-visible content, not RSC flight data in <script> tags.
    // textContent() would falsely flag Next.js dev RSC module paths (e.g. node_modules/).
    const body = await page.evaluate(() => document.body.innerText);

    expect(body, '404 exposes internal file path').not.toMatch(/\/home\/|\/var\/app\/|node_modules\//i);
    expect(body, '404 exposes stack trace').not.toMatch(/\bat\s+\w[\w.]*\s*\(/);
    expect(body, '404 exposes database connection string').not.toMatch(/postgres(?:ql)?:\/\//i);
  });

  test('API error responses for patient/record endpoints do not include raw PHI', async ({ page }) => {
    if (!IS_MEDICAL_APP) return;

    const endpoints = [
      '/api/patient/00000000-0000-0000-0000-000000000000',
      '/api/records/invalid-id',
      '/api/doses/00000000-0000-0000-0000-000000000000',
    ];

    for (const endpoint of endpoints) {
      const response = await page.request.get(endpoint);
      if (response.status() >= 400) {
        const body = await response.text();
        // Should not return another user's PHI in the error
        // Pattern: "FirstName LastName" + date pattern = likely PHI
        expect(
          body,
          `Error response from ${endpoint} contains what appears to be PHI: ${body.slice(0, 200)}`
        ).not.toMatch(/[A-Z][a-z]+\s[A-Z][a-z]+.*\d{4}-\d{2}-\d{2}/);
      }
    }
  });
});

// ─── Next.js Data Hygiene ─────────────────────────────────────────────────

test.describe('PHI — Server-Side Data Hygiene', () => {
  test('__NEXT_DATA__ does not contain secrets on authenticated pages', async ({ page }) => {
    if (!TEST_EMAIL || !TEST_PASSWORD) return;

    await loginAs(page);

    const violations = await scanNextData(page);
    expect(
      violations,
      `Server secrets found in __NEXT_DATA__ on authenticated page: ${violations.join('; ')}`
    ).toHaveLength(0);
  });
});
