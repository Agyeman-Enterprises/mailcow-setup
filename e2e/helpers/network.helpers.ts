/**
 * Network Interception & Response Scanning Helpers
 *
 * Sets up Playwright request/response interception to:
 *   - Capture API responses for secret scanning
 *   - Log network errors that indicate broken API calls
 *   - Verify HTTPS enforcement in non-localhost environments
 */

import type { Page } from '@playwright/test';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface CapturedResponse {
  url: string;
  status: number;
  contentType: string;
  bodyPreview: string;
}

// ─── Response Capture ──────────────────────────────────────────────────────

/**
 * Attach a response interceptor that captures all API responses.
 * Call this before page.goto() to capture responses from the initial load.
 * Returns a function that retrieves collected responses.
 */
export function attachResponseCapture(
  page: Page,
  filter: (url: string) => boolean = (u) => u.includes('/api/')
): () => CapturedResponse[] {
  const captured: CapturedResponse[] = [];

  page.on('response', async (response) => {
    if (!filter(response.url())) return;

    let bodyPreview = '';
    try {
      const body = await response.text();
      bodyPreview = body.slice(0, 500);
    } catch {
      bodyPreview = '[unreadable]';
    }

    captured.push({
      url: response.url(),
      status: response.status(),
      contentType: response.headers()['content-type'] ?? '',
      bodyPreview,
    });
  });

  return () => [...captured];
}

/**
 * Scan captured API responses for secret key fragments.
 * Uses literal string matching (no dynamic RegExp — ReDoS-safe).
 */
export function scanCapturedResponsesForSecrets(
  responses: CapturedResponse[]
): Array<{ url: string; fragment: string }> {
  const SECRET_FRAGMENTS = [
    'sk_live_',
    'sk_test_',
    'whsec_',
    'service_role',
    'BEGIN PRIVATE KEY',
    'BEGIN RSA PRIVATE KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'RESEND_API_KEY',
    'STRIPE_SECRET_KEY',
  ];

  const violations: Array<{ url: string; fragment: string }> = [];

  for (const resp of responses) {
    for (const fragment of SECRET_FRAGMENTS) {
      if (resp.bodyPreview.includes(fragment)) {
        violations.push({ url: resp.url, fragment });
      }
    }
  }

  return violations;
}

// ─── Console Error Capture ─────────────────────────────────────────────────

/**
 * Collect browser console errors during page load.
 * Returns all error messages. Use to detect failed API calls,
 * uncaught exceptions, and mixed content warnings.
 */
export function attachConsoleErrorCapture(page: Page): () => string[] {
  const errors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });

  page.on('pageerror', (err) => {
    errors.push(`[pageerror] ${err.message}`);
  });

  return () => [...errors];
}

/**
 * Collect all failed network requests (4xx/5xx) during page interaction.
 * Failed API calls often indicate broken auth wiring or missing endpoints.
 */
export function attachFailedRequestCapture(
  page: Page
): () => Array<{ url: string; status: number }> {
  const failed: Array<{ url: string; status: number }> = [];

  page.on('response', (response) => {
    if (response.status() >= 400 && response.url().includes('/api/')) {
      failed.push({ url: response.url(), status: response.status() });
    }
  });

  return () => [...failed];
}

// ─── HTTPS Enforcement ─────────────────────────────────────────────────────

/**
 * Verify that all network requests made during page load use HTTPS.
 * Mixed content (HTTP on HTTPS page) exposes data to interception.
 * Only meaningful for non-localhost environments.
 */
export function attachMixedContentDetector(page: Page): () => string[] {
  const httpRequests: string[] = [];
  const baseUrl = process.env.BASE_URL ?? '';

  if (!baseUrl.startsWith('https://')) {
    return () => []; // Not applicable on localhost
  }

  page.on('request', (req) => {
    const url = req.url();
    if (url.startsWith('http://') && !url.startsWith('http://localhost')) {
      httpRequests.push(url);
    }
  });

  return () => [...httpRequests];
}
