/**
 * The same scan in two viewports is ONE annotation set.
 *
 * Whatever the panel scoping does, a container must behave identically in every viewport
 * showing its own series: listed, rendered, and editable in all of them. Otherwise the
 * user is invited to create a second container for the same scan simply because the first
 * one is not visible from where they are looking — annotations that depend on the
 * viewport, which is never correct.
 *
 * This case was missed: `panel-viewport-scoping` uses cross-for-ct-mr and
 * `panel-multiviewport-indicators` uses mr-t1-t2-sameexam, both DIFFERENT series per
 * viewport. Neither can observe a same-scan divergence.
 */
import { test, expect } from '../../fixtures/electron-app';
import { loadSameSeriesTwice, enterLocalViewer, ensureFixture } from '../../helpers/local-fixture';

type Win = { __XNAT_E2E__: {
  setActiveUnifiedTool: (t: string) => void;
  setUnifiedBrushSize: (n: number) => void;
  getPaintedVoxelCount: () => number;
  resetUnifiedSegmentations: () => void;
}; };

type LayoutWin = { __XNAT_E2E__: { setLayoutPreset: (p: string) => void } };
type ContourWin = { __XNAT_E2E__: { getActiveContourSnapshot: (p?: string, s?: string) => { total: number } } };

const focus = (page: import('@playwright/test').Page, vp: string) =>
  page.locator(`[data-testid="unified-viewport:${vp}"]`).click({ position: { x: 20, y: 20 } });

async function strokeAcross(page: import('@playwright/test').Page, viewportId: string, yFrac = 0.5) {
  const box = (await page.locator(`[data-testid="unified-viewport-element:${viewportId}"] canvas`).boundingBox())!;
  const y = box.y + box.height * yFrac;
  await page.mouse.move(box.x + box.width * 0.4, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(900);
}

test('a container on a scan shown in two viewports is listed from either one', async ({ page }) => {
  await loadSameSeriesTwice(page, 'ct-axial-300', 'slice');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());

  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });

  await focus(page, 'panel_0');
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await panel.getByLabel('Rename container').press('Enter');
  await panel.getByLabel('Rename member').press('Enter');

  const rowId = (await panel.locator('[data-testid^="container-row-"]').first().getAttribute('data-testid'))!;
  const row = panel.locator(`[data-testid="${rowId}"]`);
  await expect(row).toBeVisible();

  // Paint, so the container is fully realised (a multi-layer group has no per-segment
  // labelmap until something is drawn) — the state a real user is in.
  await page.evaluate(() => {
    const h = (window as unknown as Win).__XNAT_E2E__;
    h.setUnifiedBrushSize(40);
    h.setActiveUnifiedTool('Brush');
  });
  await strokeAcross(page, 'panel_0');
  expect(await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelCount())).toBeGreaterThan(0);

  // The other viewport shows THE SAME SCAN. The container must be listed there too.
  await focus(page, 'panel_1');
  await expect(
    row,
    'a container must be listed from every viewport showing its own scan — otherwise the user is invited to create a duplicate',
  ).toBeVisible({ timeout: 10_000 });

  // ...and back again, unchanged.
  await focus(page, 'panel_0');
  await expect(row).toBeVisible();
});

test('the same scan in two viewports is one editable container, not one per viewport', async ({ page }) => {
  await loadSameSeriesTwice(page, 'ct-axial-300', 'slice');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());

  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });

  await focus(page, 'panel_0');
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await panel.getByLabel('Rename container').press('Enter');
  await panel.getByLabel('Rename member').press('Enter');
  await page.evaluate(() => {
    const h = (window as unknown as Win).__XNAT_E2E__;
    h.setUnifiedBrushSize(40);
    h.setActiveUnifiedTool('Brush');
  });
  await strokeAcross(page, 'panel_0', 0.45);
  const afterFirst = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelCount());
  expect(afterFirst).toBeGreaterThan(0);

  // Draw from the OTHER viewport on the same scan. It must add to the SAME container —
  // the viewport you happen to be looking through is not part of an annotation's identity.
  await focus(page, 'panel_1');
  await strokeAcross(page, 'panel_1', 0.55);
  expect(
    await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelCount()),
    'drawing from the second viewport on the same scan must edit the same container',
  ).toBeGreaterThan(afterFirst);

  // Exactly ONE container exists — no per-viewport duplicate was created.
  expect(await panel.locator('[data-testid^="container-row-"]').count()).toBe(1);
});

