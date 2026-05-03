/**
 * Signal G7 (acceptance): "Undo after a brush stroke made on a panel that
 * has since been closed — the stroke is undone correctly."
 *
 * This is regression insurance ahead of MV-Phase 2's undo rework. Phase 2.7
 * will replace scattered DefaultHistoryMemo direct calls in
 * segmentationService.ts with a per-container undoService backed by a
 * container bridge (PHASES.md MV-Phase 2 Workstream B). When that lands,
 * this spec must continue to pass — if it doesn't, the refactor broke the
 * cross-viewport-identity guarantee from §A8.
 *
 * Setup: 1x2 layout, the same multi-slice CT loaded into panel_0 and
 * panel_1, segmentation created and activated on panel_1, brush tool
 * active. Paint a real brush stroke on panel_1 (real pointer events, real
 * Cornerstone BrushTool flow → real DefaultHistoryMemo push). Close
 * panel_1 by shrinking the layout (the user-equivalent teardown — same
 * setLayout transition the toolbar dropdown drives). Press Ctrl-Z. Assert
 * the memo flipped from undo→redo.
 *
 * Two variants:
 *   - flag-off: legacy stack-mode rendering path (multiViewport.enabled
 *     false). Pinned today.
 *   - flag-on:  new volume-mode path (multiViewport.enabled true). Also
 *     pinned today; if Phase 1's VolumeViewport unmount path leaks the
 *     memo or breaks brush attachment, this variant fails loudly.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page, Locator } from '@playwright/test';
import { CanvasInteractor } from '../helpers/canvas-interaction';
import { loadFixtureScan, FIXTURE_NAMES } from '../helpers/fixture-load';

type UndoStackInfo = {
  canUndo: boolean;
  canRedo: boolean;
  topEntryDescription: string | null;
};

function panelCanvas(page: Page, panelId: string): Locator {
  // Stack mode (StackViewport) and volume mode (VolumeViewport) use
  // different testid prefixes. Match either so the spec doesn't have to
  // know which path the flag selected for this panel.
  return page.locator(
    `[data-testid="stack-viewport-canvas:${panelId}"] canvas, `
    + `[data-testid="volume-viewport-canvas:${panelId}"] canvas`,
  );
}

function panelRoot(page: Page, panelId: string): Locator {
  return page.locator(
    `[data-testid="stack-viewport:${panelId}"], `
    + `[data-testid="volume-viewport:${panelId}"]`,
  );
}

async function getUndoStackInfo(page: Page): Promise<UndoStackInfo> {
  return page.evaluate(() => (window as any).__XNAT_E2E__?.getUndoStackInfo?.() ?? {
    canUndo: false,
    canRedo: false,
    topEntryDescription: null,
  });
}

async function selectLayout(page: Page, layoutLabel: '1 x 2' | '2 x 2' | '1 x 1') {
  const layoutBtn = page.locator('button[title^="Viewport layout"]');
  await layoutBtn.click();
  await page.locator('button', { hasText: layoutLabel }).click();
  await page.waitForTimeout(300);
}

async function activatePanel(page: Page, panelId: string) {
  await page.locator(`[data-panel-id="${panelId}"]`).click();
  await page.waitForTimeout(200);
}

async function loadScanIntoPanel(page: Page, panelId: string, multiViewportEnabled: boolean): Promise<boolean> {
  const result = await loadFixtureScan(page, FIXTURE_NAMES.CT_AXIAL_300, {
    panelId,
    multiViewportEnabled,
  });
  return result !== null;
}

async function waitForCanvasReady(page: Page, panelId: string) {
  await expect(panelCanvas(page, panelId)).toBeVisible({ timeout: 30_000 });
  // Wait for any "loading" status indicator to clear
  const status = page.locator(`[data-testid="stack-viewport-status:${panelId}"]`);
  if (await status.isVisible({ timeout: 500 }).catch(() => false)) {
    await status.waitFor({ state: 'hidden', timeout: 30_000 });
  }
}

async function openSegmentationPanel(page: Page) {
  const panel = page.locator('[data-testid="segmentation-panel"]');
  if (await panel.isVisible().catch(() => false)) return;

  const annotationToolsTrigger = page.locator('button[title="Annotation tools"]');
  if (await annotationToolsTrigger.isVisible().catch(() => false)) {
    await annotationToolsTrigger.click();
  }

  const segmentationToggle = page.locator(
    'button[title="Show segmentation panel"], button[title="Hide segmentation panel"]',
  ).first();
  await segmentationToggle.waitFor({ state: 'visible', timeout: 10_000 });
  await segmentationToggle.click();
  await panel.waitFor({ state: 'visible', timeout: 10_000 });
}

async function setupTwoPanelsWithScan(page: Page, multiViewportEnabled: boolean) {
  // Initial scan loads into panel_0.
  const ok0 = await loadScanIntoPanel(page, 'panel_0', multiViewportEnabled);
  expect(ok0, 'fixture must be present locally').toBe(true);
  await waitForCanvasReady(page, 'panel_0');

  // Switch to 1x2 — adds an empty panel_1.
  await selectLayout(page, '1 x 2');

  // Make panel_1 active so the next scan-load targets it.
  await activatePanel(page, 'panel_1');

  // Load same fixture into panel_1.
  const ok1 = await loadScanIntoPanel(page, 'panel_1', multiViewportEnabled);
  expect(ok1, 'fixture must be present locally').toBe(true);
  await waitForCanvasReady(page, 'panel_1');
}

async function runG7AcceptanceFlow(page: Page) {
  // Opens the seg panel and creates + activates a segmentation registered
  // to panel_1, then activates the brush, paints a stroke on panel_1's
  // canvas, closes panel_1, and asserts the memo survived and was undone.
  await openSegmentationPanel(page);

  // Make panel_1 the active viewport so brush + segmentation tooling
  // wire to it.
  await activatePanel(page, 'panel_1');

  // Create a SEG (labelmap) annotation via the real "Add segmentation"
  // dialog — the brush tool only operates on SEGs, and the dialog flow
  // sets dicomTypeBySegmentationId + auto-expands the row, both of
  // which the SegmentationPanel needs to render the Brush button.
  // (createTestStructure makes RTSTRUCT, which exposes contour tools but
  // not Brush, so it's not a fit for this test.)
  const segPanel = page.locator('[data-testid="segmentation-panel"]');
  const segLabel = 'G7 Stroke Target';
  await page.locator('[data-testid="add-segmentation-btn"]').click();
  const nameInput = segPanel.locator('input.bg-zinc-800');
  await expect(nameInput).toBeVisible({ timeout: 5_000 });
  await nameInput.fill(segLabel);
  await page.locator('button', { hasText: 'Create' }).click();
  await expect(nameInput).toBeHidden({ timeout: 5_000 });

  // Capture the created segmentationId so we can match the memo's
  // segmentationId field in topEntryDescription later.
  const segmentationId = await page.evaluate((label: string) => {
    return (window as any).__XNAT_E2E__?.getSegmentationIdByLabel?.(label) ?? null;
  }, segLabel);
  expect(segmentationId, 'a segmentation with the test label should exist').toBeTruthy();

  // Force-attach the segmentation's labelmap rep to panel_1. The dialog
  // flow's useEffect normally does this when activeSegId changes, but
  // race conditions in test conditions can leave the volume viewport
  // without the rep attached (which would silently make brush a no-op).
  // activateSegmentation is idempotent and matches the user's row-click.
  await page.evaluate((segId: string) => {
    (window as any).__XNAT_E2E__?.activateSegmentation?.('panel_1', segId, 1);
  }, segmentationId);
  await page.waitForTimeout(500);

  // When previous specs in the full suite have left other SEGs in the
  // store, segPanel.locator('button[hasText=Brush]').first() can hit a
  // Brush button on an older expanded row, which would route the brush
  // stroke to the wrong segmentation (and silently produce no memo for
  // OUR seg). Click the G7 row first so it becomes the active +
  // expanded one, then take its Brush button.
  const segRow = segPanel.locator('div.cursor-pointer', { hasText: segLabel }).first();
  await expect(segRow).toBeVisible({ timeout: 10_000 });
  await segRow.click();
  await page.waitForTimeout(300);

  const brushBtn = segPanel.locator('button', { hasText: 'Brush' }).first();
  await expect(brushBtn).toBeVisible({ timeout: 10_000 });
  await expect(brushBtn).toBeEnabled({ timeout: 10_000 });
  await brushBtn.click();
  await page.waitForTimeout(300);

  // Snapshot undo state before the stroke.
  const beforeStroke = await getUndoStackInfo(page);

  // Paint a real stroke on panel_1's canvas. paintStroke holds mouse
  // down through the points and releases — this fires Cornerstone's
  // BrushTool mouse-down → mouse-move → mouse-up flow, which calls
  // BaseTool.doneEditMemo() and pushes a memo onto DefaultHistoryMemo.
  const canvas = panelCanvas(page, 'panel_1');
  const interactor = new CanvasInteractor(page, canvas);
  await interactor.paintStroke([
    { x: 0.40, y: 0.40 },
    { x: 0.45, y: 0.42 },
    { x: 0.50, y: 0.45 },
    { x: 0.55, y: 0.47 },
    { x: 0.60, y: 0.50 },
  ]);
  await page.waitForTimeout(500);

  // Snapshot undo state after the stroke. canUndo should now be true,
  // and the top entry should differ from whatever was there before.
  const afterStroke = await getUndoStackInfo(page);
  expect(afterStroke.canUndo, 'canUndo should be true after a brush stroke').toBe(true);
  expect(
    afterStroke.canUndo && !beforeStroke.canUndo
      ? true
      : afterStroke.topEntryDescription !== beforeStroke.topEntryDescription,
    'a new top history entry should appear after the brush stroke',
  ).toBe(true);
  // The brush tool pushes a `labelmap` memo via Cornerstone's BrushTool
  // → BaseTool.doneEditMemo path. The historyMemo enrichment fills in
  // the sub-segmentationId for multi-layer-group SEGs, so the top entry
  // looks like "labelmap:seg_dicom_<...>_layer_1" rather than the parent
  // segmentationId we got from getSegmentationIdByLabel — that's why we
  // don't match on the parent id here. The "labelmap:" prefix is the
  // structural signal that proves it's a real brush memo and not, say,
  // an annotation memo.
  expect(
    afterStroke.topEntryDescription,
    `top entry should be a labelmap memo from the brush stroke (got: ${afterStroke.topEntryDescription})`,
  ).toMatch(/^labelmap[:|]/i);

  // Close panel_1 — shrinks layout to 1x1 via the same setLayout
  // transition the toolbar drives.
  const closeOk = await page.evaluate(() => {
    return (window as any).__XNAT_E2E__?.closePanel?.('panel_1') ?? false;
  });
  expect(closeOk, 'closePanel should return true').toBe(true);

  // panel_1 should be unmounted; panel_0 should still be present.
  await expect(panelRoot(page, 'panel_1')).toHaveCount(0, { timeout: 10_000 });
  await expect(panelCanvas(page, 'panel_0')).toBeVisible();

  // The history memo lives on the DefaultHistoryMemo singleton, not on
  // the closed viewport. canUndo must still be true; the brush memo must
  // still be on top.
  const afterClose = await getUndoStackInfo(page);
  expect(afterClose.canUndo, 'memo must survive panel close (A8 cross-viewport identity)').toBe(true);
  expect(
    afterClose.topEntryDescription,
    'top history entry should be unchanged across the close',
  ).toBe(afterStroke.topEntryDescription);

  // Undo. Real keyboard event — same path the user takes.
  await page.keyboard.press('Control+Z');
  await page.waitForTimeout(300);

  // After undo, canRedo should be true (the stroke moved to redo) and
  // the undo top should differ from the post-stroke entry.
  await expect.poll(async () => (await getUndoStackInfo(page)).canRedo, { timeout: 10_000 }).toBe(true);
  const afterUndo = await getUndoStackInfo(page);
  expect(
    afterUndo.topEntryDescription,
    'after undo, the brush memo should no longer be on top of the undo stack',
  ).not.toBe(afterStroke.topEntryDescription);
}

test.describe('Signal G7 — undo after closed-panel brush stroke (local fixture)', () => {
  test.beforeEach(async ({ page }) => {
    // Hard-reset renderer state. This spec is sensitive to leftover
    // segmentations / labelmap reps / tool-group bindings that earlier
    // specs in the worker leave behind. Reloading wipes the segmentation
    // store, the volume cache, and all in-memory undo state.
    await page.reload({ waitUntil: 'domcontentloaded' });
    // Wait for the renderer hooks to install before any other interaction.
    await page.waitForFunction(() => !!window.__XNAT_E2E__, undefined, { timeout: 30_000 });

    // Default flag = off; flag-on test re-sets it before fixture load.
    await page.evaluate(() => {
      window.__XNAT_E2E__?.setMultiViewportEnabled(false);
    });
  });

  test.afterEach(async ({ page }) => {
    // Restore single-panel layout + flag-off so subsequent specs aren't
    // affected by Electron worker reuse. Also explicitly clear unsaved
    // state — the test paints a SEG but never saves; without the clean
    // a follow-up `page.reload()` (in the next beforeEach) trips the
    // `beforeunload` unsaved-changes dialog and the next test fails
    // with "No dialog is showing" before it can assert anything.
    await page.evaluate(() => {
      window.__XNAT_E2E__?.closePanel('panel_1');
      window.__XNAT_E2E__?.markAllSegmentationsClean?.();
      window.__XNAT_E2E__?.setMultiViewportEnabled(false);
    });
  });

  // The original "synthetic CT path doesn't render the row" diagnosis
  // was misattributed to a Cornerstone multi-layer-group gap. The actual
  // root cause was that `loadLocalDicomFiles` set panelScanMap but not
  // panelXnatContextMap, so SegmentationPanel's `visibleSegmentationIds`
  // filter (keyed on `${projectId}/${sessionId}/${scanId}`) excluded the
  // freshly-created seg. Fixed 2026-05-03 by synthesising a fixture XNAT
  // context in the e2e fixture bridge.
  test('flag-off (legacy stack mode): brush memo survives panel close and undoes', async ({ page }) => {
    await setupTwoPanelsWithScan(page, false);
    await runG7AcceptanceFlow(page);
  });

  // Flag-on (volume-mode) variant: deliberately deferred. In volume mode,
  // SegmentationManager.createNewSegmentation produces a stack-labelmap
  // representation which doesn't render writable pixel data on a
  // VolumeViewport, so a real brush stroke fires its mouse events but
  // BaseTool.doneEditMemo() never pushes a memo onto DefaultHistoryMemo.
  // This is a Phase 1 capability gap, not a regression of the G7 contract.
  // When Phase 2 wires volume-labelmap representations (design §7.4 —
  // Workstream B's container bridge + undoService), promote this back to
  // a real test.
  test('flag-on (volume mode): brush memo survives panel close and undoes', async ({ page }) => {
    // Phase 2 wired the container bridge + volume-labelmap representation
    // path (`addSubSegToViewport` calls `convertStackToVolumeLabelmap` for
    // viewports that expose `getAllVolumeIds`). Promoted from `test.fixme`
    // 2026-05-03 to verify whether the original Phase 1 capability gap
    // still applies. If it does, this test surfaces it as a real failure
    // rather than a silent fixme — consistent with the rest of the audit.
    await page.evaluate(() => {
      window.__XNAT_E2E__?.setMultiViewportEnabled(true);
    });
    await setupTwoPanelsWithScan(page, true);
    await runG7AcceptanceFlow(page);
  });
});
