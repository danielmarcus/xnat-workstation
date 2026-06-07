/**
 * Fixture validation — rtstruct-typed loads through the app's real loader.
 *
 * Offline (no XNAT): load the rtstruct-typed dataset (source CT slices + the
 * hand-built RTSTRUCT, shared UIDs) via the app's local-import path and confirm
 * the RTSTRUCT parses + attaches as a structure container. This is the "loads
 * in-harness" gate for the hand-built RTSTRUCT fixture (S4).
 */
import { test, expect } from '../fixtures/electron-app';
import { ensureFixture, enterLocalViewer, loadLocalDicom } from '../helpers/local-fixture';

test('rtstruct-typed loads as a structure container', async ({ page }) => {
  const files = ensureFixture('rtstruct-typed'); // source slices + rtstruct.dcm
  await enterLocalViewer(page);
  await loadLocalDicom(page, files);

  // The RTSTRUCT should parse + attach as a (contour) segmentation container.
  await expect
    .poll(
      () => page.evaluate(() => window.__XNAT_E2E__!.getSegmentationCount()),
      { timeout: 20_000, message: 'rtstruct-typed should load as >=1 container' },
    )
    .toBeGreaterThan(0);

  const label = await page.evaluate(() => {
    const w = window as unknown as { __XNAT_E2E__: { getSegmentationIdByLabel: (l: string) => string | null } };
    return w.__XNAT_E2E__.getSegmentationIdByLabel('RTSTRUCT-TYPED');
  });
  // eslint-disable-next-line no-console
  console.log('[fixture] rtstruct-typed container id by label:', label);
});
