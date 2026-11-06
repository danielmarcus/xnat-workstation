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
    return this.browser.getByTestId('xnat-browser-item');
  }

  get spinner() {
    return this.browser.getByTestId('xnat-browser-loading');
  }

  get breadcrumb() {
    return this.browser.getByTestId('xnat-browser-breadcrumb');
  }

  /** The scan buttons of an expanded session (or the scans level); `data-scan-id` holds the id. */
  get scans() {
    return this.browser.getByTestId('xnat-browser-scan');
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
        const list = browser.querySelector('[data-testid="xnat-browser-list"]');
        if (!list) return false;
        const items = list.querySelectorAll('[data-testid="xnat-browser-item"], [data-testid="xnat-browser-scan"]');
        const empty = list.querySelector('[data-testid="xnat-browser-empty"]');
        return items.length > 0 || empty !== null;
      },
      { timeout },
    );
  }

  // ─── Item Matching ─────────────────────────────────────────────

  /**
   * Find an item whose name (`xnat-browser-item-name`) starts with the given text. Anchored,
   * so a name that merely contains it does not match.
   */
  private findItemByExactName(name: string) {
    return this.items
      .filter({
        has: this.page.getByTestId('xnat-browser-item-name').filter({ hasText: new RegExp(`^${escapeRegex(name)}`) }),
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

    // Session labels may have a modality badge appended, so match with startsWith.
    const sessionItem = this.findItemByExactName(sessionLabel);

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
    await this.scans.first().waitFor({ state: 'visible', timeout: 30_000 });
  }

  /**
   * Click a scan by ID inside an expanded session.
   */
  async clickScan(scanId: string) {
    const scanItem = this.browser.locator(`[data-testid="xnat-browser-scan"][data-scan-id="${scanId}"]`).first();

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
      await this.scans.first().click();
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