/**
 * MPR: three orientations of ONE volume. The user's words — "the same annotations should
 * appear regardless of which viewport is in focus, regardless of orientation".
 *
 * This is the case where scoping by attachment is most obviously wrong: the three planes
 * are literally the same data, so a container that is listed in axial and missing in
 * coronal is self-evidently a bug rather than a design choice.
 */
test('an annotation appears in every MPR orientation of the same volume', async ({ page }) => {
  await enterLocalViewer(page);
  await page.locator('[data-testid="local-import-input"]').setInputFiles([]);
  await page.locator('[data-testid="local-import-input"]').setInputFiles(ensureFixture('ct-axial-300'));
  await expect(page.locator('[data-testid="unified-viewport-element:panel_0"] canvas')).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());

  await page.evaluate(() => (window as unknown as LayoutWin).__XNAT_E2E__.setLayoutPreset('mpr-2x2'));
  for (const pid of ['panel_0', 'panel_1', 'panel_2']) {
    await expect(page.locator(`[data-testid="unified-viewport-element:${pid}"] canvas`)).toBeVisible({ timeout: 30_000 });
  }

  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });

  await focus(page, 'panel_0');
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await panel.getByLabel('Rename container').press('Enter');
  await panel.getByLabel('Rename member').press('Enter');
  const rowId = (await panel.locator('[data-testid^="container-row-"]').first().getAttribute('data-testid'))!;
  const row = panel.locator(`[data-testid="${rowId}"]`);

  await page.evaluate(() => {
    const h = (window as unknown as Win).__XNAT_E2E__;
    h.setUnifiedBrushSize(40);
    h.setActiveUnifiedTool('Brush');
  });
  await strokeAcross(page, 'panel_0');
  expect(await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelCount())).toBeGreaterThan(0);

  for (const pid of ['panel_1', 'panel_2', 'panel_0']) {
    await focus(page, pid);
    await expect(row, `the annotation must be listed with ${pid} focused — it is the same volume`).toBeVisible({
      timeout: 10_000,
    });
    expect(
      await panel.locator('[data-testid^="container-row-"]').count(),
      `${pid} must show the same single container, not a per-orientation copy`,
    ).toBe(1);
  }
});

/**
 * The reverse order: the annotation exists first, then the same scan is opened in a second
 * viewport. Attachment happens at create time, so nothing runs for a viewport that appears
 * afterwards — the container has to be listed on identity alone.
 */
test('opening the same scan in a second viewport shows the annotation already made', async ({ page }) => {
  await enterLocalViewer(page);
  const files = ensureFixture('ct-axial-300');
  await page.locator('[data-testid="local-import-input"]').setInputFiles([]);
  await page.locator('[data-testid="local-import-input"]').setInputFiles(files);
  await expect(page.locator('[data-testid="unified-viewport-element:panel_0"] canvas')).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());

  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });

  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await panel.getByLabel('Rename container').press('Enter');
  await panel.getByLabel('Rename member').press('Enter');
  const rowId = (await panel.locator('[data-testid^="container-row-"]').first().getAttribute('data-testid'))!;
  const row = panel.locator(`[data-testid="${rowId}"]`);
  await page.evaluate(() => {
    const h = (window as unknown as Win).__XNAT_E2E__;
    h.setUnifiedBrushSize(40);
    h.setActiveUnifiedTool('Brush');
  });
  await strokeAcross(page, 'panel_0');

  // NOW open a second viewport on the same series.
  await page.locator('[title^="Viewport layout"]').click();
  await page.getByRole('button', { name: '1 x 2' }).click();
  await page.locator('[data-testid="unified-viewport:panel_1"]').waitFor({ state: 'attached', timeout: 20_000 });
  await focus(page, 'panel_1');
  await page.locator('[data-testid="local-import-input"]').setInputFiles([]);
  await page.locator('[data-testid="local-import-input"]').setInputFiles(files);
  await expect(page.locator('[data-testid="unified-viewport-element:panel_1"] canvas')).toBeVisible({ timeout: 30_000 });

  await focus(page, 'panel_1');
  await expect(row, 'a viewport opened on a scan must show the annotations that scan already has').toBeVisible({
    timeout: 15_000,
  });
  expect(await panel.locator('[data-testid^="container-row-"]').count()).toBe(1);
});

