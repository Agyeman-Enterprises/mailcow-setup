/**
 * Row Level Security (RLS) Test Helpers
 *
 * Tests that Supabase RLS policies actually block cross-user data access.
 * This is the #1 multi-tenant security requirement and a HIPAA mandate
 * (45 CFR §164.312(a)(1) — Access Control: unique user identification).
 *
 * Test pattern:
 *   1. User A owns a resource (pre-seeded or created in test)
 *   2. User B authenticates and attempts READ, UPDATE, DELETE on User A's resource
 *   3. Supabase RLS must block access — empty list or 403
 *
 * Required env vars:
 *   TEST_EMAIL / TEST_PASSWORD           — User A
 *   TEST_USER_B_EMAIL / TEST_USER_B_PASSWORD — User B
 *   SUPABASE_URL / SUPABASE_ANON_KEY     — for direct REST API testing
 *   RLS_TEST_TABLE                        — e.g. "profiles", "patients", "doses"
 *   RLS_TEST_USER_A_RESOURCE_ID          — UUID of a row owned by User A
 */

// ─── Types ─────────────────────────────────────────────────────────────────

export interface RlsReadResult {
  resourceId: string;
  attackerGotData: boolean;
  responseStatus: number;
  violation: string | null;
}

export interface RlsWriteResult {
  writeSucceeded: boolean;
  responseStatus: number;
  violation: string | null;
}

// ─── Token Acquisition ─────────────────────────────────────────────────────

/**
 * Authenticate a user against Supabase and return the access token.
 * Used to get tokens for direct REST API RLS testing.
 */
export async function getSupabaseToken(
  supabaseUrl: string,
  anonKey: string,
  email: string,
  password: string
): Promise<string | null> {
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string };
  return data.access_token ?? null;
}

// ─── RLS Read Test ─────────────────────────────────────────────────────────

/**
 * Attempt to READ User A's row via Supabase REST API using User B's token.
 * Returns whether the attacker obtained any data.
 */
export async function attemptUnauthorizedRead(params: {
  supabaseUrl: string;
  anonKey: string;
  attackerToken: string;
  table: string;
  resourceId: string;
  pkColumn?: string;
}): Promise<RlsReadResult> {
  const { supabaseUrl, anonKey, attackerToken, table, resourceId, pkColumn = 'id' } = params;

  const url = `${supabaseUrl}/rest/v1/${table}?${pkColumn}=eq.${encodeURIComponent(resourceId)}&select=*`;

  const res = await fetch(url, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${attackerToken}`,
    },
  });

  let rows: unknown[] = [];
  try {
    rows = (await res.json()) as unknown[];
  } catch {
    // Non-JSON body — blocked at middleware level
  }

  const gotData = Array.isArray(rows) && rows.length > 0;

  return {
    resourceId,
    attackerGotData: gotData,
    responseStatus: res.status,
    violation: gotData
      ? `RLS READ VIOLATION: User B accessed User A's "${table}" row (id=${resourceId}). ` +
        `Status: ${res.status}. Data: ${JSON.stringify(rows).slice(0, 200)}. ` +
        `Add RLS policy: USING (auth.uid() = user_id)`
      : null,
  };
}

// ─── RLS Write Tests ────────────────────────────────────────────────────────

/**
 * Attempt to PATCH or DELETE User A's row using User B's token.
 * Returns whether the write was applied (a violation).
 */
export async function attemptUnauthorizedWrite(params: {
  supabaseUrl: string;
  anonKey: string;
  attackerToken: string;
  table: string;
  resourceId: string;
  payload?: Record<string, unknown>;
  method?: 'PATCH' | 'DELETE';
  pkColumn?: string;
}): Promise<RlsWriteResult> {
  const {
    supabaseUrl,
    anonKey,
    attackerToken,
    table,
    resourceId,
    payload = { updated_at: new Date().toISOString() },
    method = 'PATCH',
    pkColumn = 'id',
  } = params;

  const url = `${supabaseUrl}/rest/v1/${table}?${pkColumn}=eq.${encodeURIComponent(resourceId)}`;

  const res = await fetch(url, {
    method,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${attackerToken}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: method !== 'DELETE' ? JSON.stringify(payload) : undefined,
  });

  let affected: unknown[] = [];
  try {
    affected = (await res.json()) as unknown[];
  } catch {
    // ignore
  }

  const writeSucceeded = res.ok && Array.isArray(affected) && affected.length > 0;

  return {
    writeSucceeded,
    responseStatus: res.status,
    violation: writeSucceeded
      ? `RLS WRITE VIOLATION: User B successfully ${method}'d User A's "${table}" row (id=${resourceId}). ` +
        `Add RLS policy: WITH CHECK (auth.uid() = user_id)`
      : null,
  };
}

// ─── Unauthenticated Access Test ────────────────────────────────────────────

/**
 * Query a table with NO auth token (anonymous request).
 * RLS should return 0 rows for tables with user data.
 */
export async function attemptAnonymousListAccess(params: {
  supabaseUrl: string;
  anonKey: string;
  table: string;
  limit?: number;
}): Promise<{ rowCount: number; violation: string | null }> {
  const { supabaseUrl, anonKey, table, limit = 10 } = params;

  const res = await fetch(`${supabaseUrl}/rest/v1/${table}?select=id&limit=${limit}`, {
    headers: { apikey: anonKey },
  });

  let rows: unknown[] = [];
  if (res.ok) {
    try {
      rows = (await res.json()) as unknown[];
    } catch {
      // ignore
    }
  }

  const rowCount = Array.isArray(rows) ? rows.length : 0;

  return {
    rowCount,
    violation: rowCount > 0
      ? `RLS ANON VIOLATION: Unauthenticated request returned ${rowCount} rows from "${table}". ` +
        `RLS policy is missing. Add: CREATE POLICY "Require auth" ON "${table}" ` +
        `FOR SELECT USING (auth.uid() IS NOT NULL);`
      : null,
  };
}
