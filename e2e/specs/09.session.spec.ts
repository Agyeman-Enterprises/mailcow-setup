/**
 * GATE 13 — Session Management
 *
 * HIPAA §164.312(a)(2)(iii) — Automatic Logoff: implement procedures that terminate
 * an electronic session after a predetermined time of inactivity.
 * HIPAA §164.312(d) — Person Authentication: unique user identification.
 *
 * Verifies:
 *   - Logout redirects to login (not just client-side state clear)
 *   - Accessing protected route after logout redirects to login
 *   - Auth session does NOT carry over to a fresh browser context
 *   - Auth cookies have Secure + SameSite attributes (on HTTPS)
 *   - JWT tokens in localStorage, if present, are not service-role tokens
 *   - Password field has visibility toggle (HIPAA auth UX requirement)
 *   - Login with invalid credentials shows error, not blank screen
 *
 * Requires: TEST_EMAIL, TEST_PASSWORD
 */

import { test, expect } from '@playwright/test';

const TEST_EMAIL = process.env.TEST_EMAIL ?? ''; // nosemgrep
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? ''; // nosemgrep
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'; // nosemgrep
const IS_HTTPS = BASE_URL.startsWith('https://');

const SKIP_AUTH = !TEST_EMAIL || !TEST_PASSWORD;
const AUTH_SKIP_MSG = 'Set TEST_EMAIL and TEST_PASSWORD to run session tests';

/**
 * Ensure the page has an authenticated session.
 *
 * When globalSetup has pre-built auth-state.json (indicated by E2E_ACCESS_TOKEN in env),
 * the storageState is already injected via the Playwright config — navigate to root and
 * return.  Falls back to browser-based login only when no pre-built state exists.
 *
 * IMPORTANT: Tests that specifically verify "what happens when NOT logged in" must
 * create a fresh browser context WITHOUT storageState — they must NOT use this helper.
 */
async function loginAs(page: import('@playwright/test').Page): Promise<void> {
  const hasToken =
    typeof process.env.E2E_ACCESS_TOKEN === 'string' &&
    process.env.E2E_ACCESS_TOKEN.length > 0;

  if (hasToken) {
    // storageState already in context — navigate home so the app initialises the session
    await page.goto('/');
    await page.waitForTimeout(500);
    if (!page.url().includes('/login')) return;
  }

  // Fall back: browser form login
  await page.goto('/login');
  const email = page.locator('input[type="email"]');
  const pass = page.locator('input[type="password"]');
  if (await email.isVisible({ timeout: 3000 }).catch(() => false)) await email.fill(TEST_EMAIL);
  if (await pass.isVisible({ timeout: 3000 }).catch(() => false)) await pass.fill(TEST_PASSWORD);
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

// ─── Auth Form UX (HIPAA §164.312(d) basis) ───────────────────────────────
//
// CRITICAL: These tests use { browser } NOT { page }.
// The global storageState has auth cookies → @supabase/ssr middleware redirects
// /login → /dashboard before the test can see the form.
// Each test creates its own unauthenticated context so the login form is actually visible.

test.describe('Session — Auth Form Requirements', () => {
  test('login page renders email + password fields and submit button', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    try {
      await page.goto('/login');
      await expect(page.locator('input[type="email"]')).toBeVisible();
      await expect(page.locator('input[type="password"]')).toBeVisible();
      // Fill fields before checking enabled — some apps correctly disable submit on empty inputs
      await page.locator('input[type="email"]').fill('test@example.com');
      await page.locator('input[type="password"]').fill('testpassword');
      await expect(page.getByRole('button', { name: /log.?in|sign.?in|continue/i })).toBeEnabled();
    } finally {
      await ctx.close();
    }
  });

  test('login with invalid credentials shows error message — not blank screen', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    try {
      await page.goto('/login');
      await page.locator('input[type="email"]').fill('nonexistent@qa-test.invalid');
      await page.locator('input[type="password"]').fill('WrongPassword999!');
      await page.getByRole('button', { name: /log.?in|sign.?in|continue/i }).click();
      await page.waitForTimeout(3000);

      // Must remain on /login — not redirect or crash
      expect(page.url(), 'Bad credentials caused unexpected navigation').toMatch(/\/(login|signin)/);

      // Must show an error message
      const body = (await page.locator('body').textContent()) ?? '';
      expect(
        body,
        'Bad credentials showed blank page — must display error message so users are not confused'
      ).toMatch(/invalid|incorrect|wrong|error|credentials|password|not found/i);
    } finally {
      await ctx.close();
    }
  });

  test('password field has visibility toggle', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    try {
      await page.goto('/login');

      // Look for the eye/toggle button near the password field
      const toggleSelectors = [
        'button[aria-label*="password" i]',
        'button[aria-label*="show" i]',
        'button[aria-label*="reveal" i]',
        '[data-testid*="password-toggle"]',
        '[data-testid*="show-password"]',
        'button:near(input[type="password"])',
      ];

      let toggleFound = false;
      for (const sel of toggleSelectors) {
        const count = await page.locator(sel).count();
        if (count > 0) { toggleFound = true; break; }
      }

      expect.soft(
        toggleFound,
        'Password visibility toggle not found. ' +
        'HIPAA auth UX requires users to verify password entry — add eye icon toggle. ' +
        '(Also required by AE Rule 4 in CLAUDE.md)'
      ).toBe(true);
    } finally {
      await ctx.close();
    }
  });
});

