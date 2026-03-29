/**
 * XnatBrowser Page Object
 *
 * The XNAT hierarchy navigation has 3 drilldown levels:
 *   Projects → Subjects → Sessions (with expandable inline scans)
 *
 * Navigation methods accept XNAT IDs/labels from the .env.e2e config.
 * They resolve IDs to display names via the XNAT API, then click the
 * matching UI element. If an ID doesn't exist on the server, the test
 * fails immediately with a clear data-not-found error.
 */
import type { Page } from '@playwright/test';

export class XnatBrowserPage {
  constructor(private page: Page) {}

  // ─── Locators ──────────────────────────────────────────────────

  get browser() {
    return this.page.locator('[data-testid="xnat-browser"]');
  }

  get items() {
    return this.browser.locator('.overflow-y-auto [role="button"]');
  }

  get spinner() {
    return this.browser.locator('.animate-spin');
  }

  get breadcrumb() {
    return this.browser.locator('.border-b').first();
  }

  // ─── Level Detection ───────────────────────────────────────────

  async currentLevel(): Promise<string> {
    return await this.browser.getAttribute('data-level') ?? 'unknown';
  }

  async waitForLevel(level: string, timeout = 30_000) {
    await this.page.waitForFunction(
      (expectedLevel) => {
        const el = document.querySelector('[data-testid="xnat-browser"]');
        return el?.getAttribute('data-level') === expectedLevel;
      },
      level,
      { timeout },
    );
  }

  // ─── Wait Helpers ──────────────────────────────────────────────

  async waitForLoaded(timeout = 30_000) {
    await this.spinner.waitFor({ state: 'hidden', timeout }).catch(() => {});
    await this.page.waitForFunction(
      () => {
        const browser = document.querySelector('[data-testid="xnat-browser"]');
        if (!browser) return false;
        const scrollArea = browser.querySelector('.overflow-y-auto');
        if (!scrollArea) return false;
        const items = scrollArea.querySelectorAll('[role="button"]');
        const empty = scrollArea.querySelector('.text-zinc-600');
        return items.length > 0 || empty !== null;
      },
      { timeout },
    );
  }

  // ─── Item Matching ─────────────────────────────────────────────

  /**
   * Find an item whose primary name (.font-medium element) exactly matches
   * the given text. Uses regex anchors to avoid substring false positives.
   */
  private findItemByExactName(name: string) {
    return this.browser
      .locator('.overflow-y-auto [role="button"]')
      .filter({
        has: this.page.locator('.font-medium', { hasText: new RegExp(`^${escapeRegex(name)}`) }),
      })
      .first();
  }

  // ─── Navigation Actions ────────────────────────────────────────

  /**
   * Select a project by its XNAT project ID.
   * Resolves the ID to a display name via the API, then clicks the matching item.
   * Throws if the project ID does not exist on the server.
   */
  async selectProject(projectId: string) {
    await this.waitForLevel('projects');
    await this.waitForLoaded();

    // Resolve project ID → display name via the XNAT API
    const project = await this.page.evaluate(async (id: string) => {
      const projects = await (window as any).electronAPI.xnat.getProjects();
      const match = projects.find((p: any) => p.id === id);
      return match ? { id: match.id, name: match.name } : null;
    }, projectId);

    if (!project) {
      throw new Error(
        `Project ID "${projectId}" not found on the XNAT server. `
        + 'Check XNAT_TEST_PROJECT in .env.e2e — the project may not exist or you may not have access.',
      );
    }

    const item = this.findItemByExactName(project.name);
    await item.click();

    await this.waitForLevel('subjects');
    await this.waitForLoaded();
  }

  /**
   * Select a subject by its label.
   * Verifies the label exists in the current subject list via the API.
   * Throws if the subject label is not found.
   */
  async selectSubject(subjectLabel: string) {
    await this.waitForLevel('subjects');
    await this.waitForLoaded();

    const item = this.findItemByExactName(subjectLabel);
    const count = await item.count();

    if (count === 0) {
      throw new Error(
        `Subject "${subjectLabel}" not found in the browser list. `
        + 'Check XNAT_TEST_SUBJECT in .env.e2e — the subject may not exist in the selected project.',
      );
    }

    await item.click();
    await this.waitForLevel('sessions');
    await this.waitForLoaded();
  }

  /**
   * Expand a session to reveal its scans inline.
   * Throws if the session label is not found.
   */
  async expandSession(sessionLabel: string) {
    await this.waitForLevel('sessions');
    await this.waitForLoaded();

    // Session items contain the label in a .font-medium element.
    // Session labels may have a modality badge appended, so match with startsWith.
    const sessionItem = this.browser
      .locator('.overflow-y-auto [role="button"]')
      .filter({
        has: this.page.locator('.font-medium', { hasText: new RegExp(`^${escapeRegex(sessionLabel)}`) }),
      })
      .first();

    const count = await sessionItem.count();
    if (count === 0) {
      throw new Error(
        `Session "${sessionLabel}" not found in the browser list. `
        + 'Check XNAT_TEST_SESSION in .env.e2e — the session may not exist for the selected subject.',
      );
    }

    await sessionItem.click();

    // Wait for scans to load inside the expanded session
    await this.spinner.waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {});
    await this.browser.locator('.overflow-y-auto .pb-2 button.w-full').first()
      .waitFor({ state: 'visible', timeout: 30_000 });
  }

  /**
   * Click a scan by ID inside an expanded session.
   */
  async clickScan(scanId: string) {
    const scanItem = this.browser
      .locator('.overflow-y-auto button.w-full')
      .filter({ hasText: `#${scanId}` })
      .first();

    const count = await scanItem.count();
    if (count === 0) {
      throw new Error(
        `Scan #${scanId} not found in the expanded session. `
        + 'Check XNAT_TEST_SCAN in .env.e2e — the scan may not exist in the selected session.',
      );
    }

    await scanItem.click();
  }

  /** Navigate back to the projects root, dismissing any unsaved-changes dialogs. */
  async navigateToProjects() {
    await this.breadcrumb.locator('button').first().click();

    // If an "unsaved annotations" dialog appears, dismiss it
    const unsavedBtn = this.page.locator('button', { hasText: 'Continue without saving' });
    if (await unsavedBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await unsavedBtn.click();
      await this.page.waitForTimeout(300);
    }

    await this.waitForLevel('projects');
    await this.waitForLoaded();
  }

  // ─── Query Helpers ─────────────────────────────────────────────

  async getItemCount(): Promise<number> {
    return this.items.count();
  }

  async getItemTexts(): Promise<string[]> {
    const texts: string[] = [];
    const count = await this.items.count();
    for (let i = 0; i < count; i++) {
      texts.push(await this.items.nth(i).innerText());
    }
    return texts;
  }

  /**
   * Full drill-down: project → subject → session (expand) → click scan.
   */
  async navigateAndLoadScan(project: string, subject: string, session: string, scanId?: string) {
    await this.selectProject(project);
    await this.selectSubject(subject);
    await this.expandSession(session);
    if (scanId) {
      await this.clickScan(scanId);
    } else {
      // Click the first scan button
      const scanButtons = this.browser.locator('.overflow-y-auto .pb-2 button.w-full');
      await scanButtons.first().click();
    }
  }

  /**
   * Navigate and expand a session (without clicking a scan).
   */
  async navigateToSession(project: string, subject: string, session: string) {
    await this.selectProject(project);
    await this.selectSubject(subject);
    await this.expandSession(session);
  }
}

/** Escape special regex characters in a string */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
