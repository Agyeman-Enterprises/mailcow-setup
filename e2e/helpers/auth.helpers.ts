/**
 * Auth Helpers — AE E2E Shared
 *
 * OWASP ASVS §V3 (Session Management) basis.
 * HIPAA §164.312(d) — Person Authentication.
 *
 * Three context factory functions for tests that need different auth states:
 *   authedContext  — loads pre-built auth-state.json (cookies set by @supabase/ssr middleware)
 *   unauthContext  — completely fresh context with no cookies or localStorage
 *   hasAuthState   — guard check to produce a clear skip rather than a timeout
 *
 * Why three contexts?
 *   @supabase/ssr middleware reads HTTP cookies, not localStorage.
 *   The global storageState (auth-state.json) is written by globalSetup after
 *   navigating to a protected page, so it contains the real server-side cookies.
 *
 *   Tests that verify unauthenticated behaviour (login page UI, redirect checks,
 *   session invalidation after logout) MUST use unauthContext() — the global
 *   storageState would cause middleware to redirect /login → /dashboard before
 *   the test can see the login form.
 */

import { type Browser, type BrowserContext } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

/** The two permitted auth-state filenames. No other value is accepted. */
export type AuthStateFile = 'auth-state.json' | 'auth-state-b.json'

/**
 * Resolve the absolute path to a named auth-state file inside the e2e/ directory.
 *
 * Uses a switch over hardcoded string literals so the value that reaches path.join
 * is always a compile-time constant — no derivative of the input parameter ever
 * flows into the filesystem call (eliminates CWE-22 path-traversal surface).
 */
function authStatePath(filename: AuthStateFile = 'auth-state.json'): string {
  const e2eDir = path.join(process.cwd(), 'e2e')
  // Each branch returns a hardcoded literal — taint chain from `filename` is broken.
  switch (filename) {
    case 'auth-state-b.json':
      return path.join(e2eDir, 'auth-state-b.json')
    case 'auth-state.json':
    default:
      return path.join(e2eDir, 'auth-state.json')
  }
}

/**
 * Create an authenticated browser context from the pre-built auth state.
 *
 * Returns null if the state file doesn't exist (globalSetup failed or wasn't run).
 * Tests that receive null should call test.skip() with a clear message rather
 * than proceeding and producing a misleading timeout error.
 *
 * The auth-state.json written by globalSetup contains HTTP cookies set by the
 * @supabase/ssr middleware — these are what Next.js App Router middleware reads
 * via request.cookies. Unlike a localStorage-only state, this context will pass
 * middleware auth checks without triggering browser-based re-login.
 */
export async function authedContext(browser: Browser, stateFile = 'auth-state.json'): Promise<BrowserContext | null> {
  const statePath = authStatePath(stateFile)
  if (!fs.existsSync(statePath)) return null
  return browser.newContext({ storageState: statePath })
}

/**
 * Create a completely unauthenticated browser context.
 *
 * Use this for:
 *   - Login page UI tests (verifying the form renders)
 *   - Invalid credential error message tests
 *   - Logout behaviour verification (verifying session is truly dead)
 *   - Confirming that protected routes redirect unauthenticated users
 *
 * Passing { cookies: [], origins: [] } ensures no cookies or localStorage
 * leak over from the global storageState. This is the safe, explicit form
 * of "incognito mode" in Playwright.
 */
export async function unauthContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ storageState: { cookies: [], origins: [] } })
}

/**
 * Check whether auth state is available for User A (or a named state file).
 *
 * Call this at the start of auth-required tests to produce a clear skip message
 * rather than waiting for a timeout when globalSetup didn't succeed.
 *
 * Usage:
 *   test('some auth test', async ({ browser }) => {
 *     if (!hasAuthState()) {
 *       test.skip(true, 'auth-state.json not found — run globalSetup with valid credentials')
 *       return
 *     }
 *     const ctx = await authedContext(browser)
 *     // ...
 *   })
 */
export function hasAuthState(stateFile = 'auth-state.json'): boolean {
  return fs.existsSync(authStatePath(stateFile))
}
