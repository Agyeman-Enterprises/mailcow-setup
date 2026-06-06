/**
 * GATE 11 — Row Level Security (RLS) Boundary Tests
 *
 * THE SINGLE MOST IMPORTANT SECURITY TEST for any multi-user Supabase app.
 * A missing or broken RLS policy means every user can read every other user's data.
 * For medical/financial apps this is an immediate HIPAA/legal violation.
 *
 * Test pattern: User A owns data → User B cannot access it via REST API.
 *
 * Required env vars (set in .env.test or CI secrets):
 *   TEST_EMAIL                   — User A email
 *   TEST_PASSWORD                — User A password
 *   TEST_USER_B_EMAIL            — User B email (separate test account)
 *   TEST_USER_B_PASSWORD         — User B password
 *   SUPABASE_URL                 — Project URL
 *   SUPABASE_ANON_KEY            — Anon/public key
 *   RLS_TEST_TABLE               — Table name to test (e.g. "profiles", "doses")
 *   RLS_TEST_USER_A_RESOURCE_ID  — UUID of a row owned by User A
 *
 * If any var is missing, tests skip with a mandatory warning.
 * RLS tests MUST pass before any app goes live. Skipping = NOT DONE.
 */

import { test, expect } from '@playwright/test';
import {
  getSupabaseToken,
  attemptUnauthorizedRead,
  attemptUnauthorizedWrite,
  attemptAnonymousListAccess,
} from '../helpers/rls.helpers';

const USER_A_EMAIL = process.env.TEST_EMAIL ?? ''; // nosemgrep
const USER_A_PASSWORD = process.env.TEST_PASSWORD ?? ''; // nosemgrep
const USER_B_EMAIL = process.env.TEST_USER_B_EMAIL ?? ''; // nosemgrep
const USER_B_PASSWORD = process.env.TEST_USER_B_PASSWORD ?? ''; // nosemgrep
const SUPABASE_URL = process.env.SUPABASE_URL ?? ''; // nosemgrep
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? ''; // nosemgrep
const RLS_TABLE = process.env.RLS_TEST_TABLE ?? ''; // nosemgrep
const USER_A_RESOURCE_ID = process.env.RLS_TEST_USER_A_RESOURCE_ID ?? ''; // nosemgrep

const HAS_RLS_CONFIG =
  USER_A_EMAIL && USER_A_PASSWORD &&
  USER_B_EMAIL && USER_B_PASSWORD &&
  SUPABASE_URL && SUPABASE_ANON_KEY &&
  RLS_TABLE && USER_A_RESOURCE_ID;

const SKIP_MESSAGE =
  'RLS tests require: TEST_EMAIL, TEST_PASSWORD, TEST_USER_B_EMAIL, TEST_USER_B_PASSWORD, ' +
  'SUPABASE_URL, SUPABASE_ANON_KEY, RLS_TEST_TABLE, RLS_TEST_USER_A_RESOURCE_ID. ' +
  'These tests are MANDATORY before go-live. Skipping = app is not cleared for release.';

// ─── Cross-User Data Isolation ────────────────────────────────────────────

