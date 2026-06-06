/**
 * Playwright Global Setup — AE E2E Shared
 *
 * Strategy: REST API login → inject base64url-encoded cookie → navigate to protected page
 * → capture resulting storageState (includes real HTTP cookies set by @supabase/ssr middleware).
 *
 * Three-step auth flow:
 *   1. REST API login → get access_token + refresh_token (no browser, no rate-limit risk)
 *   2. Launch browser, inject cookie via ctx.addCookies() with base64url-encoded value.
 *      @supabase/ssr v0.4.x uses cookieEncoding: "base64url" by default. Cookie values
 *      must be "base64-" + base64url(sessionJson) — where "base64-" is the BASE64_PREFIX
 *      constant in @supabase/ssr/dist/main/cookies.js.
 *      ctx.addCookies() sets the cookie directly in the browser store without going
 *      through document.cookie (which would add unwanted URL-encoding).
 *   3. Navigate to /dashboard (protected) → triggers middleware updateSession() which
 *      validates the token and writes real server-side auth cookies into the response
 *   4. Call ctx.storageState() to capture state including those real HTTP cookies
 *   5. Write to auth-state.json for use by all specs
 */

import { chromium } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config({ path: path.resolve(process.cwd(), '.env.test'), override: true })
process.env.SUPABASE_URL      ??= process.env.NEXT_PUBLIC_SUPABASE_URL
process.env.SUPABASE_ANON_KEY ??= process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

async function loginUser(
  baseUrl: string,
  supabaseUrl: string,
  anonKey: string,
  email: string,
  password: string,
  stateFile: string,
  tokenEnvVar: string,
  label: string
): Promise<void> {
  // Step 1: Get tokens via REST API (no browser rate-limit risk)
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) {
    console.warn(`[globalSetup] ${label} REST login failed: HTTP ${res.status}`)
    return
  }
  const session = await res.json() as Record<string, unknown>
  if (!session.access_token) {
    console.warn(`[globalSetup] ${label} REST login returned no access_token. Check credentials in .env.test`)
    return
  }

  // Step 2: Launch browser, inject token via ctx.addCookies(), trigger middleware
  const browser = await chromium.launch({ headless: true })
  try {
    const ctx  = await browser.newContext()
    const page = await ctx.newPage()

    // Build the cookie key using the Supabase project ref
    const projectRef = new URL(supabaseUrl).hostname.split('.')[0]
    const cookieName = `sb-${projectRef}-auth-token`
    // @supabase/auth-js _isValidSession() requires access_token, refresh_token, AND expires_at.
    // expires_at is a Unix timestamp (seconds). The REST token endpoint may return it directly;
    // if not, compute it from expires_in.
    const sessionJson = JSON.stringify({
      access_token:  session.access_token,
      refresh_token: session.refresh_token,
      expires_in:    session.expires_in ?? 3600,
      expires_at:    session.expires_at ?? Math.floor(Date.now() / 1000) + ((session.expires_in as number) ?? 3600),
      token_type:    session.token_type ?? 'bearer',
      user:          session.user ?? {},
    })

    // Parse the domain from baseUrl (e.g. 'localhost' or 'example.com')
    let domain = 'localhost'
    try { domain = new URL(baseUrl).hostname } catch { /* keep default */ }

    // @supabase/ssr v0.4.x default: cookieEncoding = "base64url".
    // Cookie value format: BASE64_PREFIX + base64url(json)
    // BASE64_PREFIX is the literal string "base64-" (from @supabase/ssr/dist/main/cookies.js).
    const cookieValue = 'base64-' + Buffer.from(sessionJson).toString('base64url')

    await ctx.addCookies([{
      name:     cookieName,
      value:    cookieValue,
      domain:   domain,
      path:     '/',
      expires:  Math.floor(Date.now() / 1000) + 3600,
      httpOnly: false,
      secure:   false,
      sameSite: 'Lax' as const,
    }])

    // Step 3: Navigate to a protected page — triggers middleware updateSession()
    // which validates the token and writes proper server-side auth cookies
    await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' })

    if (page.url().includes('/login')) {
      console.warn(
        `[globalSetup] ${label}: After token injection, middleware still redirected to /login. ` +
        'The token may be invalid or the app may use a different protected path. ' +
        'Specs requiring auth will fail.'
      )
      await browser.close()
      return
    }

    // Step 4: Capture the storageState — now includes real middleware-set cookies
    const storageState = await ctx.storageState()
    fs.writeFileSync(stateFile, JSON.stringify(storageState, null, 2), 'utf-8')
    process.env[tokenEnvVar] = session.access_token as string
    console.log(`[globalSetup] ${label} auth state written → ${stateFile}`)
  } finally {
    await browser.close()
  }
}

export default async function globalSetup(): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL ?? '' // nosemgrep
  const anonKey     = process.env.SUPABASE_ANON_KEY ?? '' // nosemgrep
  const baseUrl     = process.env.BASE_URL ?? 'http://localhost:3000' // nosemgrep
  const userAEmail  = process.env.TEST_EMAIL ?? '' // nosemgrep
  const userAPass   = process.env.TEST_PASSWORD ?? '' // nosemgrep
  const userBEmail  = process.env.TEST_USER_B_EMAIL ?? '' // nosemgrep
  const userBPass   = process.env.TEST_USER_B_PASSWORD ?? '' // nosemgrep

  const e2eDir = path.join(process.cwd(), 'e2e')
  if (!fs.existsSync(e2eDir)) fs.mkdirSync(e2eDir, { recursive: true })

  if (supabaseUrl && anonKey && userAEmail && userAPass) {
    await loginUser(
      baseUrl, supabaseUrl, anonKey,
      userAEmail, userAPass,
      path.join(e2eDir, 'auth-state.json'),
      'E2E_ACCESS_TOKEN', 'User A'
    )
  } else {
    console.warn('[globalSetup] User A skipped — missing SUPABASE_URL, SUPABASE_ANON_KEY, TEST_EMAIL, or TEST_PASSWORD')
  }

  if (supabaseUrl && anonKey && userBEmail && userBPass) {
    await loginUser(
      baseUrl, supabaseUrl, anonKey,
      userBEmail, userBPass,
      path.join(e2eDir, 'auth-state-b.json'),
      'E2E_ACCESS_TOKEN_B', 'User B'
    )
  } else {
    console.log('[globalSetup] User B not configured — RLS tests will skip.')
  }
}
