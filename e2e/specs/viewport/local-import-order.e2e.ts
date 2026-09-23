/**
 * Local import orders images by geometry, not by the order the files arrived in.
 *
 * Reported: local imports logged `(geometry=0, instance=0)` and showed files in
 * filename/insertion order. The metadata pre-load passed `dicomfile:N` through as a URL
 * (XHR'd, failed), so the metadata provider — which keys a local dataset by its
 * fileManager index — had nothing, and the sort was a no-op.
 *
 * The files are handed to the real Import <input> SHUFFLED, then the viewport is stepped
 * with real key presses and each displayed image is mapped back to its file. The fixture
 * filenames are in spatial order (slice-001 is the lowest position along the normal; the
 * localizer's a-/b-/c- prefixes are its planes in InstanceNumber order).
 *
 * A single-plane stack opens as a VOLUME viewport, which orders its own slices by
 * geometry (slice 0 is the top), so its walk is spatial either way. The panel's imageId
 * list is what the fix changes, and it drives every stack viewport and index mapping, so
 * that is asserted directly. The 3-plane localizer opens as a STACK viewport, where the
 * list order IS the displayed order, so its walk must match exactly.
 */
import path from 'path';
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { ensureFixture, enterLocalViewer, loadLocalDicom } from '../../helpers/local-fixture';

type SliceState = { imageIndex: number; totalImages: number; displayedImageId: string | null; displayedImageIndex: number };
type Win = {
  __XNAT_E2E__: {
    getPanelSliceState: (panelId: string) => SliceState;
    getPanelImageIds: (panelId: string) => string[];
  };
};

/** Deterministic shuffle (fixed seed) that is guaranteed not to be the identity. */
function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  let seed = 1234567;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  if (out.every((v, i) => v === items[i])) out.reverse();
  return out;
}

const sliceState = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPanelSliceState('panel_0'));

async function press(page: Page, key: string) {
  await page.keyboard.press(key);
  await page.waitForTimeout(60);
}

/**
 * Import `files` in the given order, then walk the viewport from the first image with
 * ArrowDown and return the file shown at each step. fileManager hands out consecutive
 * `dicomfile:N` ids in import order, so id N is `files[N - lowest id]`.
 */
async function importAndReadOrder(
  page: Page,
  files: string[],
): Promise<{ panelOrder: string[]; displayedOrder: string[]; log: string }> {
  const logs: string[] = [];
  const onConsole = (m: { text(): string }) => {
    if (m.text().includes('[dicomwebLoader] Ordered')) logs.push(m.text());
  };
  page.on('console', onConsole);
  await enterLocalViewer(page);
  await loadLocalDicom(page, files, 'panel_0');
  page.off('console', onConsole);

  const ids = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPanelImageIds('panel_0'));
  expect(ids).toHaveLength(files.length);
  const indexOf = (id: string) => Number(/^dicomfile:(\d+)/.exec(id)?.[1]);
  const base = Math.min(...ids.map(indexOf));
  const fileOf = (id: string) => path.basename(files[indexOf(id) - base]);

  await press(page, 'Home');
  const displayedOrder: string[] = [];
  for (let i = 0; i < files.length; i++) {
    if (i > 0) await press(page, 'ArrowDown');
    await expect.poll(async () => (await sliceState(page)).imageIndex, { message: `step to image ${i + 1}` })
      .toBe(i);
    const { displayedImageId } = await sliceState(page);
    expect(displayedImageId, `an image is displayed at step ${i + 1}`).toBeTruthy();
    displayedOrder.push(fileOf(displayedImageId!));
  }
  return { panelOrder: ids.map(fileOf), displayedOrder, log: logs.join('\n') };
}

test('a shuffled local import is shown in spatial order', async ({ page }) => {
  const files = ensureFixture('ct-axial-300');
  const spatial = files.map((f) => path.basename(f));
  const { panelOrder, displayedOrder, log } = await importAndReadOrder(page, shuffled(files));

  expect(log, 'every image was ordered by geometry').toContain(`geometry=${files.length}`);
  expect(panelOrder, 'the panel stack is in spatial order').toEqual(spatial);
  // Volume viewport: walks top-down, i.e. the spatial order reversed.
  expect(displayedOrder, 'stepping walks the slices in spatial order').toEqual([...spatial].reverse());
});

test('a shuffled 3-plane localizer keeps each plane together, each in spatial order', async ({ page }) => {
  const files = ensureFixture('mr-localizer-3plane');
  const spatial = files.map((f) => path.basename(f));
  const { panelOrder, displayedOrder, log } = await importAndReadOrder(page, shuffled(files));

  expect(log, 'every image was ordered by geometry').toContain(`geometry=${files.length}`);
  expect(panelOrder, 'the panel stack is plane by plane, each in spatial order').toEqual(spatial);
  expect(displayedOrder, 'stepping shows the stack in that order').toEqual(spatial);
});