test.describe('RLS — Cross-User Data Isolation (direct Supabase API)', () => {
  test.skip(!HAS_RLS_CONFIG, SKIP_MESSAGE);

  let userBToken: string | null = null;

  test.beforeAll(async () => {
    // Guard: if vars are missing, tests are already marked skip — nothing to set up
    if (!HAS_RLS_CONFIG) return;

    // Prefer the token written by globalSetup (no additional Supabase auth request)
    if (process.env.E2E_ACCESS_TOKEN_B) {
      userBToken = process.env.E2E_ACCESS_TOKEN_B;
      return;
    }

    // Fall back to a direct REST API login (still rate-limit-safe vs browser login)
    userBToken = await getSupabaseToken(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      USER_B_EMAIL,
      USER_B_PASSWORD
    );
    if (!userBToken) {
      throw new Error(
        `Cannot authenticate User B (${USER_B_EMAIL}). ` +
        'Ensure the test account exists and credentials are correct. ' +
        'RLS tests cannot run without a valid User B session.'
      );
    }
  });

  test('User B cannot READ User A\'s row via REST API', async () => {
    const result = await attemptUnauthorizedRead({
      supabaseUrl: SUPABASE_URL,
      anonKey: SUPABASE_ANON_KEY,
      attackerToken: userBToken!,
      table: RLS_TABLE,
      resourceId: USER_A_RESOURCE_ID,
    });

    expect(result.attackerGotData, result.violation ?? 'RLS correctly blocked read').toBe(false);
  });

  test('User B cannot PATCH User A\'s row via REST API', async () => {
    const result = await attemptUnauthorizedWrite({
      supabaseUrl: SUPABASE_URL,
      anonKey: SUPABASE_ANON_KEY,
      attackerToken: userBToken!,
      table: RLS_TABLE,
      resourceId: USER_A_RESOURCE_ID,
      payload: { updated_at: new Date().toISOString() },
      method: 'PATCH',
    });

    expect(
      result.writeSucceeded,
      result.violation ?? 'RLS correctly blocked write'
    ).toBe(false);
  });

  test('User B cannot DELETE User A\'s row via REST API', async () => {
    const result = await attemptUnauthorizedWrite({
      supabaseUrl: SUPABASE_URL,
      anonKey: SUPABASE_ANON_KEY,
      attackerToken: userBToken!,
      table: RLS_TABLE,
      resourceId: USER_A_RESOURCE_ID,
      method: 'DELETE',
    });

    expect(
      result.writeSucceeded,
      result.violation ?? 'RLS correctly blocked delete'
    ).toBe(false);
  });

  test("User B's unfiltered list query does not include User A's rows", async () => {
    const url =
      `${SUPABASE_URL}/rest/v1/${RLS_TABLE}?select=id&limit=200`;

    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${userBToken}`,
      },
    });

    const rows = (await res.json()) as Array<{ id: string }>;

    const containsUserARow = Array.isArray(rows) &&
      rows.some((r) => r.id === USER_A_RESOURCE_ID);

    expect(
      containsUserARow,
      `RLS VIOLATION: User A's row (id=${USER_A_RESOURCE_ID}) appeared in User B's ` +
      `unfiltered list of "${RLS_TABLE}". RLS SELECT policy is missing or USING condition is wrong.`
    ).toBe(false);
  });
});

// ─── Anonymous Access ─────────────────────────────────────────────────────

test.describe('RLS — Anonymous (unauthenticated) Access', () => {
  test.skip(!SUPABASE_URL || !SUPABASE_ANON_KEY || !RLS_TABLE, SKIP_MESSAGE);

  test('unauthenticated request to user data table returns 0 rows', async () => {
    const result = await attemptAnonymousListAccess({
      supabaseUrl: SUPABASE_URL,
      anonKey: SUPABASE_ANON_KEY,
      table: RLS_TABLE,
    });

    expect(
      result.rowCount,
      result.violation ?? `Correctly blocked — anonymous request returned 0 rows from "${RLS_TABLE}"`
    ).toBe(0);
  });
});

// ─── UI-Level Cross-User Access ───────────────────────────────────────────

test.describe('RLS — UI-Level Admin Route Protection', () => {
  const ADMIN_PATHS = [
    '/admin',
    '/admin/users',
    '/admin/settings',
    '/clinician/dashboard',
    '/provider/patients',
    '/staff/dashboard',
  ];

  test('admin/clinician routes redirect unauthenticated users to login', async ({ page }) => {
    for (const path of ADMIN_PATHS) {
      await page.goto(path);
      await page.waitForTimeout(500);

      const currentUrl = page.url();
      const redirectedToLogin = currentUrl.includes('/login') ||
        currentUrl.includes('/signin') ||
        currentUrl.includes('/auth');

      // If not redirected to login, check that no admin content is rendered
      if (!redirectedToLogin) {
        const bodyText = (await page.locator('body').textContent()) ?? '';
        const hasAdminContent = /patient list|all users|admin panel|user management|system settings/i.test(bodyText);

        expect(
          hasAdminContent,
          `Admin route ${path} rendered admin content without authentication. ` +
          `Current URL: ${currentUrl}. Protect this route with auth middleware.`
        ).toBe(false);
      }
    }
  });
});
