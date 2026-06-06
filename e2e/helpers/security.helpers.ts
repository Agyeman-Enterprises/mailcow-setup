/**
 * Security Header & Configuration Helpers
 *
 * Checks OWASP-recommended security headers and hygiene for every AE app.
 * HIPAA Technical Safeguard basis: 45 CFR §164.312(c)(2) — Transmission integrity.
 */

import type { Page, Response } from '@playwright/test';

// ─── Header Check Types ───────────────────────────────────────────────────────

export interface HeaderCheckResult {
  header: string;
  present: boolean;
  value: string | null;
  compliant: boolean;
  issue: string | null;
}

// ─── Required Header Assertions ───────────────────────────────────────────────

/**
 * Assert that a response does NOT include X-Powered-By.
 * This header fingerprints the framework (Next.js, Express, etc.).
 */
export function assertNoPoweredByHeader(response: Response): void {
  const val = response.headers()['x-powered-by'];
  if (val) {
    throw new Error(
      `X-Powered-By: "${val}" exposes the tech stack. ` +
      'Disable in next.config.ts: poweredByHeader: false'
    );
  }
}

/**
 * Assert X-Content-Type-Options: nosniff is present.
 * Without this, browsers may MIME-sniff responses and execute arbitrary scripts.
 */
export function assertContentTypeOptions(response: Response): void {
  const val = response.headers()['x-content-type-options'];
  if (val?.toLowerCase() !== 'nosniff') {
    throw new Error(
      `X-Content-Type-Options is "${val ?? 'missing'}" — must be "nosniff". ` +
      'Add via Next.js headers() config or middleware.'
    );
  }
}

/**
 * Assert Referrer-Policy is set. Missing this header causes sensitive URL fragments
 * (including auth tokens and PHI-containing paths) to leak via the HTTP Referer header
 * to any third-party resource loaded on the page.
 */
export function assertReferrerPolicy(response: Response): void {
  const val = response.headers()['referrer-policy'];
  if (!val) {
    throw new Error(
      'Referrer-Policy header missing. ' +
      'PHI or auth tokens in URLs can leak to third-party analytics/CDN via HTTP Referer. ' +
      'Recommended: "strict-origin-when-cross-origin"'
    );
  }
}

/**
 * Run the full security header audit on a response.
 * Returns a report; use assertAllHeadersPass() to throw on any failure.
 */
export function auditSecurityHeaders(response: Response): HeaderCheckResult[] {
  const h = response.headers();

  return [
    {
      header: 'x-content-type-options',
      present: !!h['x-content-type-options'],
      value: h['x-content-type-options'] ?? null,
      compliant: h['x-content-type-options']?.toLowerCase() === 'nosniff',
      issue: h['x-content-type-options']?.toLowerCase() !== 'nosniff'
        ? 'Must be "nosniff" — prevents MIME-type sniffing attacks'
        : null,
    },
    {
      header: 'referrer-policy',
      present: !!h['referrer-policy'],
      value: h['referrer-policy'] ?? null,
      compliant: !!h['referrer-policy'],
      issue: !h['referrer-policy']
        ? 'Missing — PHI in URLs leaks to third-party origins via HTTP Referer'
        : null,
    },
    {
      header: 'x-powered-by',
      present: !!h['x-powered-by'],
      value: h['x-powered-by'] ?? null,
      // Compliant when ABSENT
      compliant: !h['x-powered-by'],
      issue: h['x-powered-by']
        ? `Should be removed — exposes "${h['x-powered-by']}" to attackers`
        : null,
    },
    {
      header: 'x-frame-options',
      present: !!h['x-frame-options'],
      value: h['x-frame-options'] ?? null,
      compliant: !h['x-frame-options'] || /^(DENY|SAMEORIGIN)$/i.test(h['x-frame-options']),
      issue: h['x-frame-options'] && !/^(DENY|SAMEORIGIN)$/i.test(h['x-frame-options'])
        ? `Invalid value "${h['x-frame-options']}" — use DENY or SAMEORIGIN`
        : null,
    },
    {
      header: 'strict-transport-security',
      present: !!h['strict-transport-security'],
      value: h['strict-transport-security'] ?? null,
      compliant: !h['strict-transport-security'] || h['strict-transport-security'].includes('max-age='),
      issue: h['strict-transport-security'] && !h['strict-transport-security'].includes('max-age=')
        ? `Malformed HSTS: "${h['strict-transport-security']}"`
        : null,
    },
  ];
}

// ─── CORS Checks ─────────────────────────────────────────────────────────────

/**
 * Assert wildcard CORS is not set on authenticated endpoints.
 * Access-Control-Allow-Origin: * on an auth'd API allows any site to read user data.
 */
export function assertNoWildcardCors(response: Response): void {
  const cors = response.headers()['access-control-allow-origin'];
  if (cors === '*') {
    throw new Error(
      `CRITICAL CORS misconfiguration: Access-Control-Allow-Origin: * on ${response.url()}. ` +
      'Wildcard CORS on authenticated endpoints allows any origin to read user data. ' +
      'Restrict to specific allowed origins.'
    );
  }
}

// ─── JS Bundle Scanner ────────────────────────────────────────────────────────