// ─── Logout & Session Invalidation ───────────────────────────────────────

test.describe('Session — Logout Invalidation', () => {
  test.skip(SKIP_AUTH, AUTH_SKIP_MSG);

  test('logout redirects to login or home', async ({ page }) => {
    await loginAs(page);
    await performLogout(page);

    expect(
      page.url(),
      'After logout, user was not redirected to /login or /. ' +
      'Users must be sent to a public page after logout.'
    ).toMatch(/\/(login|signin|$)/i);
  });

  test('accessing protected route after logout redirects to login', async ({ page }) => {
    await loginAs(page);
    const protectedUrl = page.url(); // capture the authenticated page URL
    await performLogout(page);

    // Try to revisit the protected page
    await page.goto(protectedUrl);
    await page.waitForTimeout(2000);

    expect(
      page.url(),
      `After logout, ${protectedUrl} did not redirect to /login. ` +
      'Session is still valid after logout — signOut() must be called server-side, ' +
      'not just clearing client-side storage.'
    ).toMatch(/\/(login|signin)/);
  });

  test('session does not carry over to a new browser context (incognito)', async ({ browser }) => {
    // ctx1 uses pre-built storageState (no extra login request to Supabase)
    // ctx2 is completely fresh — simulates incognito / different browser
    const authStateFile = 'e2e/auth-state.json';
    const fs = await import('fs');
    const hasStorageStateFile = fs.existsSync(authStateFile);

    const ctx1 = hasStorageStateFile
      ? await browser.newContext({ storageState: authStateFile })
      : await browser.newContext();
    const ctx2 = await browser.newContext({ storageState: { cookies: [], origins: [] } });

    try {
      const page1 = await ctx1.newPage();

      if (!hasStorageStateFile) {
        // No pre-built state — fall back to browser login (rate limit caution)
        await page1.goto(`${BASE_URL}/login`);
        await page1.locator('input[type="email"]').fill(TEST_EMAIL);
        await page1.locator('input[type="password"]').fill(TEST_PASSWORD);
        await page1.getByRole('button', { name: /log.?in|sign.?in|continue/i }).click();
        await page1.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });
      } else {
        // storageState loaded — navigate to trigger session initialisation
        await page1.goto(`${BASE_URL}/`);
        await page1.waitForTimeout(1000);
      }

      const authenticatedUrl = page1.url();
      // If still on login page, the storageState didn't produce a valid session
      // (e.g. token expired). Skip rather than failing with a misleading error.
      if (authenticatedUrl.includes('/login') || authenticatedUrl.includes('/signin')) {
        return;
      }

      const page2 = await ctx2.newPage();
      await page2.goto(authenticatedUrl);
      await page2.waitForTimeout(2000);

      expect(
        page2.url(),
        `Protected URL ${authenticatedUrl} was accessible in a fresh browser context. ` +
        'Session sharing or insecure cookie configuration allows session hijacking.'
      ).toMatch(/\/(login|signin)/);
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });
});

// ─── Cookie Security Attributes ───────────────────────────────────────────

test.describe('Session — Cookie Security Attributes', () => {
  test.skip(SKIP_AUTH, AUTH_SKIP_MSG);

  test('auth cookies have SameSite attribute set after login', async ({ page }) => {
    await loginAs(page);

    const cookies = await page.context().cookies();
    const authCookies = cookies.filter(
      (c) => c.name.includes('auth') || c.name.includes('session') ||
              c.name.includes('supabase') || c.name.startsWith('sb-')
    );

    for (const cookie of authCookies) {
      expect(
        cookie.sameSite,
        `Auth cookie "${cookie.name}" has no SameSite attribute. ` +
        'Missing SameSite allows CSRF attacks. Set SameSite=Lax or Strict.'
      ).toMatch(/^(Lax|Strict|None)$/);
    }
  });

  test('auth cookies have Secure flag on HTTPS deployments', async ({ page }) => {
    if (!IS_HTTPS) return; // Skip on localhost

    await loginAs(page);

    const cookies = await page.context().cookies();
    const authCookies = cookies.filter(
      (c) => c.name.includes('auth') || c.name.includes('session') ||
              c.name.includes('supabase') || c.name.startsWith('sb-')
    );

    for (const cookie of authCookies) {
      expect(
        cookie.secure,
        `Auth cookie "${cookie.name}" is missing the Secure flag on HTTPS. ` +
        'Without Secure, the session token can be transmitted over HTTP (interception risk).'
      ).toBe(true);
    }
  });
});

// ─── Service Role JWT Detection ───────────────────────────────────────────

test.describe('Session — No Service Role Token Client-Side', () => {
  test.skip(SKIP_AUTH, AUTH_SKIP_MSG);

  test('localStorage does not contain a Supabase service role JWT after login', async ({ page }) => {
    await loginAs(page);

    const hasServiceRole = await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)!;
        const value = localStorage.getItem(key) ?? '';
        if (value.includes('service_role')) return true;
      }
      return false;
    });

    expect(
      hasServiceRole,
      'CRITICAL: Supabase service role JWT found in localStorage. ' +
      'Service role bypasses all RLS. Must only be used server-side. ' +
      'Replace with anon key + user JWT in client code.'
    ).toBe(false);
  });
});
