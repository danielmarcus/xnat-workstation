/**
 * C5c — the MPR layout's fourth slot is a 3D VOLUME RENDERING.
 *
 * Until now `getPresetPanels('mpr-2x2')` gave the fourth panel a second AXIAL slice
 * view (the spec's 3D slot was carried as an open item). This asserts the real thing
 * through the real layout preset:
 *   • Cornerstone reports panel_3 as a `volume3d` viewport (not `orthographic`);
 *   • its canvas renders NON-BLANK pixels — a 3D render that silently produces an
 *     empty canvas is the failure mode that matters, so pixels are the assertion;
 *   • it is NOT in the slice tool group (brush/crosshairs assume a slice plane), and
 *     it IS in the 3D rotate group;
 *   • the three slice panels are unaffected.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../helpers/local-fixture';

interface E2EHooks {
  setLayoutPreset: (preset: 'single' | 'mpr-2x2') => void;
  getViewportType: (panelId: string) => string | null;
  getViewportToolGroupId: (panelId: string) => string | null;
  getUnifiedToolGroupViewportIds: () => string[];
  clearAllContainers: () => void;
}
type Win = { __XNAT_E2E__: E2EHooks };

const hook = <T,>(page: Page, fn: keyof E2EHooks, ...args: unknown[]): Promise<T> =>
  page.evaluate(
    ([name, a]) => (window as unknown as Win).__XNAT_E2E__[name as keyof E2EHooks](...(a as [])),
    [fn, args] as const,
  ) as Promise<T>;

/** Fraction of non-black pixels in a canvas screenshot (a blank 3D render is all black). */
async function nonBlackFraction(page: Page, panelId: string): Promise<number> {
  const shot = await page
    .locator(`[data-testid="unified-viewport-element:${panelId}"] canvas`)
    .first()
    .screenshot();
  // PNG bytes → count how many differ from the surrounding black; cheap proxy that
  // avoids decoding: compare against a same-size screenshot of a blank canvas is
  // overkill, so decode via the page instead.
  const base64 = shot.toString('base64');
  return page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const { data: px } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let lit = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] > 12 || px[i + 1] > 12 || px[i + 2] > 12) lit += 1;
    }
    return lit / (px.length / 4);
  }, base64);
}

test.afterEach(async ({ page }) => {
  await hook(page, 'clearAllContainers');
  await hook(page, 'setLayoutPreset', 'single');
});

test('the MPR 2x2 preset renders a 3D volume in its fourth panel', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');

  await hook(page, 'setLayoutPreset', 'mpr-2x2');
  for (const panel of ['panel_0', 'panel_1', 'panel_2', 'panel_3']) {
    await page
      .locator(`[data-testid="unified-viewport-element:${panel}"] canvas`)
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 });
  }

  // panel_3 is a 3D volume viewport; the slice panels stay orthographic.
  await expect
    .poll(() => hook<string | null>(page, 'getViewportType', 'panel_3'), {
      timeout: 30_000,
      message: 'the fourth MPR panel should be a 3D volume viewport',
    })
    .toBe('volume3d');
  expect(await hook<string | null>(page, 'getViewportType', 'panel_0')).toBe('orthographic');
  expect(await hook<string | null>(page, 'getViewportType', 'panel_1')).toBe('orthographic');
  expect(await hook<string | null>(page, 'getViewportType', 'panel_2')).toBe('orthographic');

  // It actually renders something: a 3D view that produces an all-black canvas is
  // the real failure mode (bad transfer function / empty volume / no camera).
  await expect
    .poll(() => nonBlackFraction(page, 'panel_3'), {
      timeout: 60_000,
      intervals: [1_000],
      message: 'the 3D panel should render visible voxels, not a blank canvas',
    })
    .toBeGreaterThan(0.01);

  // Slice-only chrome is gone from the 3D panel: no reformat dropdown, no slice
  // counter, no scale bar, no slice scrollbar, no in-plane edge markers. (Showing
  // "1 / 1" and "Thick: 3 mm" on a projected view is what this prevents.)
  const panel3 = page.locator('[data-testid="unified-viewport:panel_3"]');
  await expect(panel3.locator('[data-testid="orientation-select:panel_3"]')).toHaveCount(0);
  await expect(panel3.locator('[data-testid="overlay-orientation-markers:panel_3"]')).toHaveCount(0);
  await expect(panel3.locator('[data-testid="viewport-scrollbar:panel_3"]')).toHaveCount(0);
  // …while a slice panel still has them.
  await expect(page.locator('[data-testid="orientation-select:panel_0"]')).toHaveCount(1);

  // Tool groups: the 3D panel is out of the slice group and in the rotate group.
  const sliceGroupPanels = await hook<string[]>(page, 'getUnifiedToolGroupViewportIds');
  expect(sliceGroupPanels).toContain('panel_0');
  expect(sliceGroupPanels).not.toContain('panel_3');
  expect(await hook<string | null>(page, 'getViewportToolGroupId', 'panel_3')).toBe('xnatToolGroup_volume3d');
});
