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
  setMultiviewportEnabled: (v: boolean) => void;
  getActiveUnifiedTool: () => string | null;
  getUnifiedToolMode: (csToolName: string) => string | null;
}
type Win = { __XNAT_E2E__: E2EHooks };

test('toolbar Length selection routes to the unified tool group (flag on)', async ({ page }) => {
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setMultiviewportEnabled(true));
  await enterLocalViewer(page);
  const files = ensureFixture('ct-axial-300');
  await page.locator('[data-testid="local-import-input"]').setInputFiles(files);
  await expect(page.locator('[data-testid="unified-viewport-element:panel_0"] canvas'))
    .toBeVisible({ timeout: 30_000 });

  // Select the Length tool through the REAL toolbar (same affordance as the
  // walking skeleton): expand the annotation-tools group if collapsed, open the
  // measurement dropdown, click Length.
  const annotationGroupTrigger = page.locator('button[title="Annotation tools"]');
  if (await annotationGroupTrigger.isVisible().catch(() => false)) {
    await annotationGroupTrigger.click();
  }
  const measureTrigger = page.locator('button[title="Annotation & measurement tools"]');
  await measureTrigger.waitFor({ state: 'visible', timeout: 5_000 });
  await measureTrigger.click();
  await page.getByRole('button', { name: 'Length', exact: true }).click();

  // The selection reached the unified tool group (not the old toolService).
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getActiveUnifiedTool()), {
      timeout: 10_000,
      message: 'toolbar Length should activate Length on the unified group',
    })
    .toBe('Length');
  expect(await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getUnifiedToolMode('Length'))).toBe('Active');
});
