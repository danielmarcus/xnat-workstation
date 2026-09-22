/**
 * Annotations panel width (spec §4.1) — resizable, and the three label states.
 *
 * Ported from MV-Phase 7.3c (`9dc2fba`), which was built on the abandoned
 * `multiviewport-annotation` branch and never reached main: the rebuild restarted on a
 * new panel that hardcoded `w-72` (288px) with no handle, and `ContextToolbox.compact`
 * was declared but never passed. The result was nine permanently-clipped tool labels
 * and no way to widen the panel.
 *
 * The contract, at three widths:
 *   default (400) — every label fits, nothing clipped
 *   narrow  (300) — labels ellipsize rather than wrap or overflow
 *   compact (<210) — the toolbox drops labels entirely and shows icons only
 *
 * Drives the REAL drag handle; no store shortcut.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

/** Leaf elements whose text is clipped by their own box, measured sub-pixel.
 *  scrollWidth/clientWidth are integer-rounded and miss sub-pixel clipping. */
const clippedTexts = (page: Page) =>
  page.evaluate(() => {
    const root = document.querySelector('[data-testid="context-toolbox"]');
    if (!root) return [];
    const out: string[] = [];
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
      if (el.children.length) continue;
      const text = (el.textContent ?? '').trim();
      if (!text) continue;
      const box = el.getBoundingClientRect().width;
      const prev = el.getAttribute('style') ?? '';
      el.style.width = 'auto'; el.style.maxWidth = 'none';
      el.style.overflow = 'visible'; el.style.whiteSpace = 'nowrap';
      const needed = el.getBoundingClientRect().width;
      el.setAttribute('style', prev);
      if (needed > box + 0.5) out.push(text);
    }
    return out;
  });

async function openPanelWithSeg(page: Page) {
  await loadFixture(page, 'ct-axial-anatomy', 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await expect(panel.locator('[data-testid="context-toolbox"]')).toBeVisible({ timeout: 10_000 });
  return panel;
}

async function dragTo(page: Page, targetWidth: number) {
  const root = page.locator('[data-testid="annotations-panel-root"]');
  const handle = page.locator('[data-testid="annotations-panel-resize-handle"]');
  const hb = (await handle.boundingBox())!;
  const rb = (await root.boundingBox())!;
  const rightEdge = rb.x + rb.width;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(rightEdge - targetWidth, hb.y + hb.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

test('default width fits every tool label without clipping', async ({ page }) => {
  await openPanelWithSeg(page);
  const root = page.locator('[data-testid="annotations-panel-root"]');
  expect(Number(await root.getAttribute('data-panel-width'))).toBe(400);
  expect(await clippedTexts(page), 'no toolbox label should clip at the default width').toEqual([]);
});

test('dragging the handle resizes the panel and ellipsizes labels', async ({ page }) => {
  await openPanelWithSeg(page);
  const root = page.locator('[data-testid="annotations-panel-root"]');
  await dragTo(page, 300);
  expect(Number(await root.getAttribute('data-panel-width'))).toBe(300);
  // Labels stay present but ellipsize — the middle state between full and icon-only.
  expect((await clippedTexts(page)).length).toBeGreaterThan(0);
  await expect(page.locator('[data-testid="context-toolbox"]').getByRole('button', { name: 'Brush', exact: true })).toBeVisible();
});

test('below the compact threshold the toolbox shows icons only', async ({ page }) => {
  const panel = await openPanelWithSeg(page);
  await dragTo(page, 190);
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  // Buttons remain (aria-label intact) but render no visible text.
  const brush = toolbox.getByRole('button', { name: 'Brush', exact: true });
  await expect(brush).toBeVisible();
  expect((await brush.textContent())?.trim() ?? '').toBe('');
});