/**
 * The same question for the other two container kinds. They take different code paths —
 * a Structure is a contour segmentation and a Measurement is not a segmentation at all —
 * so neither is covered by the SEG cases above.
 */
for (const kind of [
  { button: 'New Structure (RTSTRUCT)', tool: 'FreehandContourSegmentation', label: 'Structure' },
  { button: 'New Measurement (SR)', tool: 'Length', label: 'Measurement' },
]) {
  test(`a ${kind.label} on a scan in two viewports is listed from either one`, async ({ page }) => {
    await loadSameSeriesTwice(page, 'ct-axial-300', 'slice');
    await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());

    const panel = page.locator('[data-testid="annotations-side-panel"]');
    if (!(await panel.isVisible())) {
      await page.getByRole('button', { name: 'Show segmentation panel' }).click();
    }
    await expect(panel).toBeVisible({ timeout: 15_000 });

    await focus(page, 'panel_0');
    await panel.getByRole('button', { name: kind.button }).click();
    await panel.getByLabel('Rename container').press('Enter');
    const memberRename = panel.getByLabel('Rename member');
    if (await memberRename.count()) await memberRename.press('Enter');

    const rowId = (await panel.locator('[data-testid^="container-row-"]').first().getAttribute('data-testid'))!;
    const row = panel.locator(`[data-testid="${rowId}"]`);
    await expect(row).toBeVisible();

    await focus(page, 'panel_1');
    await expect(
      row,
      `a ${kind.label} must be listed from every viewport showing its own scan`,
    ).toBeVisible({ timeout: 10_000 });
    expect(await panel.locator('[data-testid^="container-row-"]').count()).toBe(1);
  });
}

/**
 * Structures take a different attach path from SEGs — `createNewStructure` calls
 * `ensureContourRepresentation` for the creating viewport only, and never went through
 * `attachSegmentationToPanelsForSource` at all. So a contour drawn from the second
 * viewport is the RTSTRUCT variant of the same bug, and needs its own assertion rather
 * than an inference from the SEG case.
 */
test('a contour drawn from the second viewport joins the same Structure', async ({ page }) => {
  await loadSameSeriesTwice(page, 'ct-axial-300', 'slice');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());

  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });

  await focus(page, 'panel_0');
  await panel.getByRole('button', { name: 'New Structure (RTSTRUCT)' }).click();
  await panel.getByLabel('Rename container').press('Enter');
  const memberRename = panel.getByLabel('Rename member');
  if (await memberRename.count()) await memberRename.press('Enter');

  const drawLoopOn = async (viewportId: string, scale: number) => {
    const box = (await page.locator(`[data-testid="unified-viewport-element:${viewportId}"] canvas`).boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const r = Math.min(box.width, box.height) * scale;
    await page.mouse.move(cx + r, cy);
    await page.mouse.down();
    for (let i = 1; i <= 24; i++) {
      const a = (i / 24) * 2 * Math.PI;
      await page.mouse.move(cx + r * Math.cos(a), cy + r * Math.sin(a), { steps: 2 });
    }
    await page.mouse.move(cx + r, cy, { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(700);
  };

  const contourTotal = () =>
    page.evaluate(() => (window as unknown as ContourWin).__XNAT_E2E__.getActiveContourSnapshot().total);

  await drawLoopOn('panel_0', 0.3);
  const afterFirst = await contourTotal();
  expect(afterFirst, 'the first contour must land').toBeGreaterThan(0);

  // Same scan, other viewport. The contour must JOIN the container already there — both
  // halves matter: a second container must not appear, and the stroke must not be a no-op
  // (asserting only the container count would pass if drawing there did nothing at all).
  await focus(page, 'panel_1');
  await drawLoopOn('panel_1', 0.22);
  expect(
    await contourTotal(),
    'a contour drawn from the second viewport must be added to the existing Structure',
  ).toBeGreaterThan(afterFirst);
  await expect(
    panel.locator('[data-testid^="container-row-"]'),
    'drawing from the second viewport must not create a second Structure for the same scan',
  ).toHaveCount(1);
});
