/**
 * Bug (user-reported): after creating a new Structure or Segmentation, the drawing
 * tools "didn't display and no work could be done" — the active drawing tool stayed
 * null, so drawing did nothing.
 *
 * Root cause: dac1eff's auto-tool-switch derived the kind from the projected
 * `containers` list captured at the last render — which does NOT yet include a
 * JUST-CREATED container — so `ensureToolForKind` was skipped on create and no tool
 * was activated. (Measurement/SR create called ensureToolForKind explicitly, so it
 * was unaffected.) Fix: pass the kind to activateAndBridge on create.
 *
 * Spec 63 covers activating EXISTING containers; this covers the CREATE path that
 * slipped through. Drives the real panel create buttons.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../helpers/local-fixture';

interface E2EHooks {
  setMultiviewportEnabled: (v: boolean) => void;
  getActiveUnifiedTool: () => string | null;
}
type Win = { __XNAT_E2E__: E2EHooks };
const activeTool = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getActiveUnifiedTool());

const CASES = [
  { button: 'New Segmentation (SEG)', hasMember: true, expectedTool: 'Brush' },
  { button: 'New Structure (RTSTRUCT)', hasMember: true, expectedTool: 'FreehandContour' },
  { button: 'New Measurement (SR)', hasMember: false, expectedTool: 'Length' },
] as const;

for (const c of CASES) {
  test(`creating "${c.button}" auto-activates its drawing tool (${c.expectedTool})`, async ({ page }) => {
    await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setMultiviewportEnabled(true));
    await loadFixture(page, 'ct-axial-300', 'panel_0');

    await page.getByRole('button', { name: 'Show segmentation panel' }).click();
    const panel = page.locator('[data-testid="annotations-side-panel"]');
    await expect(panel).toBeVisible({ timeout: 15_000 });

    await panel.getByRole('button', { name: c.button }).click();
    // Commit the create-in-edit names so the flow settles (don't leave inline edits open).
    const renameContainer = panel.getByLabel('Rename container');
    if (await renameContainer.isVisible({ timeout: 5_000 }).catch(() => false)) await renameContainer.press('Enter');
    if (c.hasMember) {
      const renameMember = panel.getByLabel('Rename member');
      if (await renameMember.isVisible({ timeout: 5_000 }).catch(() => false)) await renameMember.press('Enter');
    }

    // CONTRACT: a drawing tool of the created kind is now active — so the user can draw
    // immediately. RED before the fix: getActiveUnifiedTool() stayed null for SEG/RTSTRUCT.
    await expect
      .poll(() => activeTool(page), {
        timeout: 10_000,
        message: `creating a ${c.button} should activate the ${c.expectedTool} tool`,
      })
      .toBe(c.expectedTool);
  });
}
