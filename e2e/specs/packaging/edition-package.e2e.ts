/**
 * The packaged edition (branch 9, M6): run by `npm run test:edition` against an app packaged
 * with the test edition (e2e/fixtures/edition/test-edition.json) — it is named for the edition
 * and lists the module the edition bundles as Bundled, and the extension it ships as Active,
 * from inside the package. Skipped in the ordinary E2E runs (they launch dist/, not a package).
 */
import { test, expect } from '../../fixtures/electron-app';
import { enterLocalViewer, loadFixture } from '../../helpers/local-fixture';
import { installPro } from '../../helpers/extensions';

test.skip(process.env.E2E_EDITION_CHECK !== '1', 'run by npm run test:edition');

test('the packaged app is the edition: its name, and its bundled module', async ({ electronApp, page }) => {
  expect(await electronApp.evaluate(({ app }) => app.getName())).toBe(process.env.E2E_EDITION_APP_NAME);
  expect(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.getTitle()))).toContain(process.env.E2E_EDITION_PRODUCT);
  expect(await electronApp.evaluate(({ app }) => app.isPackaged)).toBe(true);
  await loadFixture(page, 'ct-axial-anatomy', 'panel_0');
  await page.getByTitle('Open settings').click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('button', { name: 'Modules', exact: true }).click();
  const row = dialog.getByTestId('module-row-org.xnat.examples.threshold');
  await expect(row).toContainText('Bundled');
  await expect(row.getByRole('button', { name: /Remove/ })).toHaveCount(0);
  await expect(dialog.locator('[data-testid^="module-row-"]')).toHaveCount(1); // only the edition's
});

test('the packaged app loads the extension the edition ships, from inside its archive', async ({ page }) => {
  await installPro(page); // its slots need their features licensed (X6)
  await page.reload({ waitUntil: 'load' });
  await enterLocalViewer(page);
  await page.getByTitle('Open settings').click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('button', { name: 'Extensions', exact: true }).click();
  const row = dialog.getByTestId('extension-row-org.xnat.examples.session-notes');
  await expect(row.getByTestId('extension-state')).toHaveText('Active · Pro');
  await expect(dialog.locator('[data-testid^="extension-row-"]')).toHaveCount(1);
  // Its UI renders with the app's React, from inside the archive: the sidebar tab and toolbar item.
  await dialog.getByTitle('Close', { exact: true }).click();
  await page.getByRole('tablist', { name: 'Sidebar' }).getByRole('tab', { name: 'Notes', exact: true }).click();
  await expect(page.getByTestId('extension-sidebar-tab-org.xnat.examples.session-notes')).toContainText('No notes yet.');
  await expect(page.getByTestId('extension-toolbar-item-org.xnat.examples.session-notes')).toContainText('0 notes');
});
