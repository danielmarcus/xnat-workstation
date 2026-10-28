/**
 * A Volume Cleanup runs on its own compute worker (the bug review, O8 — #97): before, Fill holes
 * over every slice of a 512² scan ran synchronously on the UI thread — no progress, no Cancel,
 * and the viewer frozen for the whole run.
 *
 * Drives the real affordances: the Sphere tool paints a hollow body through every slice of
 * ct-body-512 (40 × 512²), the Cleanup operation runs Fill holes at Volume scope, the viewport's
 * progress bar and its Cancel, the arrow keys, the member rows, ⏎. The labelmap voxels are the
 * ground truth; the synchronous runner (the E2E hook's previewCleanup) is the oracle for "the
 * same voxels as before". `setComputeThrottle` slows each worker's progress steps so a run can
 * be watched and interrupted.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Locator, Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';
import { clickTool } from '../../helpers/toolbox';
import { openOperation } from '../../helpers/operations';

type Hooks = {
  clearAllContainers: () => void;
  clearSeeds: () => void;
  setComputeThrottle: (ms: number) => void;
  memberVoxelCount: (i: number) => number;
  memberVoxelIndices: (i: number) => number[] | null;
  inPlanePagePoint: (p: string, a: number, b: number) => { x: number; y: number } | null;
  previewCleanup: (opId: string, params: Record<string, number | string>, slices: 'current' | 'volume') => { ok: boolean; reason?: string };
};
type Win = { __XNAT_E2E__: Hooks; __frameGap?: { max: number; last: number; on: boolean } };

const PANEL = 'panel_0';
const VIEWPORT = `[data-testid="unified-viewport-element:${PANEL}"]`;

test.beforeEach(({ page }) => page.evaluate(() => {
  const h = (window as unknown as Win).__XNAT_E2E__;
  h.clearAllContainers();
  h.clearSeeds();
  h.setComputeThrottle(0);
}));
test.afterEach(({ page }) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setComputeThrottle(0)));

const member = (page: Page, i: number) => page.evaluate((idx) => (window as unknown as Win).__XNAT_E2E__.memberVoxelCount(idx), i);
/** A fingerprint of a member's voxels (which ones, not just how many). */
const fingerprint = (page: Page, i: number) => page.evaluate((idx) => {
  const v = (window as unknown as Win).__XNAT_E2E__.memberVoxelIndices(idx) ?? [];
  let h = 0;
  for (const f of v) h = (Math.imul(h, 31) + Math.imul(f, 2654435761)) | 0;
  return `${v.length}:${h}`;
}, i);
const sliceShown = async (page: Page) => (await page.getByTestId(`overlay-field-imageIndex:${PANEL}`).innerText()).split('/')[0].trim();

async function pt(page: Page, dx: number, dy: number) {
  return (await page.evaluate(([x, y]) => (window as unknown as Win).__XNAT_E2E__.inPlanePagePoint('panel_0', x, y), [dx, dy] as const))!;
}

async function drag(page: Page, from: [number, number], to: [number, number], shift = false) {
  const a = await pt(page, ...from), b = await pt(page, ...to);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
}

/** Step the viewport to its middle slice (20 of 40) with the arrow keys. */
async function toMiddleSlice(page: Page) {
  await page.locator(VIEWPORT).hover();
  for (let i = 0; i < 45; i++) {
    const n = Number(await sliceShown(page));
    if (n === 20) return;
    await page.keyboard.press(n < 20 ? 'ArrowDown' : 'ArrowUp');
    await expect.poll(() => sliceShown(page)).not.toBe(String(n));
  }
  throw new Error('could not reach slice 20');
}

/**
 * Segment 1: a hollow body — a 165 mm sphere with a 115 mm one erased from it (⇧), both centred
 * on the middle slice, so every one of the 40 slices holds a ring with a hole ~100 mm across.
 * Segment 2 exists (empty); segment 1 is active.
 */
async function hollowBody(page: Page): Promise<{ panel: Locator; toolbox: Locator }> {
  await loadFixture(page, 'ct-body-512', PANEL);
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await expect(toolbox.getByRole('button', { name: 'Brush', exact: true })).toBeVisible({ timeout: 10_000 });
  await toMiddleSlice(page);
  await clickTool(toolbox, 'Sphere');
  await drag(page, [0, 0], [165, 0]);
  await expect.poll(() => member(page, 1), { timeout: 30_000 }).toBeGreaterThan(1_000_000);
  const solid = await member(page, 1);
  await drag(page, [0, 0], [115, 0], true);
  await expect.poll(() => member(page, 1), { timeout: 30_000 }).toBeLessThan(solid);
  await panel.getByRole('button', { name: 'Add member' }).first().click();
  await page.keyboard.press('Escape');
  await panel.locator('[data-testid^="member-row-"]').first().click();
  return { panel, toolbox };
}

