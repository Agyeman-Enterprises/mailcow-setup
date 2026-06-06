/**
 * GATE 10 — Security Headers, Secrets Exposure & Attack Surface
 *
 * Verifies:
 *   - No X-Powered-By tech fingerprint
 *   - X-Content-Type-Options: nosniff present
 *   - Referrer-Policy present (PHI leak prevention)
 *   - No secrets in Next.js __NEXT_DATA__
 *   - No .env / .git files accessible
 *   - No secrets in JS bundles (Stripe live keys, service role JWTs)
 *   - Unauthenticated API routes return 401/403, not 200 or 500-with-details
 *   - No wildcard CORS on API endpoints
 *   - XSS payload in URL query param does not execute
 *
 * Does NOT require auth credentials — runs entirely unauthenticated.
 */

import { test, expect } from '@playwright/test';
import {
  assertNoPoweredByHeader,
  assertContentTypeOptions,
  assertReferrerPolicy,
  collectJsBundleUrls,
  scanBundleForSecretFragments,
  checkSensitivePathsBlocked,
} from '../helpers/security.helpers';
import { scanNextData } from '../helpers/hipaa.helpers';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'; // nosemgrep

// ─── Security Headers ─────────────────────────────────────────────────────

test.describe('Security — Response Headers', () => {
  test('root page does not expose X-Powered-By header', async ({ page }) => {
    const [response] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === '/'),
      page.goto('/'),
    ]);
    if (response) assertNoPoweredByHeader(response);
  });

  test('root page has X-Content-Type-Options: nosniff', async ({ page }) => {
    const [response] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === '/'),
      page.goto('/'),
    ]);
    if (response) assertContentTypeOptions(response);
  });

  test('root page has Referrer-Policy header', async ({ page }) => {
    const [response] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === '/'),
      page.goto('/'),
    ]);
    if (response) assertReferrerPolicy(response);
  });

  test('/login page has Referrer-Policy header', async ({ page }) => {
    const [response] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === '/login'),
      page.goto('/login'),
    ]);
    if (response) assertReferrerPolicy(response);
  });

  test('/login page does not expose X-Powered-By', async ({ page }) => {
    const [response] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === '/login'),
      page.goto('/login'),
    ]);
    if (response) assertNoPoweredByHeader(response);
  });
});

// ─── SSR Data Leak ────────────────────────────────────────────────────────

test.describe('Security — Next.js __NEXT_DATA__ Secrets Scan', () => {
  test('root page __NEXT_DATA__ contains no server secrets', async ({ page }) => {
    await page.goto('/');
    const violations = await scanNextData(page);
    expect(
      violations,
      `Server secrets found in __NEXT_DATA__ on /: ${violations.join('; ')}`
    ).toHaveLength(0);
  });

  test('/login page __NEXT_DATA__ contains no server secrets', async ({ page }) => {
    await page.goto('/login');
    const violations = await scanNextData(page);
    expect(
      violations,
      `Server secrets found in __NEXT_DATA__ on /login: ${violations.join('; ')}`
    ).toHaveLength(0);
  });
});

// ─── Sensitive Path Access ────────────────────────────────────────────────

test.describe('Security — Sensitive Paths Must Be Blocked', () => {
  test('.env files are not publicly accessible', async ({ page }) => {
    // Uses body-aware check: a 200 response containing HTML (login redirect) is NOT
    // a violation — only a 200 whose body matches env-file or git-config syntax is.
    const results = await checkSensitivePathsBlocked(page, BASE_URL);
    const envResults = results.filter((r) => r.path.startsWith('/.env'));
    for (const result of envResults) {
      expect(
        result.violation,
        result.violation ?? `${result.path} is correctly blocked (HTTP ${result.status})`
      ).toBeNull();
    }
  });

  test('.git directory is not publicly accessible', async ({ page }) => {
    // Uses body-aware check — HTML redirect responses are not flagged as violations.
    const results = await checkSensitivePathsBlocked(page, BASE_URL);
    const gitResults = results.filter((r) => r.path.startsWith('/.git'));
    for (const result of gitResults) {
      expect(
        result.violation,
        result.violation ?? `${result.path} is correctly blocked (HTTP ${result.status})`
      ).toBeNull();
    }
  });

  test('source maps are blocked in production environments', async ({ page }) => {
    if (BASE_URL.includes('localhost')) return;
    await page.goto('/');
    const bundles = await collectJsBundleUrls(page);
    for (const bundle of bundles.slice(0, 5)) {
      const mapResponse = await page.request.get(`${bundle}.map`);
      expect(
        mapResponse.status(),
        `Source map accessible at ${bundle}.map — exposes original TypeScript source to attackers`
      ).not.toBe(200);
    }
  });
});

