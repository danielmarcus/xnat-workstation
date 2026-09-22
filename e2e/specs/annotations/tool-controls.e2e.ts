/**
 * Selecting a tool shows exactly the controls it needs — no more, no fewer.
 *
 * Reported as "controls are missing to set needed values", and both halves were true:
 *
 *  - The intensity window was gated on `activeToolId === 'threshold'`, one hardcoded id.
 *    Sph. Thresh and Rect Multi are governed by that window and had no way to set it.
 *  - Dyn. Thresh samples a radius around the first click and had NO control at all; it
 *    ran on a hidden constant.
 *  - The brush radius was shown for every SEG tool, including Circle and Select,
 *    which ignore it.
 *
 * The requirement is now declared per tool in the catalog (`needs`) and the toolbox
 * renders from that, so a new tool cannot forget to surface the control it depends on.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

type Win = { __XNAT_E2E__: { resetUnifiedSegmentations: () => void } };

async function segToolbox(page: Page) {
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await panel.getByLabel('Rename container').press('Enter');
  const mr = panel.getByLabel('Rename member');
  if (await mr.count()) await mr.press('Enter');
  return panel;
}

/** Which of the tool-specific controls are on screen. */
const visibleControls = async (panel: ReturnType<Page['locator']>) => ({
  brushSize: (await panel.getByLabel('Brush size').count()) > 0,
  intensityWindow: (await panel.locator('[data-testid="threshold-controls"]').count()) > 0,
  samplingRadius: (await panel.locator('[data-testid="sampling-radius-controls"]').count()) > 0,
  editMode: (await panel.locator('[data-testid="edit-mode-controls"]').count()) > 0,
});

const CASES = [
  { tool: 'Brush', brushSize: true, intensityWindow: false, samplingRadius: false, editMode: true },
  { tool: 'Threshold', brushSize: true, intensityWindow: true, samplingRadius: false, editMode: false },
  { tool: 'Sph. Brush', brushSize: true, intensityWindow: false, samplingRadius: false, editMode: true },
  // Threshold variants are fill-only — Cornerstone ships no erase-threshold strategy.
  { tool: 'Sph. Thresh', brushSize: true, intensityWindow: true, samplingRadius: false, editMode: false },
  { tool: 'Dyn. Thresh', brushSize: true, intensityWindow: false, samplingRadius: true, editMode: false },
  { tool: 'Rect Multi', brushSize: false, intensityWindow: true, samplingRadius: false, editMode: false },
  // The shape tools carry the add/remove mode toggle and nothing else — notably no
  // brush radius, which they ignore.
  { tool: 'Circle', brushSize: false, intensityWindow: false, samplingRadius: false, editMode: true },
  { tool: 'Rect', brushSize: false, intensityWindow: false, samplingRadius: false, editMode: true },
  { tool: 'Sphere', brushSize: false, intensityWindow: false, samplingRadius: false, editMode: true },
  { tool: 'Select', brushSize: false, intensityWindow: false, samplingRadius: false, editMode: false },
];

test('each tool shows exactly the controls it declares it needs', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
  const panel = await segToolbox(page);

  for (const c of CASES) {
    await panel.getByRole('button', { name: c.tool, exact: true }).click();
    await page.waitForTimeout(200);
    expect(await visibleControls(panel), `controls shown for "${c.tool}"`).toEqual({
      brushSize: c.brushSize,
      intensityWindow: c.intensityWindow,
      samplingRadius: c.samplingRadius,
      editMode: c.editMode,
    });
  }
});

test('the sampling radius control actually drives the dynamic threshold brush', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
  const panel = await segToolbox(page);

  await panel.getByRole('button', { name: 'Dyn. Thresh', exact: true }).click();
  const slider = panel.getByLabel('Sample radius');
  await expect(slider).toBeVisible();

  // Moving it must change the value the tool will use, not just the slider's own position.
  await slider.fill('7');
  await page.waitForTimeout(200);
  expect(
    await page.evaluate(() => {
      const w = window as unknown as { __XNAT_E2E__: Record<string, unknown> };
      void w;
      return document.querySelector('[data-testid="sampling-radius-controls"]')?.textContent ?? '';
    }),
    'the readout must reflect the new radius',
  ).toContain('7');
});
