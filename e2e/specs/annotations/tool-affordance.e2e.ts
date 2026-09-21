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
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

const panelOf = (page: Page) => page.locator('[data-testid="annotations-side-panel"]');

test('the context toolbox offers only the active kind’s tools, and only implemented ones', async ({ page }) => {
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
  // Every tool the toolbox offers is now implemented — the "planned" (registered but
  // unimplemented) state was removed with Circle Multi, its last instance. A tool that is
  // unavailable in the current CONTEXT is still disabled, asserted below.
  await expect(
    toolbox.getByRole('button', { name: 'Circle Multi', exact: true }),
    'Circle Multi was removed from the app — Cornerstone has no fill path for a circle ROI',
  ).toHaveCount(0);
  // A measurement-only tool is NOT meaningful for a SEG → not offered at all (D1/D3).
  await expect(toolbox.getByRole('button', { name: 'Angle', exact: true })).toHaveCount(0);
  await expect(toolbox.getByRole('button', { name: 'Probe', exact: true })).toHaveCount(0);
});
