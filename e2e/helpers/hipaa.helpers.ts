/**
 * HIPAA & PHI Detection Helpers
 *
 * HIPAA Safe Harbor identifiers (45 CFR §164.514(b)(2)) — 18 categories:
 * Names, geographic data, dates, phone/fax, email, SSN, MRN, health plan numbers,
 * account numbers, certificate/license numbers, VINs, device IDs, URLs, IP addresses,
 * biometric identifiers, photos, and any unique identifying number or code.
 *
 * PHI must NEVER appear in: URLs, console logs, localStorage, error messages,
 * network response headers, page titles, or unencrypted client-side storage.
 */

import type { Page } from '@playwright/test';

// ─── PHI Pattern Definitions ──────────────────────────────────────────────────

/** PHI that must never appear in URL query strings or path segments. */
export const URL_PHI_PATTERNS: RegExp[] = [
  /[?&](name|patient_name|first_name|last_name|fname|lname)=[^&]+/i,
  /[?&](dob|date_of_birth|birth_date|birthday)=[^&]+/i,
  /[?&](ssn|social_security)=[^&]+/i,
  /[?&](mrn|medical_record_number|patient_id)=[^&]+/i,
  /[?&](diagnosis|icd|icd10|icd_code)=[^&]+/i,
  /[?&](medication|drug|prescription|rx)=[^&]+/i,
  /[?&](phone|mobile|tel|fax)=[^&]+/i,
  /[?&]email=[^&@]+@[^&]+/i,
  /[?&](address|street|zip|postal)=[^&]+/i,
  // Patient names in URL path (UUIDs with dashes are OK, readable names are not)
  /\/patients\/[a-z]{3,}-[a-z]{3,}/i,
];

/** PHI/secrets that must never appear in plain-text browser storage. */
export const STORAGE_PHI_PATTERNS: RegExp[] = [
  /\b\d{3}-\d{2}-\d{4}\b/,              // SSN format
  /diagnosis|icd[_-]?10/i,
  /medication|prescription|drug_name/i,
  /service_role/i,                       // Supabase service role key fragment
  /sk_live_/,                            // Stripe live key fragment
  /-----BEGIN.*PRIVATE KEY-----/,
];

/** Server-side secret patterns that must never reach the client. */
export const SECRET_PATTERNS: RegExp[] = [
  /sk_live_[A-Za-z0-9]{20,}/,
  /sk_test_[A-Za-z0-9]{20,}/,
  /whsec_[A-Za-z0-9+/]{30,}/,
  /service_role.*eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/i,
  /SUPABASE_SERVICE_ROLE_KEY/,
  /RESEND_API_KEY/,
  /STRIPE_SECRET_KEY/,
  /-----BEGIN RSA PRIVATE KEY-----/,
  /-----BEGIN EC PRIVATE KEY-----/,
  /-----BEGIN PRIVATE KEY-----/,
  /"password"\s*:\s*"[^"]{6,}"/i,
];

// ─── Storage Scanner ─────────────────────────────────────────────────────────

/**
 * Scan localStorage and sessionStorage for PHI or secrets.
 * Uses hardcoded literal checks inside evaluate() — no dynamic RegExp construction
 * (avoids ReDoS risk from pattern string arguments per CWE-1333).
 */
export async function scanBrowserStorage(page: Page): Promise<{ violations: string[] }> {
  return page.evaluate(() => {
    const violations: string[] = [];

    // Hardcoded fragments — never constructed from external input
    const FORBIDDEN_FRAGMENTS = [
      'service_role',
      'sk_live_',
      'sk_test_',
      'whsec_',
      'BEGIN PRIVATE KEY',
      'BEGIN RSA PRIVATE KEY',
      'BEGIN EC PRIVATE KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'RESEND_API_KEY',
      'STRIPE_SECRET_KEY',
      'diagnosis',
      'icd_10',
      'icd-10',
      'medication',
      'prescription',
      'drug_name',
    ];

    // Hardcoded SSN pattern — not constructed from argument
    const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/;

    const stores = [
      { name: 'localStorage', store: window.localStorage },
      { name: 'sessionStorage', store: window.sessionStorage },
    ];

    for (const { name, store } of stores) {
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i)!;
        const value = store.getItem(key) ?? '';
        const lower = value.toLowerCase();

        if (value.includes('"role":"service_role"')) {
          violations.push(`CRITICAL: Service role JWT in ${name}['${key}']`);
        }

        for (const fragment of FORBIDDEN_FRAGMENTS) {
          if (lower.includes(fragment.toLowerCase())) {
            violations.push(`PHI/secret fragment "${fragment}" in ${name}['${key}']`);
          }
        }

        if (SSN_RE.test(value.slice(0, 12))) {
          violations.push(`SSN-format value in ${name}['${key}']`);
        }
      }
    }

    return { violations };
  });
}

// ─── URL Scanner ─────────────────────────────────────────────────────────────

/** Check a URL string for PHI in query params or path segments. */
export function checkUrlForPhi(url: string): string[] {
  return URL_PHI_PATTERNS
    .filter((p) => p.test(url))
    .map((p) => `PHI pattern "${p.source}" in URL: ${url}`);
}

// ─── Network Response Scanner ────────────────────────────────────────────────

/** Scan a response body string for embedded server secrets. */
export function scanResponseBodyForSecrets(body: string, sourceUrl: string): string[] {
  return SECRET_PATTERNS
    .filter((p) => p.test(body))
    .map((p) => `Secret pattern "${p.source}" in response from ${sourceUrl}`);
}

// ─── Next.js __NEXT_DATA__ Scanner ───────────────────────────────────────────

/**
 * Scan the Next.js server-side data blob for secrets leaked into the HTML.
 * This blob is sent to every browser — server-only keys must never appear here.
 */
export async function scanNextData(page: Page): Promise<string[]> {
  const content = await page.evaluate(() => {
    return document.getElementById('__NEXT_DATA__')?.textContent ?? '';
  });

  if (!content) return [];

  return SECRET_PATTERNS
    .filter((p) => p.test(content))
    .map((p) => `Secret pattern "${p.source}" found in __NEXT_DATA__ HTML blob`);
}
