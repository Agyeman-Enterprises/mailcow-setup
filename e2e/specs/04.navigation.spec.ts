import { test, expect } from '@playwright/test';

/**
 * 04.navigation.spec.ts — Gate 5: Navigation — EVERY BUTTON, EVERY LINK, EVERY PAGE
 *
 * ⛔ HARD ENFORCEMENT — THIS IS NOT OPTIONAL
 *
 * Claude Code (or ANY spawned agent) MUST:
 *   1. Read every route file in this app (app/, pages/, src/app/)
 *   2. List EVERY navigable route below
 *   3. Click EVERY button on EVERY page
 *   4. Click EVERY link on EVERY page
 *   5. Verify EVERY form has a working submit handler
 *   6. Verify ZERO dead UI (no onClick={() => {}}, no "Coming Soon")
 *   7. Test at mobile viewport (375px) — no horizontal scroll
 *
 * IF THIS FILE CONTAINS ANY `throw new Error` OR `TODO`:
 *   → run-gate.sh will HARD STOP
 *   → gate-check.yml CI will BLOCK the push
 *   → No exceptions. No bypass. Write real tests.
 *
 * HOW TO FILL THIS IN:
 *   1. Read GATE7.txt Section A — list every route
 *   2. Read the actual source code — find all buttons, links, forms
 *   3. Replace EVERY placeholder below with real selectors
 *   4. Run: npx playwright test e2e/specs/04.navigation.spec.ts
 */

// ══════════════════════════════════════════════════════════════
// ROUTES — Claude Code must list EVERY route in this app
// Read: app/page.tsx, app/*/page.tsx, pages/*.tsx, src/app/*
// ══════════════════════════════════════════════════════════════
const ALL_ROUTES: string[] = [
  // Claude Code: REPLACE with real routes from this app's router/pages
  // Example: '/', '/dashboard', '/settings', '/profile', '/api/health'
  // DO NOT leave this array empty. DO NOT use placeholder routes.
  // If this array has fewer routes than the app actually has, the gate FAILS.
];

