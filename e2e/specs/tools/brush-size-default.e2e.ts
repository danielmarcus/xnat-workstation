/**
 * Bug (user-reported): the brush defaulted to a hardcoded radius rather than the
 * configured `preferences.annotation.defaultBrushSize`. The default lived in three
 * disconnected places (viewerStore brushSize=10, the panel toolbox useState=25, and
 * Cornerstone's own default) and the configured preference was never read.
 *
 * Fix: the UI states initialize from the preference, and the unified tool group is
 * seeded with the configured default when its first viewport joins (addViewport).
 *
 * This asserts Cornerstone's actual brush radius equals the configured default after
 * a scan loads (the viewport joins the tool group during load).
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

interface E2EHooks {
  getUnifiedBrushSize: () => number | null;
  setActiveUnifiedTool: (t: string) => void;
  getPaintedVoxelCount: () => number;
  resetUnifiedSegmentations: () => void;
}
type Win = { __XNAT_E2E__: E2EHooks };

/** Paint one dab at the centre of panel_0 and report how much it covered. */
async function dabExtent(page: Page): Promise<number> {
  const box = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5 + 2, box.y + box.height * 0.5, { steps: 2 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  return page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelCount());
}

// DEFAULT_PREFERENCES.annotation.defaultBrushSize — src/shared/types/preferences.ts.
// (No persisted prefs in E2E, so the built-in default applies.)
const CONFIGURED_DEFAULT = 5;

test('the brush radius defaults to the configured preference (not a hardcoded value)', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');

  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getUnifiedBrushSize()), {
      timeout: 10_000,
      message: 'the unified tool group should seed the configured default brush radius',
    })
    .toBe(CONFIGURED_DEFAULT);
});

/**
 * The radius above is the internal number. What the bug was actually about is the size of
 * the mark the brush leaves, so assert that too — and relative to a deliberately larger
 * radius, since an absolute voxel count would be a magic number tied to this fixture's
 * geometry.
 *
 * The slider is also checked: it is the surface the user reads the value from, and the
 * original bug was precisely that three places disagreed about the default.
 */
test('the configured default is what the brush actually paints, and what the slider shows', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());

  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });

  // The slider the user reads — it must agree with the configured default, which is the
  // disagreement the original bug was made of.
  const slider = panel.locator('input[type="range"]').last();
  if (await slider.count()) {
    expect(Number(await slider.inputValue()), 'the brush-size slider shows the configured default')
      .toBe(CONFIGURED_DEFAULT);
  }

  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await panel.getByLabel('Rename container').press('Enter');
  const memberRename = panel.getByLabel('Rename member');
  if (await memberRename.count()) await memberRename.press('Enter');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setActiveUnifiedTool('Brush'));

  const atDefault = await dabExtent(page);
  expect(atDefault, 'a dab at the default radius must paint something').toBeGreaterThan(0);

  // A visibly larger radius must leave a visibly larger mark. This is what makes the
  // number above mean something: without it, "painted > 0" holds at any radius.
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await panel.getByLabel('Rename container').press('Enter');
  const rename2 = panel.getByLabel('Rename member');
  if (await rename2.count()) await rename2.press('Enter');
  await page.evaluate(() => {
    const w = window as unknown as { __XNAT_E2E__: { setUnifiedBrushSize: (n: number) => void } };
    w.__XNAT_E2E__.setUnifiedBrushSize(20);
  });
  const atLarge = await dabExtent(page);
  expect(atLarge, 'a 20px radius must paint more than the default 5px one').toBeGreaterThan(atDefault);
});