// ─── JS Bundle Secrets Scan ───────────────────────────────────────────────

test.describe('Security — JS Bundle Secret Scan', () => {
  test('client bundles contain no Stripe live secret keys', async ({ page }) => {
    if (BASE_URL.includes('localhost')) return; // Test env may have test keys — only block live
    await page.goto('/');
    const bundles = await collectJsBundleUrls(page);
    for (const bundle of bundles) {
      const violations = await scanBundleForSecretFragments(page, bundle);
      const stripeViolations = violations.filter((v) => v.includes('sk_live_'));
      expect(
        stripeViolations,
        stripeViolations.join('; ')
      ).toHaveLength(0);
    }
  });

  test('client bundles contain no Supabase service role JWT', async ({ page }) => {
    await page.goto('/');
    const bundles = await collectJsBundleUrls(page);
    for (const bundle of bundles) {
      const violations = await scanBundleForSecretFragments(page, bundle);
      const serviceRoleViolations = violations.filter((v) => v.includes('service_role'));
      expect(
        serviceRoleViolations,
        serviceRoleViolations.join('; ')
      ).toHaveLength(0);
    }
  });

  test('client bundles contain no private key material', async ({ page }) => {
    await page.goto('/');
    const bundles = await collectJsBundleUrls(page);
    for (const bundle of bundles.slice(0, 8)) {
      const violations = await scanBundleForSecretFragments(page, bundle);
      const pkViolations = violations.filter((v) => v.includes('PRIVATE KEY'));
      expect(pkViolations, pkViolations.join('; ')).toHaveLength(0);
    }
  });
});

// ─── API Endpoint Authorization ───────────────────────────────────────────

test.describe('Security — Unauthenticated API Endpoint Behavior', () => {
  const PROTECTED_API_PATHS = [
    '/api/user',
    '/api/profile',
    '/api/me',
    '/api/dashboard',
    '/api/patients',
    '/api/records',
    '/api/admin',
    '/api/admin/users',
  ];

  test('protected API routes return 401/403/404 without auth — never 200', async ({ page }) => {
    for (const path of PROTECTED_API_PATHS) {
      const response = await page.request.get(path, {
        headers: { Authorization: 'Bearer invalid-token-xyz' },
      });

      if (response.status() === 404) continue; // Route doesn't exist — fine

      expect(
        [401, 403, 405].includes(response.status()),
        `API route ${path} returned HTTP ${response.status()} with invalid auth — ` +
        `expected 401/403. Status 200 = unauthorized data access.`
      ).toBeTruthy();
    }
  });

  test('500 errors from API routes do not expose stack traces', async ({ page }) => {
    const protoPayload = '{"__proto__":{"polluted":true}}';
    const response = await page.request.post('/api/user', {
      data: protoPayload,
      headers: { 'Content-Type': 'application/json' },
    });

    if (response.status() === 500) {
      const body = await response.text();
      // Stack trace pattern: "at FunctionName (file.js:123:45)"
      expect(body).not.toMatch(/\bat\s+\w[\w.]*\s*\(.*\.(?:js|ts):\d+:\d+\)/);
      expect(body).not.toMatch(/\/home\/|\/var\/app\/|node_modules\//i);
    }
  });

  test('CORS wildcard not set on API endpoints', async ({ page }) => {
    for (const path of ['/api/user', '/api/profile', '/api/me']) {
      const response = await page.request.get(path, {
        headers: { Origin: 'https://evil.attacker.com' },
      });
      const cors = response.headers()['access-control-allow-origin'];
      expect(
        cors,
        `CRITICAL: ${path} has CORS wildcard (*) — any website can read authenticated user data`
      ).not.toBe('*');
    }
  });
});

// ─── XSS Prevention ───────────────────────────────────────────────────────

test.describe('Security — XSS Prevention', () => {
  test('XSS payload in URL query param does not execute', async ({ page }) => {
    await page.goto(`/?q=${encodeURIComponent('<script>window.__xss=1</script>')}`);
    await page.waitForTimeout(800);
    const executed = await page.evaluate(
      () => !!(window as unknown as Record<string, unknown>).__xss
    );
    expect(
      executed,
      'Reflected XSS: script tag in query param was executed. Sanitize before rendering.'
    ).toBe(false);
  });

  test('script injection via URL hash does not execute', async ({ page }) => {
    await page.goto(`/#<img src=x onerror="window.__xss_hash=1">`);
    await page.waitForTimeout(800);
    const executed = await page.evaluate(
      () => !!(window as unknown as Record<string, unknown>).__xss_hash
    );
    expect(
      executed,
      'XSS via URL hash fragment was executed — DOM-based XSS vulnerability.'
    ).toBe(false);
  });
});
