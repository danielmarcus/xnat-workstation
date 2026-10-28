/**
 * Editions (SegWorks parity branch 9, M6 — docs/editions.md): a module an edition bundles is
 * listed as Bundled, runs like any module, can be disabled but not removed, and cannot be
 * replaced by installing a package with its id. The packaged build's own edition is checked by
 * `npm run test:edition` (e2e/specs/packaging/edition-package.e2e.ts).
 */
import * as path from 'path';
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';
import { setSlider, pickOperation, operationGroupItems } from '../../helpers/operations';
import { bundle, installDirect, packDirectory, REPO_MODULES, resetModules } from '../../helpers/modules';

const voxels = (page: Page) => page.evaluate(() => (window as unknown as { __XNAT_E2E__: { activeSegmentVoxelCount: () => number } }).__XNAT_E2E__.activeSegmentVoxelCount());

test('a bundled module is listed as Bundled, runs, can be disabled, and can be neither removed nor replaced', async ({ electronApp, page }) => {
  await resetModules(electronApp);
  const pkg = packDirectory(path.join(REPO_MODULES, 'examples', 'threshold'), 'threshold-bundled');
  const unbundle = await bundle(electronApp, pkg);
  try {
    await page.reload();
    await loadFixture(page, 'ct-axial-anatomy', 'panel_0');

    // Settings › Modules: Bundled, Enabled, no Remove.
    await page.getByTitle('Open settings').click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await dialog.getByRole('button', { name: 'Modules', exact: true }).click();
    const row = dialog.getByTestId('module-row-org.xnat.examples.threshold');
    await expect(row).toContainText('Bundled');
    await expect(row.getByLabel('Enable Intensity threshold')).toBeChecked();
    await expect(row.getByRole('button', { name: /Remove/ })).toHaveCount(0);
    // A package with its id is refused: the edition's copy cannot be replaced.
    const replaced = await installDirect(electronApp, pkg);
    expect(replaced).toMatchObject({ ok: false, reason: expect.stringMatching(/built into this edition/) });
    await dialog.getByTitle('Close', { exact: true }).click();

    // It runs, like any module.
    const panel = page.locator('[data-testid="annotations-side-panel"]');
    if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
    await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
    await page.keyboard.press('Escape');
    await pickOperation(panel, 'Intensity threshold');
    const sheet = panel.getByTestId('module-sheet');
    await expect(sheet.getByTestId('module-tier')).toHaveText('Bundled');
    await setSlider(sheet.getByLabel('From', { exact: true }), 500);
    await sheet.getByRole('button', { name: 'Run' }).click();
    await expect(page.getByTestId('mask-preview-bar')).toContainText('Intensity threshold');
    await page.keyboard.press('Enter');
    await expect.poll(() => voxels(page)).toBeGreaterThan(500);

    // Disabled: it leaves the picker, and is still listed (as Bundled) to enable again.
    await page.getByTitle('Open settings').click();
    await dialog.getByRole('button', { name: 'Modules', exact: true }).click();
    await row.getByLabel('Enable Intensity threshold').uncheck();
    await dialog.getByTitle('Close', { exact: true }).click();
    await expect.poll(() => operationGroupItems(panel, 'Modules')).toEqual([]);
    await page.getByTitle('Open settings').click();
    await dialog.getByRole('button', { name: 'Modules', exact: true }).click();
    await expect(row).toContainText('Bundled');
    await expect(row.getByLabel('Enable Intensity threshold')).not.toBeChecked();
    await dialog.getByTitle('Close', { exact: true }).click();
  } finally {
    unbundle();
  }
});
