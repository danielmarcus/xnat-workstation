/**
 * Annotations panel — tool affordance (Rebuild Phase 3 / signal 35 part: D1/D3).
 *
 * The context toolbox offers only the ACTIVE container kind's tools (a measurement
 * tool is not meaningful for a Segmentation, so it isn't offered), and a registered-
 * but-not-yet-implemented "planned" tool renders DISABLED rather than silently
 * misapplied. Drives the real panel.
 *
 * (Signal 35's keyboard-scoping half — global undo/redo/save/active-tool vs.
 * per-active-panel view shortcuts — depends on the focus/hotkey model and is tracked
 * separately.)
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../helpers/local-fixture';

const panelOf = (page: Page) => page.locator('[data-testid="annotations-side-panel"]');

test('the context toolbox offers only the active kind’s tools; planned tools are disabled', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  const panel = panelOf(page);
  await expect(panel).toBeVisible({ timeout: 15_000 });

  // Create a Segmentation + commit the two-step rename → its toolbox appears.
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await panel.getByLabel('Rename container').press('Enter');
  await panel.getByLabel('Rename member').press('Enter');

  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await expect(toolbox).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByText('Segmentation tools')).toBeVisible();

  // A segmentation tool is offered + enabled. (Exact — "Brush" is also a substring
  // of "Sph. Brush".)
  await expect(toolbox.getByRole('button', { name: 'Brush', exact: true })).toBeEnabled();
  // A "planned" (registered-but-unimplemented) tool is present but DISABLED (not misapplied).
  await expect(toolbox.getByRole('button', { name: 'Dyn. Thresh', exact: true })).toBeDisabled();
  // A measurement-only tool is NOT meaningful for a SEG → not offered at all (D1/D3).
  await expect(toolbox.getByRole('button', { name: 'Angle', exact: true })).toHaveCount(0);
  await expect(toolbox.getByRole('button', { name: 'Probe', exact: true })).toHaveCount(0);
});