test.describe('Gate 5 — Navigation: Desktop (EVERY page, EVERY element)', () => {

  test.beforeEach(async ({ page }) => {
    // Claude Code: implement login if app has auth, then navigate to root
    // If no auth, just navigate to root
    // REMOVE this comment and the line below — replace with real setup
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('EVERY route resolves to a real page (no 404, no blank)', async ({ page }) => {
    expect(ALL_ROUTES.length, 'ALL_ROUTES must list every route in the app').toBeGreaterThanOrEqual(3);

    for (const route of ALL_ROUTES) {
      const response = await page.goto(route);
      const status = response?.status() ?? 0;
      expect(status, `${route} returned ${status}`).toBeLessThan(400);

      const bodyText = await page.locator('body').innerText();
      expect(bodyText.trim().length, `${route} is blank`).toBeGreaterThan(10);

      // No stub content allowed
      const lower = bodyText.toLowerCase();
      expect(lower, `${route} has "coming soon"`).not.toContain('coming soon');
      expect(lower, `${route} has "placeholder"`).not.toContain('placeholder');
      expect(lower, `${route} has "todo"`).not.toMatch(/\btodo\b/);
      expect(lower, `${route} has "not implemented"`).not.toContain('not implemented');
    }
  });

  test('EVERY button on EVERY page has a real handler (no dead UI)', async ({ page }) => {
    const errors: string[] = [];

    for (const route of ALL_ROUTES) {
      if (route.startsWith('/api/')) continue; // skip API routes

      await page.goto(route);
      await page.waitForLoadState('networkidle');

      // Find all buttons
      const buttons = page.locator('button, [role="button"]');
      const count = await buttons.count();

      for (let i = 0; i < count; i++) {
        const btn = buttons.nth(i);
        if (!(await btn.isVisible())) continue;

        const text = (await btn.innerText().catch(() => '')) || `button[${i}]`;

        // Check for empty onClick handlers via DOM inspection
        const hasEmptyHandler = await btn.evaluate((el) => {
          const onclick = el.getAttribute('onclick');
          if (onclick && (onclick.trim() === '' || onclick.trim() === '()=>{}')) return true;
          return false;
        });

        if (hasEmptyHandler) {
          errors.push(`${route}: Button "${text.trim().substring(0, 40)}" has empty onClick`);
        }
      }
    }

    expect(errors, `Dead buttons found:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('EVERY link on EVERY page navigates to a real page', async ({ page }) => {
    const brokenLinks: string[] = [];

    for (const route of ALL_ROUTES) {
      if (route.startsWith('/api/')) continue;

      await page.goto(route);
      await page.waitForLoadState('networkidle');

      const links = page.locator('a[href]');
      const count = await links.count();

      for (let i = 0; i < count; i++) {
        const link = links.nth(i);
        if (!(await link.isVisible())) continue;

        const href = await link.getAttribute('href') || '';
        // Skip external links, anchors, mailto, tel
        if (href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
        if (href === '' || href === '/') continue;

        const resp = await page.goto(href).catch(() => null);
        const status = resp?.status() ?? 0;
        if (status >= 400) {
          const text = (await link.innerText().catch(() => '')) || href;
          brokenLinks.push(`${route}: Link "${text.trim().substring(0, 40)}" → ${href} (${status})`);
        }

        // Navigate back for next iteration
        await page.goto(route);
        await page.waitForLoadState('networkidle');
      }
    }

    expect(brokenLinks, `Broken links:\n${brokenLinks.join('\n')}`).toHaveLength(0);
  });

  test('EVERY form has a submit handler (no dead forms)', async ({ page }) => {
    const deadForms: string[] = [];

    for (const route of ALL_ROUTES) {
      if (route.startsWith('/api/')) continue;

      await page.goto(route);
      await page.waitForLoadState('networkidle');

      const forms = page.locator('form');
      const count = await forms.count();

      for (let i = 0; i < count; i++) {
        const form = forms.nth(i);
        if (!(await form.isVisible())) continue;

        // Check form has onSubmit or action
        const hasHandler = await form.evaluate((el) => {
          const action = el.getAttribute('action');
          const hasOnSubmit = typeof (el as HTMLFormElement).onsubmit === 'function';
          // React forms typically have event listeners, check for submit button
          const hasSubmitBtn = el.querySelector('button[type="submit"], input[type="submit"]');
          return !!(action || hasOnSubmit || hasSubmitBtn);
        });

        if (!hasHandler) {
          deadForms.push(`${route}: Form[${i}] has no submit handler or submit button`);
        }
      }
    }

    expect(deadForms, `Dead forms:\n${deadForms.join('\n')}`).toHaveLength(0);
  });

  test('page title is not default framework title', async ({ page }) => {
    await page.goto('/');
    const title = await page.title();
    expect(title).not.toBe('React App');
    expect(title).not.toBe('Next.js');
    expect(title).not.toBe('Vite App');
    expect(title).not.toBe('Create Next App');
    expect(title.trim()).not.toBe('');
  });

  test('no console errors on any page', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(`${msg.text()}`);
      }
    });

    for (const route of ALL_ROUTES) {
      if (route.startsWith('/api/')) continue;
      await page.goto(route);
      await page.waitForLoadState('networkidle');
    }

    // Filter out known benign errors (favicon 404, etc.)
    const realErrors = consoleErrors.filter(e =>
      !e.includes('favicon') && !e.includes('404') && !e.includes('Failed to load resource')
    );

    expect(realErrors, `Console errors:\n${realErrors.join('\n')}`).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════
// MOBILE — 375px viewport — NO EXCEPTIONS
// ══════════════════════════════════════════════════════════════

test.describe('Gate 9f — Mobile (375px)', () => {

  test.use({ viewport: { width: 375, height: 812 } });

  test('mobile: no horizontal scroll on any page', async ({ page }) => {
    for (const route of ALL_ROUTES) {
      if (route.startsWith('/api/')) continue;

      await page.goto(route);
      await page.waitForLoadState('networkidle');

      const hasHScroll = await page.evaluate(() =>
        document.documentElement.scrollWidth > window.innerWidth
      );
      expect(hasHScroll, `${route} has horizontal scroll at 375px`).toBe(false);
    }
  });

  test('mobile: all interactive elements meet 44px touch target', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const buttons = page.locator('button, a, [role="button"], input[type="submit"]');
    const count = await buttons.count();
    const tooSmall: string[] = [];

    for (let i = 0; i < Math.min(count, 30); i++) {
      const el = buttons.nth(i);
      if (!(await el.isVisible())) continue;
      const box = await el.boundingBox();
      if (box && (box.height < 44 || box.width < 44)) {
        const text = (await el.innerText().catch(() => '')) || `element[${i}]`;
        tooSmall.push(`"${text.trim().substring(0, 30)}" is ${Math.round(box.width)}x${Math.round(box.height)}px`);
      }
    }

    expect(tooSmall, `Touch targets too small:\n${tooSmall.join('\n')}`).toHaveLength(0);
  });

  test('mobile: navigation is accessible', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Page must have some form of navigation visible or accessible via hamburger
    const nav = page.locator('nav, [role="navigation"], [data-testid*="nav"], [data-testid*="menu"]');
    const hamburger = page.locator('[data-testid*="mobile"], [data-testid*="hamburger"], [aria-label*="menu"], button:has(svg)');

    const navVisible = await nav.first().isVisible().catch(() => false);
    const hamburgerVisible = await hamburger.first().isVisible().catch(() => false);

    expect(navVisible || hamburgerVisible, 'No navigation or hamburger menu found on mobile').toBe(true);
  });
});
