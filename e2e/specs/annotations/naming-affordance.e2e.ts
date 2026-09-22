/**
 * Two things a user has to be able to SEE, reported from use.
 *
 *  - That the new annotation's name is editable. The highlight used to appear only once
 *    a character had been typed, so a user had to already know the label was taking
 *    keystrokes in order to discover it. It now appears the moment create is clicked.
 *  - That a stroke is not silently handed to the slice scrollbar. That strip lives
 *    INSIDE the viewport at its right edge, so drawing near the edge drifted onto it and
 *    started scrubbing slices mid-stroke.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

type Win = { __XNAT_E2E__: { resetUnifiedSegmentations: () => void; getPaintedVoxelCount: () => number } };

async function openPanel(page: Page) {
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  return panel;
}

test('the name is visibly editable as soon as the annotation is created', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
  const panel = await openPanel(page);

  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await expect(panel.locator('[data-testid^="container-row-"]').first()).toBeVisible({ timeout: 15_000 });

  // Before a single keystroke, the container label is marked as the one taking input…
  await expect(
    panel.locator('[data-capturing="true"]'),
    'the container label must show it is editable before anything is typed',
  ).toHaveCount(1);
  // …and it still shows its default name, so the user can see what they are replacing.
  await expect(panel.locator('[data-capturing="true"]')).toContainText(/Segmentation/);

  // After Enter the highlight moves to the member label — again before typing.
  await page.keyboard.press('Enter');
  await expect(panel.locator('[data-testid^="member-row-"] [data-capturing="true"]')).toHaveCount(1);
  await expect(panel.locator('[data-capturing="true"]')).toContainText(/Segment/);

  // And it is gone once the sequence ends.
  await page.keyboard.press('Enter');
  await expect(panel.locator('[data-capturing="true"]')).toHaveCount(0);
});

test('a stroke that drifts onto the slice scrollbar keeps drawing and does not scrub', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
  const panel = await openPanel(page);
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await expect(panel.locator('[data-testid^="member-row-"]').first()).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  await panel.getByRole('button', { name: 'Brush', exact: true }).click();
  await panel.getByRole('button', { name: 'fill', exact: true }).click();

  const sliceIndex = () =>
    page.evaluate(() => {
      const el = document.querySelector('[data-testid="scrollbar-thumb:panel_0"]') as HTMLElement | null;
      return el?.style.top ?? null;
    });
  const before = await sliceIndex();

  // Draw from mid-image out THROUGH the scrollbar strip at the right edge.
  const box = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;
  const y = box.y + box.height * 0.5;
  await page.mouse.move(box.x + box.width * 0.5, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 3, y, { steps: 12 }); // onto the scrollbar
  await page.mouse.move(box.x + box.width - 3, y + 40, { steps: 8 }); // and along it
  await page.mouse.up();
  await page.waitForTimeout(400);

  expect(
    await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelCount()),
    'the stroke must have painted',
  ).toBeGreaterThan(0);
  expect(
    await sliceIndex(),
    'and must NOT have scrubbed the slice — the scrollbar is inert while drawing',
  ).toBe(before);
});
