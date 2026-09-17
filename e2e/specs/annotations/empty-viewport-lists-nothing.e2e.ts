/**
 * An EMPTY viewport lists no annotations.
 *
 * Reported from a 2x2 grid with one empty cell: focusing the empty viewport listed the
 * annotations belonging to a scan in another cell, with a cross-panel pill claiming it was
 * "rendering on 1 other panel". Nothing is rendering in a viewport that holds no images.
 *
 * The scoping predicate fails open when a container's spatial identity cannot be resolved,
 * which is right — an SR container is not a Cornerstone segmentation, and a container
 * mid-load has not attached yet, so hiding those would empty the panel wrongly. But an
 * empty viewport makes the VIEWPORT side unresolvable, and the same fail-open then listed
 * every container in the session. Two different unknowns with opposite correct answers.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

type Win = { __XNAT_E2E__: { resetUnifiedSegmentations: () => void } };

const focus = (page: Page, vp: string) =>
  page.locator(`[data-testid="unified-viewport:${vp}"]`).click({ position: { x: 20, y: 20 } });

test('focusing an empty viewport shows no annotations from the viewports that have scans', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');

  // A 2x2 grid with a scan in panel_0 only — the other three cells are empty.
  await page.locator('[title^="Viewport layout"]').click();
  await page.getByRole('button', { name: '2 x 2' }).click();
  await page.locator('[data-testid="unified-viewport:panel_3"]').waitFor({ state: 'attached', timeout: 20_000 });

  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());

  await focus(page, 'panel_0');
  await panel.getByRole('button', { name: 'New Structure (RTSTRUCT)' }).click();
  await panel.getByLabel('Rename container').press('Enter');
  const memberRename = panel.getByLabel('Rename member');
  if (await memberRename.count()) await memberRename.press('Enter');
  await expect(panel.locator('[data-testid^="container-row-"]')).toHaveCount(1);

  // Focus an empty cell. It holds no images, so it has no annotations.
  await focus(page, 'panel_3');
  await expect(
    panel.locator('[data-testid^="container-row-"]'),
    'a viewport with no scan loaded must list no annotations',
  ).toHaveCount(0);
  await expect(
    panel.locator('[data-testid="container-list"]').getByTitle(/Rendering on \d+ other panel/),
    'and must not claim anything is rendering on other panels',
  ).toHaveCount(0);

  // Back to the one with the scan — unchanged.
  await focus(page, 'panel_0');
  await expect(panel.locator('[data-testid^="container-row-"]')).toHaveCount(1);
});
