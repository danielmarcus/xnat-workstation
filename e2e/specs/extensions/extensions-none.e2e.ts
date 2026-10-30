/**
 * An edition with no extensions (extension framework, wireframe rules): the app is exactly as
 * before — Settings has no Extensions tab.
 */
import { test, expect } from '../../fixtures/electron-app';
import { enterLocalViewer } from '../../helpers/local-fixture';

test('with no extensions, Settings has no Extensions tab', async ({ page }) => {
  await enterLocalViewer(page);
  await page.getByTitle('Open settings').click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog.getByRole('button', { name: 'Modules', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Extensions', exact: true })).toHaveCount(0);
});
