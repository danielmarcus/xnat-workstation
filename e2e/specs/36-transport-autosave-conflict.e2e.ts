/**
 * Transport — live autosave (signal 14) + conflict resolution (signal 27), driven
 * against the in-memory mock XNAT (the mocked-XNAT harness). Exercises the REAL
 * path: edit → onSegmentationDataModified → saveQueue (autosave opt-in on) →
 * transportService → xnatTransport → mock → transportStore. No live server.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { ensureFixture, enterLocalViewer, loadLocalDicom } from '../helpers/local-fixture';

interface E2EHooks {
  setMultiviewportEnabled: (v: boolean) => void;
  setActiveUnifiedTool: (toolName: string) => void;
  setUnifiedBrushSize: (size: number) => void;
  createUnifiedLabelmapSegmentation: (label?: string) => Promise<{ segmentationId: string; segmentIndex: number }>;
  installMockXnatTransport: () => void;
  getContainerSaveState: (id: string) => { dirty: boolean; inFlight: boolean };
  flushContainerSave: (id: string) => Promise<void>;
  getTransportEntry: (id: string) => { phase: string; errorKind?: string; versionToken?: string } | null;
  injectTransportConflict: () => void;
  resolveConflictKeepLocal: (id: string) => Promise<void>;
}
type Win = { __XNAT_E2E__: E2EHooks };

async function brush(page: Page, box: { x: number; y: number; width: number; height: number }) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - 20, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 20, cy + 20, { steps: 4 });
  await page.mouse.up();
}

async function setup(page: Page): Promise<string> {
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setMultiviewportEnabled(true));
  await enterLocalViewer(page);
  await loadLocalDicom(page, ensureFixture('ct-axial-300'), 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.installMockXnatTransport());
  const segId = await page.evaluate(async () =>
    (await (window as unknown as Win).__XNAT_E2E__.createUnifiedLabelmapSegmentation('Autosave SEG')).segmentationId,
  );
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setUnifiedBrushSize(25));
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setActiveUnifiedTool('Brush'));
  return segId;
}

const entry = (page: Page, id: string) =>
  page.evaluate((s) => (window as unknown as Win).__XNAT_E2E__.getTransportEntry(s), id);

test('signal 14: editing drives the saveQueue → mock save → container saved with a version token', async ({ page }) => {
  const segId = await setup(page);
  const box = await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox();
  expect(box).not.toBeNull();

  await brush(page, box!);
  // The edit drove the per-container saveQueue (autosave opt-in path).
  await expect
    .poll(() => page.evaluate((s) => (window as unknown as Win).__XNAT_E2E__.getContainerSaveState(s).dirty, segId), { timeout: 10_000 })
    .toBe(true);

  // Flush → the real queue→transport→store path runs against the mock.
  await page.evaluate((s) => (window as unknown as Win).__XNAT_E2E__.flushContainerSave(s), segId);
  await expect.poll(async () => (await entry(page, segId))?.phase, { timeout: 10_000 }).toBe('idle');
  const v1 = (await entry(page, segId))?.versionToken;
  expect(v1).toBeTruthy();

  // A second edit + save advances the server version (repeated saves work live).
  await brush(page, box!);
  await page.evaluate((s) => (window as unknown as Win).__XNAT_E2E__.flushContainerSave(s), segId);
  await expect.poll(async () => (await entry(page, segId))?.versionToken !== v1, { timeout: 10_000 }).toBe(true);
});

test('signal 27: an external change makes the next save a conflict; keep-local resolves it (H5/H7)', async ({ page }) => {
  const segId = await setup(page);
  const box = await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox();
  await brush(page, box!);
  await page.evaluate((s) => (window as unknown as Win).__XNAT_E2E__.flushContainerSave(s), segId);
  await expect.poll(async () => (await entry(page, segId))?.phase, { timeout: 10_000 }).toBe('idle');

  // Someone else modifies the container on the server → the next save conflicts (H5).
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.injectTransportConflict());
  await brush(page, box!);
  await page.evaluate((s) => (window as unknown as Win).__XNAT_E2E__.flushContainerSave(s), segId);
  await expect.poll(async () => (await entry(page, segId))?.errorKind, { timeout: 10_000 }).toBe('conflict');

  // Keep-local (H7): re-base onto the server version, then the save succeeds.
  await page.evaluate((s) => (window as unknown as Win).__XNAT_E2E__.resolveConflictKeepLocal(s), segId);
  await page.evaluate((s) => (window as unknown as Win).__XNAT_E2E__.flushContainerSave(s), segId);
  await expect.poll(async () => (await entry(page, segId))?.phase, { timeout: 10_000 }).toBe('idle');
  expect((await entry(page, segId))?.errorKind).toBeUndefined();
});
