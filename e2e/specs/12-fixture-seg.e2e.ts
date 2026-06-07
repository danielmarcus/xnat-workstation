/**
 * Fixture validation — seg-multilabel loads through the app's real SEG loader.
 *
 * Offline (no XNAT): load the seg-multilabel dataset (source CT slices + the
 * hand-built multi-segment BINARY SEG, shared UIDs) via the local-import path
 * and confirm the adapter (createFromDICOMSegBuffer) parses + spatially matches
 * it into a segmentation container. The "loads in-harness" gate for the SEG
 * fixture (S4).
 */
import { test, expect } from '../fixtures/electron-app';
import { ensureFixture, enterLocalViewer, loadLocalDicom } from '../helpers/local-fixture';

test('seg-multilabel loads as a segmentation container', async ({ page }) => {
  const files = ensureFixture('seg-multilabel'); // source slices + seg.dcm
  await enterLocalViewer(page);
  await loadLocalDicom(page, files);

  await expect
    .poll(
      () => page.evaluate(() => window.__XNAT_E2E__!.getSegmentationCount()),
      { timeout: 20_000, message: 'seg-multilabel should load as >=1 container' },
    )
    .toBeGreaterThan(0);
});
