/**
 * XNAT Navigation E2E Tests
 *
 * Tests browsing the XNAT hierarchy: Projects → Subjects → Sessions (expandable scans).
 * Uses the authenticated fixture (direct login, no popup).
 */
import { test, expect } from '../fixtures/auth';
import { XnatBrowserPage } from '../pages/xnat-browser.page';
import { getE2EConfig, type E2EConfig } from '../helpers/env';

let config: E2EConfig;

test.describe('XNAT Navigation', () => {
  test.beforeAll(() => { config = getE2EConfig(); });

  // Reset to projects level before each test
  test.beforeEach(async ({ authenticatedPage: page }) => {
    const browser = new XnatBrowserPage(page);
    const level = await browser.currentLevel();
    if (level !== 'projects') {
      await browser.navigateToProjects();
    }
  });

  test('projects list loads after authentication', async ({ authenticatedPage: page }) => {
    const browser = new XnatBrowserPage(page);
    await browser.waitForLoaded();

    expect(await browser.currentLevel()).toBe('projects');

    const count = await browser.getItemCount();
    expect(count).toBeGreaterThan(0);
  });

  test('drill down from project to sessions', async ({ authenticatedPage: page }) => {
    const browser = new XnatBrowserPage(page);

    // Select project
    await browser.selectProject(config.testProject);
    expect(await browser.currentLevel()).toBe('subjects');

    // Select subject
    await browser.selectSubject(config.testSubject);
    expect(await browser.currentLevel()).toBe('sessions');

    // Verify sessions are visible
    const sessionCount = await browser.getItemCount();
    expect(sessionCount).toBeGreaterThan(0);
  });

  test('back navigation works via breadcrumbs', async ({ authenticatedPage: page }) => {
    const browser = new XnatBrowserPage(page);

    await browser.selectProject(config.testProject);
    expect(await browser.currentLevel()).toBe('subjects');

    await browser.navigateToProjects();
    expect(await browser.currentLevel()).toBe('projects');
  });

  test('expand session shows scans', async ({ authenticatedPage: page }) => {
    const browser = new XnatBrowserPage(page);

    await browser.selectProject(config.testProject);
    await browser.selectSubject(config.testSubject);
    await browser.expandSession(config.testSession);

    // After expanding, scan buttons should appear inside the expanded area.
    // Scan buttons are <button> elements with class "w-full" inside .pb-2.
    const scanItems = page.locator('[data-testid="xnat-browser"] .overflow-y-auto .pb-2 button.w-full');
    const scanCount = await scanItems.count();
    expect(scanCount).toBeGreaterThan(0);
  });
});
