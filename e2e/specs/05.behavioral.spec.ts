import { test, expect } from '@playwright/test';

/**
 * 05.behavioral.spec.ts — Gates 7 + 8: Product-Specific Behavioral Test
 *
 * ⛔ HARD ENFORCEMENT — NO test.skip, NO throw new Error, NO TODO
 *
 * If this file contains ANY of these patterns, the gate WILL HARD STOP:
 *   - throw new Error
 *   - test.skip
 *   - TODO(gate
 *   - NOT IMPLEMENTED
 *   - Claude Code must fill
 *   - PLACEHOLDER
 *   - REPLACE_THIS
 *
 * Claude Code (or ANY spawned agent) MUST:
 *   1. Read GATE7.txt for this specific app
 *   2. For EVERY section (A, B, C, D...) write tests covering EVERY checkbox
 *   3. Tests must run against the LIVE app with REAL data
 *   4. Tests must CREATE data, VERIFY it persists, and ASSERT exact visible text
 *   5. If the app has no auth, DELETE the auth section entirely — do NOT skip it
 *
 * AGENTS: This enforcement applies to ALL agents — parent, spawned, or
 * subagent. No agent may mark this spec as complete while it contains
 * placeholder code. The canon is non-negotiable.
 *
 * HOW TO FILL THIS IN:
 *   1. Read GATE7.txt — every checkbox becomes at least one test
 *   2. Read the actual source code — find real selectors, real routes
 *   3. Remove EVERY comment that says "TODO" or "fill in"
 *   4. Run: npx playwright test e2e/specs/05.behavioral.spec.ts
 *   5. ALL tests must pass against the running app
 */

// ─── Test data — use the standard test persona ──────────────
const TEST_USER = {
  name: 'IMA Vampyr',
  email: 'imatesta@gmail.com',
  phone: '671-846-1441',
};

// ══════════════════════════════════════════════════════════════
// SECTION A: Navigation
// Claude Code: Read GATE7.txt Section A. Write one test per checkbox.
// ══════════════════════════════════════════════════════════════

test.describe('Section A — Navigation', () => {
  // Claude Code: REPLACE these tests with real tests from GATE7.txt Section A.
  // Each [ ] checkbox in GATE7.txt = one test here.
  // DELETE this entire describe block and rewrite it. No stubs.
});

// ══════════════════════════════════════════════════════════════
// SECTION B: Auth Flow
// If app has NO auth: DELETE this entire section.
// Do NOT use test.skip. DELETE or IMPLEMENT. No middle ground.
// ══════════════════════════════════════════════════════════════

test.describe('Section B — Auth Flow', () => {
  // Claude Code: If app has auth → write real tests.
  // If app has no auth → DELETE this entire describe block.
  // test.skip is PROHIBITED. Delete or implement.
});

// ══════════════════════════════════════════════════════════════
// SECTION C: Primary Entity CRUD
// Claude Code: Replace "entity" with the real entity name.
// ══════════════════════════════════════════════════════════════

test.describe('Section C — Primary Entity CRUD', () => {
  // Claude Code: REPLACE with real CRUD tests for this app's primary entity.
  // Must test: CREATE → appears in list → UPDATE → changes persist → DELETE → gone
  // Must verify data is in the DATABASE, not just the UI.
});

// ══════════════════════════════════════════════════════════════
// SECTION D+: Additional sections from GATE7.txt
// Copy the pattern above for EVERY section in GATE7.txt.
// Every checkbox = at least one test.
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
// CRITICAL FLOW: End-to-end (GATE7.txt Section E or final section)
// This is the MOST IMPORTANT test in the entire suite.
// ══════════════════════════════════════════════════════════════

test.describe('Critical Flow — End to End', () => {
  // Claude Code: Implement the full critical user journey:
  //   1. Start from scratch (empty state or new user)
  //   2. Complete the entire core workflow
  //   3. Verify data persists after hard refresh
  //   4. Verify data persists after logout/login cycle
  //   5. Use REAL data — not mocked, not hardcoded
  //
  // This test must exercise the app's reason for existing.
  // A scheduling app must create a schedule.
  // A CRM must create a lead and track it.
  // A health app must book an appointment.
  //
  // DELETE these comments and write the real test.
});