/**
 * Collect all JS bundle URLs currently referenced by the page.
 */
export async function collectJsBundleUrls(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('script[src]'))
      .map((s) => (s as HTMLScriptElement).src)
      .filter((src) => src && !src.includes('analytics') && !src.includes('gtm'))
  );
}

/**
 * Fetch a JS bundle and scan for secret key patterns using hardcoded literals.
 * Does NOT use dynamic RegExp construction (ReDoS-safe).
 */
export async function scanBundleForSecretFragments(
  page: Page,
  bundleUrl: string
): Promise<string[]> {
  const response = await page.request.get(bundleUrl);
  if (!response.ok()) return [];

  const content = await response.text();
  const violations: string[] = [];

  // Hardcoded prefix checks — not constructed from arguments.
  // nosemgrep: these are detection patterns, not actual secrets being hardcoded.
  const FORBIDDEN_PREFIXES = [ // nosemgrep
    'sk_live_',
    'whsec_',
    'BEGIN RSA PRIVATE KEY',
    'BEGIN EC PRIVATE KEY',
    'BEGIN PRIVATE KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'STRIPE_SECRET_KEY',
    'RESEND_API_KEY',
  ];

  for (const prefix of FORBIDDEN_PREFIXES) {
    if (content.includes(prefix)) {
      violations.push(`Secret fragment "${prefix}" found in bundle: ${bundleUrl}`);
    }
  }

  // Service role JWT detection: extract all JWT-shaped strings from the bundle and
  // base64-decode the payload segment to check if role === 'service_role'.
  // We do NOT scan for the raw string "service_role" because the Supabase client
  // library itself contains that string as a constant (for type-checking / error
  // messages), which produces false positives on the login-page bundle.
  const jwtPattern = /eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]*/g;
  let jwtMatch: RegExpExecArray | null;
  while ((jwtMatch = jwtPattern.exec(content)) !== null) {
    const payloadB64 = jwtMatch[1];
    try {
      // Pad the base64url string to a multiple of 4 before decoding
      const padded = payloadB64 + '=='.slice((payloadB64.length % 4) || 4);
      const decoded = Buffer.from(padded, 'base64').toString('utf-8');
      const payload = JSON.parse(decoded) as Record<string, unknown>;
      if (payload.role === 'service_role') {
        violations.push(
          `CRITICAL: Supabase service role JWT found in bundle: ${bundleUrl}. ` +
          `Decoded payload role is "service_role". This JWT bypasses all RLS policies. ` +
          `Replace with the anon key in client code.`
        );
        break; // One violation per bundle is enough
      }
    } catch {
      // Malformed base64 or non-JSON payload — not a real JWT, skip
    }
  }

  return violations;
}

// ─── Sensitive Path Checks ────────────────────────────────────────────────────

/**
 * Verify that sensitive static paths are blocked (return non-200, or 200 with HTML
 * redirect rather than actual file contents).
 *
 * Apps whose middleware redirects all unauthenticated requests to /login return HTTP 200
 * for any path including /.env.  We therefore also inspect the response body:
 *   - HTML body (DOCTYPE / <html) → login redirect, NOT a real file — PASS
 *   - Env-file body (KEY=VALUE pattern) → real secret exposed — FAIL
 *   - Git config body ([core] pattern) → real config exposed — FAIL
 */
export async function checkSensitivePathsBlocked(
  page: Page,
  baseUrl: string
): Promise<Array<{ path: string; status: number; violation: string | null }>> {
  const BLOCKED_PATHS = [
    '/.env',
    '/.env.local',
    '/.env.production',
    '/.env.development',
    '/.git/config',
    '/.git/HEAD',
    '/wp-admin',
    '/phpinfo.php',
  ];

  const results = [];
  for (const sensitivePath of BLOCKED_PATHS) {
    const response = await page.request.get(`${baseUrl}${sensitivePath}`);
    const status = response.status();

    let violation: string | null = null;

    if (status === 200) {
      // Inspect body to distinguish between a real secret file and an HTML redirect page
      const body = await response.text().catch(() => '');

      const isHtmlRedirect =
        body.includes('<!DOCTYPE html') ||
        body.includes('<!doctype html') ||
        body.includes('<html') ||
        body.includes('<HTML');

      if (isHtmlRedirect) {
        // Middleware redirected to login or error page as HTML — not a real file leak
        violation = null;
      } else {
        // Check if the body looks like an actual secret file
        const looksLikeEnvFile = /^[A-Z_][A-Z0-9_]+=.+/m.test(body);
        const looksLikeGitConfig = /^\[core\]/m.test(body) || /^\[remote/m.test(body);

        if (looksLikeEnvFile || looksLikeGitConfig) {
          violation =
            `CRITICAL: ${sensitivePath} returned HTTP 200 and the body looks like a real secret file ` +
            `(env/git config pattern detected). Secrets may be publicly accessible. ` +
            `Body preview: ${body.slice(0, 120)}`;
        } else {
          // 200 but body doesn't match any secret file pattern — likely a catch-all 200 handler
          violation = null;
        }
      }
    }

    results.push({ path: sensitivePath, status, violation });
  }
  return results;
}