async function volumeFillHoles(panel: Locator): Promise<Locator> {
  const sheet = await openOperation(panel, 'Cleanup', 'Fill holes');
  await sheet.getByRole('group', { name: 'Slices' }).getByRole('button', { name: 'Volume' }).click();
  return sheet;
}

/** Record the longest gap between animation frames from now until `stopFrames`. */
const startFrames = (page: Page) => page.evaluate(() => {
  const w = window as unknown as Win;
  const g = (w.__frameGap = { max: 0, last: performance.now(), on: true });
  const tick = (t: number) => {
    g.max = Math.max(g.max, t - g.last);
    g.last = t;
    if (g.on) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
const stopFrames = (page: Page) => page.evaluate(() => {
  const g = (window as unknown as Win).__frameGap!;
  g.on = false;
  return Math.round(g.max);
});

/**
 * The longest frame gap a run may cause. The synchronous run froze the viewer for its whole
 * length — 3.2 s on this mask, measured; gathering and staging on the UI thread now hand it back
 * every few milliseconds: 0.4–0.5 s, most of it the software renderer drawing a slice (idle
 * gaps of ~0.2 s are normal under xvfb + swiftshader on a loaded machine).
 */
const MAX_FRAME_GAP_MS = 1000;

test('Volume Fill holes runs on the worker: a progress bar, the viewer stays live, and ⏎ commits the same voxels as the synchronous run', async ({ page }) => {
  test.setTimeout(240_000);
  const { panel } = await hollowBody(page);
  const before = await fingerprint(page, 1);
  const count = await member(page, 1);
  const sheet = await volumeFillHoles(panel);
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setComputeThrottle(60));

  await startFrames(page);
  await sheet.getByRole('button', { name: 'Preview', exact: true }).click();
  const bar = page.getByTestId('compute-progress-bar');
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('Fill holes');
  await expect(sheet.getByRole('button', { name: 'Cancel run' })).toBeVisible();
  // The viewer answers while the run computes: the slice can be scrolled.
  const shown = await sliceShown(page);
  await page.locator(VIEWPORT).hover();
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => sliceShown(page)).not.toBe(shown);
  await expect(bar, 'still running when the slice moved').toBeVisible();
  await expect.poll(() => bar.getByRole('progressbar').getAttribute('aria-valuenow'), { timeout: 30_000 }).not.toBe('0');

  await expect(page.getByTestId('mask-preview-bar')).toContainText('Fill holes', { timeout: 60_000 });
  const gap = await stopFrames(page);
  console.log(`[O8] longest frame gap from Preview to the preview: ${gap} ms`);
  await expect(bar).toHaveCount(0);
  expect(await fingerprint(page, 1), 'previewed, not written').toBe(before);
  expect(gap, `longest frame gap during the run: ${gap} ms`).toBeLessThan(MAX_FRAME_GAP_MS);

  await page.keyboard.press('Enter');
  await expect.poll(() => member(page, 1)).toBeGreaterThan(count);
  const viaWorker = await fingerprint(page, 1);

  // The oracle: the synchronous runner on the same mask.
  await page.keyboard.press('Control+z');
  await expect.poll(() => fingerprint(page, 1)).toBe(before);
  const r = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.previewCleanup('fillHoles', { maxHoleAreaMm2: 0 }, 'volume'));
  expect(r.ok).toBe(true);
  await page.keyboard.press('Enter');
  await expect.poll(() => member(page, 1)).toBeGreaterThan(count);
  expect(await fingerprint(page, 1)).toBe(viaWorker);
});

test('Cancel stops the run: no preview, no voxel changed', async ({ page }) => {
  test.setTimeout(180_000);
  const { panel } = await hollowBody(page);
  const before = await fingerprint(page, 1);
  const sheet = await volumeFillHoles(panel);
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setComputeThrottle(60));
  await sheet.getByRole('button', { name: 'Preview', exact: true }).click();
  const bar = page.getByTestId('compute-progress-bar');
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: /Cancel/ }).click();
  await expect(bar).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Preview', exact: true })).toBeVisible();
  await page.waitForTimeout(4000); // longer than the run would have taken
  await expect(page.getByTestId('mask-preview-bar')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  expect(await fingerprint(page, 1)).toBe(before);
  await expect(sheet.getByTestId('sheet-message'), 'a cancel is silent').toHaveText('');
});

