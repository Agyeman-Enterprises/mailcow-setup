import { test, expect } from '@playwright/test';

/**
 * 03.persistence.spec.ts — Gates 5 + 6: Data Integrity & Persistence
 *
 * ⚠️  THIS FILE IS A TEMPLATE — Claude Code must implement every test
 *     based on this app's actual entities and persistence requirements.
 *
 * Rules:
 * - Tests must verify real database persistence — not localStorage or sessionStorage
 * - "Hard refresh" = page.reload({ waitUntil: 'networkidle' }) — not just navigation
 * - "New session" = new browser context (clears all cookies/storage)
 * - Data integrity tests must check GATE7.txt Section E/F requirements
 *
 * How to fill this in:
 * 1. Read GATE7.txt Sections D, E, F for this app
 * 2. Implement the mandatory persistence test (every app requires this)
 * 3. Add data integrity checks specific to this app
 */

test.describe('Gate 5+6 — Data Integrity & Persistence', () => {

  test('created data survives hard browser refresh', async ({ page }) => {
    // TODO(gate5): This is THE mandatory persistence test.
    // 1. Create the primary entity with specific data
    // 2. Hard reload the page
    // 3. Verify the entity + all its fields are exactly as entered
    throw new Error('GATE5 PERSISTENCE NOT IMPLEMENTED — this test is mandatory for every app');
    // await loginAsTestUser(page);
    // const testData = { name: `Persist Test ${Date.now()}` };
    // await createPrimaryEntity(page, testData);
    // await page.reload({ waitUntil: 'networkidle' });
    // await expect(page.locator(`text=${testData.name}`)).toBeVisible();
  });

  test('created data survives browser close and reopen', async ({ page, context }) => {
    // TODO(gate5): Create data, close the page, open a new page, verify data still there
    // This confirms server-side persistence vs only client-side state
    throw new Error('GATE5 SESSION PERSISTENCE NOT IMPLEMENTED');
    // await loginAsTestUser(page);
    // const testData = { name: `Session Test ${Date.now()}` };
    // await createPrimaryEntity(page, testData);
    // const savedUrl = page.url();
    // await page.close();
    // const newPage = await context.newPage();
    // await newPage.goto(savedUrl);
    // await expect(newPage.locator(`text=${testData.name}`)).toBeVisible();
  });

  test('no hardcoded demo or placeholder data visible in UI', async ({ page }) => {
    // TODO(gate6): Verify no fake data is shown to real users
    // Check the main list and detail views
    throw new Error('GATE6 DATA INTEGRITY NOT IMPLEMENTED — check for hardcoded data');
    // await loginAsTestUser(page);
    // await page.goto('/[main-content-route]');
    // const pageText = await page.locator('body').innerText();
    // expect(pageText).not.toMatch(/John Doe|Jane Doe|Demo User|Test User|Lorem Ipsum|Sample Data|Placeholder/i);
    // expect(pageText).not.toMatch(/demo@example\.com|test@test\.com/i);
  });

  test('empty state renders when no data exists (not fake data)', async ({ page }) => {
    // TODO(gate6): If a fresh user has no data, verify empty state UI appears
    // NOT hardcoded demo items
    throw new Error('GATE6 EMPTY STATE NOT IMPLEMENTED — verify empty state exists');
    // await loginAsFreshTestUser(page); // user with no data
    // await page.goto('/[entity-list-route]');
    // const emptyState = page.locator('[data-testid="empty-state"]');
    // await expect(emptyState).toBeVisible();
  });

  test('data created on one page is visible on related pages', async ({ page }) => {
    // TODO(gate6): Cross-page data visibility
    // e.g., create a project → verify it shows in dashboard widget + project list + activity feed
    throw new Error('GATE6 CROSS-PAGE DATA NOT IMPLEMENTED — verify data flows across UI');
    // await loginAsTestUser(page);
    // const entityName = `Cross-Page Test ${Date.now()}`;
    // await createPrimaryEntity(page, { name: entityName });
    // Navigate to a related view that should also show this entity
    // await page.goto('/[related-route]');
    // await expect(page.locator(`text=${entityName}`)).toBeVisible();
  });

  test('user data is isolated — cannot see other users data', async ({ page, browser }) => {
    // TODO(gate6): If app is multi-user, verify user A cannot see user B's data
    // Skip this test if app is single-user or admin-only
    test.skip(true, 'TODO(gate6): Implement if app is multi-user — skip if single-user');
    // const userAContext = await browser.newContext();
    // const userBContext = await browser.newContext();
    // ... create data as user A, verify user B cannot see it
  });

});
