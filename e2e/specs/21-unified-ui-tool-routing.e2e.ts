/**
 * P1.8a — the real toolbar drives the UNIFIED tool group when the flag is on.
 *
 * With multiviewport on, clicking a tool in the actual Toolbar must route through
 * viewerStore.setActiveTool → unifiedToolService (the unified group), not the old
 * toolService. Here we select the Length tool via the genuine toolbar affordance
 * (no setter shortcut) and assert it became the active tool on the unified group.
 * This is the wiring that makes the unified path controllable through the real UI
 * (the gate for flipping the flag default on).
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { ensureFixture, enterLocalViewer } from '../helpers/local-fixture';

interface E2EHooks {
  getActiveUnifiedTool: () => string | null;
  getUnifiedToolMode: (csToolName: string) => string | null;
}
type Win = { __XNAT_E2E__: E2EHooks };

test('toolbar Length selection routes to the unified tool group (flag on)', async ({ page }) => {
  await enterLocalViewer(page);
  const files = ensureFixture('ct-axial-300');
  await page.locator('[data-testid="local-import-input"]').setInputFiles(files);
  await expect(page.locator('[data-testid="unified-viewport-element:panel_0"] canvas'))
    .toBeVisible({ timeout: 30_000 });

  // Select Length through the REAL UI. The toolbar measurement dropdown was removed
  // (frozen §10 — measurement tools moved to the kind-adaptive side-panel toolbox),
  // so drive the toolbox: open the panel, create a Measurement container (→ toolbox
  // shows measurement tools), click Length.
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Measurement (SR)' }).click();
  await panel.getByLabel('Rename container').press('Enter');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await expect(toolbox).toBeVisible({ timeout: 10_000 });
  await toolbox.getByLabel('Length').click();

  // The selection reached the unified tool group (not the old toolService).
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getActiveUnifiedTool()), {
      timeout: 10_000,
      message: 'toolbar Length should activate Length on the unified group',
    })
    .toBe('Length');
  expect(await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getUnifiedToolMode('Length'))).toBe('Active');
});