test('activating another segment during a run drops its result: no preview, nothing committed', async ({ page }) => {
  test.setTimeout(180_000);
  const { panel } = await hollowBody(page);
  const before = await fingerprint(page, 1);
  const sheet = await volumeFillHoles(panel);
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setComputeThrottle(60));
  await sheet.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByTestId('compute-progress-bar')).toBeVisible();
  await panel.locator('[data-testid^="member-row-"]').nth(1).click();
  await expect(page.getByTestId('compute-progress-bar')).toHaveCount(0);
  await page.waitForTimeout(4000);
  await expect(page.getByTestId('mask-preview-bar')).toHaveCount(0);
  await page.locator(VIEWPORT).hover();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  expect(await fingerprint(page, 1)).toBe(before);
  expect(await member(page, 2)).toBe(0);
});

test('editing the segment during a run drops its result and says so', async ({ page }) => {
  test.setTimeout(180_000);
  const { panel, toolbox } = await hollowBody(page);
  const sheet = await volumeFillHoles(panel);
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setComputeThrottle(60));
  await sheet.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByTestId('compute-progress-bar')).toBeVisible();
  // A brush stroke in the hole, while the run computes.
  await clickTool(toolbox, 'Brush');
  await drag(page, [-10, 0], [10, 0]);
  await expect(page.getByTestId('compute-progress-bar')).toHaveCount(0);
  await expect(sheet).toContainText('Preview discarded: the segment changed');
  const edited = await fingerprint(page, 1);
  await page.waitForTimeout(4000);
  await expect(page.getByTestId('mask-preview-bar')).toHaveCount(0);
  await page.locator(VIEWPORT).hover();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  expect(await fingerprint(page, 1), 'only the stroke was written').toBe(edited);
});

test('a solve and a Volume Cleanup run at once on their own workers — both complete', async ({ page }) => {
  test.setTimeout(240_000);
  const { panel } = await hollowBody(page);
  const count = await member(page, 1);
  // Seeded segmentation of the lesion at the centre (inside the hole): seeds of segment 1 and a ⇧ Background ring.
  const seeded = await openOperation(panel, 'Seeded segmentation');
  await seeded.getByLabel('Seed brush', { exact: true }).fill('2');
  await seeded.getByRole('button', { name: 'Paint seeds' }).click();
  await drag(page, [-3, 0], [3, 0]);
  const ring = Array.from({ length: 17 }, (_, k) => [25 * Math.cos((2 * Math.PI * k) / 16), 25 * Math.sin((2 * Math.PI * k) / 16)] as [number, number]);
  await page.keyboard.down('Shift');
  const p0 = await pt(page, ...ring[0]);
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  for (const q of ring.slice(1)) { const p = await pt(page, ...q); await page.mouse.move(p.x, p.y, { steps: 4 }); }
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(seeded.getByTestId('seed-count-0')).toHaveText('1');

  // Record every preview the viewport shows from here on.
  await page.evaluate(() => {
    const seen: string[] = ((window as unknown as { __previews: string[] }).__previews = []);
    new MutationObserver(() => {
      const t = document.querySelector('[data-testid="mask-preview-bar"]')?.textContent ?? '';
      if (t && seen[seen.length - 1] !== t) seen.push(t);
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setComputeThrottle(40));
  await seeded.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByTestId('compute-progress-bar')).toContainText('Fast GrowCut');
  const sheet = await volumeFillHoles(panel);
  await sheet.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByTestId('compute-progress-bar')).toContainText('Fill holes');
  // Both arrive: neither worker job cancelled the other.
  await expect.poll(() => page.evaluate(() => (window as unknown as { __previews: string[] }).__previews.join(' | ')), { timeout: 90_000 })
    .toMatch(/Fast GrowCut[\s\S]*Fill holes|Fill holes[\s\S]*Fast GrowCut/);
  await expect(page.getByTestId('compute-progress-bar')).toHaveCount(0);
  await page.locator(VIEWPORT).hover();
  await page.keyboard.press('Enter');
  await expect.poll(() => member(page, 1)).toBeGreaterThan(count);
});
