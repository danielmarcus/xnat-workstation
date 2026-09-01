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
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../helpers/local-fixture';

interface E2EHooks {
  getUnifiedBrushSize: () => number | null;
}
type Win = { __XNAT_E2E__: E2EHooks };

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
