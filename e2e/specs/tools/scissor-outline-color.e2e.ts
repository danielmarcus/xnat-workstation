/**
 * Settings → Annotation → Scissors "preview color" recolours the scissors outline.
 *
 * The preference was applied by the legacy `toolService`, whose tool group the app
 * never creates, so the Settings control changed nothing: the outline kept the segment
 * colour whatever was chosen. This drives the real surface — tick the box and pick the
 * colour in the Settings modal, then read the stroke Cornerstone actually drew on the
 * outline mid-drag.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

type Win = { __XNAT_E2E__: { resetUnifiedSegmentations: () => void } };

const VIEWPORT = '[data-testid="unified-viewport-element:panel_0"]';

async function setScissorPreview(page: Page, enabled: boolean, color?: string) {
  await page.getByTitle('Open settings').click();
  await page.getByRole('button', { name: 'Annotation', exact: true }).click();
  const box = page.getByLabel('Enable scissors preview');
  if ((await box.isChecked()) !== enabled) await box.click();
  if (color) await page.getByLabel('Preview color').fill(color);
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Enable scissors preview')).toBeHidden();
}

async function selectCircleScissors(page: Page) {
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await panel.getByRole('button', { name: 'Circle', exact: true }).click();
}

/** Start a circle drag, read the outline strokes while it is on screen, then release. */
async function outlineStrokesMidDrag(page: Page): Promise<string[]> {
  const box = (await page.locator(`${VIEWPORT} canvas`).boundingBox())!;
  await page.mouse.move(box.x + 150, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 220, { steps: 10 });
  await page.waitForTimeout(300);
  const strokes = await page.evaluate(
    (sel) =>
      Array.from(document.querySelectorAll(`${sel} svg circle`))
        .map((c) => c.getAttribute('stroke') ?? '')
        .filter(Boolean),
    VIEWPORT,
  );
  await page.mouse.up();
  return strokes;
}

test('the chosen preview colour is the colour the scissors outline is drawn in', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());

  await setScissorPreview(page, true, '#44aa66');
  await selectCircleScissors(page);

  const strokes = await outlineStrokesMidDrag(page);
  expect(strokes, 'a scissors outline should be on screen mid-drag').not.toHaveLength(0);
  expect(strokes).toContain('rgb(68,170,102)');
});

test('with the preview off the outline keeps the segment colour', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());

  await setScissorPreview(page, false, '#44aa66');
  await selectCircleScissors(page);

  const strokes = await outlineStrokesMidDrag(page);
  expect(strokes, 'a scissors outline should be on screen mid-drag').not.toHaveLength(0);
  expect(strokes).not.toContain('rgb(68,170,102)');
});
