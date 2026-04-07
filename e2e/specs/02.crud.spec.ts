import { test, expect } from '@playwright/test';

/**
 * 02.crud.spec.ts — Gate 4: CRUD Operations
 *
 * ⚠️  THIS FILE IS A TEMPLATE — Claude Code must implement every test
 *     based on this app's actual primary entity and routes.
 *
 * Rules:
 * - ALL tests must hit the real database — no mocking
 * - Create tests must verify the entity actually appears in the list (DB write confirmed)
 * - Update tests must verify the change persists after page reload
 * - Delete tests must verify the entity is gone from the list after deletion
 * - Tests must clean up after themselves (delete what they created)
 *
 * How to fill this in:
 * 1. Read GATE7.txt Section C for this app — find the primary entity
 * 2. Find the create/edit/delete routes and form selectors
 * 3. Implement each test — remove throw statements as each is done
 */

// TODO(gate4): Replace with the actual entity name for this app
// e.g., 'project', 'patient', 'invoice', 'task', 'campaign'
const ENTITY_NAME = '[REPLACE WITH ACTUAL ENTITY]';

const TEST_ENTITY = {
  // TODO(gate4): Fill in the actual fields for this app's primary entity
  name: `Test ${ENTITY_NAME} ${Date.now()}`,
  // add other required fields here
};

test.describe(`Gate 4 — ${ENTITY_NAME} CRUD`, () => {

  test.beforeEach(async ({ page }) => {
    // TODO(gate4): Log in before each CRUD test if app has auth
    // await loginAsTestUser(page);
    throw new Error(`GATE4 SETUP NOT IMPLEMENTED — login and navigate to ${ENTITY_NAME} list`);
  });

  test(`CREATE — ${ENTITY_NAME} form submits and appears in list`, async ({ page }) => {
    // TODO(gate4): Navigate to create form, fill all fields, submit
    // Verify the new entity appears in the list (confirms DB write)
    throw new Error('GATE4 CREATE NOT IMPLEMENTED — implement create flow');
    // await page.goto('/[entity-list-route]');
    // await page.click('[data-testid="create-btn"]');
    // await page.fill('[data-testid="name-input"]', TEST_ENTITY.name);
    // await page.click('[data-testid="save-btn"]');
    // await expect(page.locator(`text=${TEST_ENTITY.name}`)).toBeVisible();
  });

  test(`READ — ${ENTITY_NAME} list renders from database`, async ({ page }) => {
    // TODO(gate4): Verify list is populated — not empty, not hardcoded
    // If list can be empty, create one first then verify it shows
    throw new Error('GATE4 READ NOT IMPLEMENTED — verify list renders from DB');
    // await page.goto('/[entity-list-route]');
    // const listItems = page.locator('[data-testid="entity-list-item"]');
    // // Either list has items, or empty state is shown (not hardcoded data)
    // const count = await listItems.count();
    // if (count > 0) {
    //   // Verify items look real (not "Demo Project", "Test User", etc.)
    //   const firstItemText = await listItems.first().innerText();
    //   expect(firstItemText).not.toMatch(/demo|placeholder|lorem ipsum/i);
    // }
  });

  test(`UPDATE — edit form loads data and save persists changes`, async ({ page }) => {
    // TODO(gate4): Open edit form for an existing entity, change a field, save
    // Then reload the page and verify the change is still there
    throw new Error('GATE4 UPDATE NOT IMPLEMENTED — implement edit + persist flow');
    // const updatedName = `Updated ${Date.now()}`;
    // await page.goto('/[entity-list-route]');
    // await page.click('[data-testid="entity-list-item"]:first-child [data-testid="edit-btn"]');
    // await page.fill('[data-testid="name-input"]', updatedName);
    // await page.click('[data-testid="save-btn"]');
    // await page.reload();
    // await expect(page.locator(`text=${updatedName}`)).toBeVisible();
  });

  test(`DELETE — ${ENTITY_NAME} removed from list after confirmation`, async ({ page }) => {
    // TODO(gate4): Create an entity, delete it, verify it's gone
    throw new Error('GATE4 DELETE NOT IMPLEMENTED — implement delete flow');
    // First create one to delete
    // await createTestEntity(page, TEST_ENTITY);
    // Then delete it
    // await page.click(`[data-testid="entity-item-${TEST_ENTITY.name}"] [data-testid="delete-btn"]`);
    // Confirm the dialog
    // await page.click('[data-testid="confirm-delete-btn"]');
    // Verify it's gone
    // await expect(page.locator(`text=${TEST_ENTITY.name}`)).not.toBeVisible();
  });

  test(`PERSIST — created ${ENTITY_NAME} survives hard browser refresh`, async ({ page }) => {
    // TODO(gate4): Create entity, hard reload the page, verify it's still there
    throw new Error('GATE4 PERSIST NOT IMPLEMENTED — implement create + reload flow');
    // await createTestEntity(page, TEST_ENTITY);
    // await page.reload({ waitUntil: 'networkidle' });
    // await expect(page.locator(`text=${TEST_ENTITY.name}`)).toBeVisible();
  });

});
