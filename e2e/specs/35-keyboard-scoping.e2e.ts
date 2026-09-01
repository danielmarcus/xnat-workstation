/**
 * Keyboard scoping + active-viewport indicator (Rebuild Phase 3 / signal 35, D1/D5).
 *
 * D1: the active (focused) viewport shows its indicator. D5: VIEW shortcuts (rotate
 * /zoom/slice/W-L) act on the active panel only; GLOBAL shortcuts (active-tool, etc.)
 * fire regardless of focus. Drives the real toolbar layout + real keyboard events.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { ensureFixture, enterLocalViewer, loadLocalDicom } from '../helpers/local-fixture';

interface E2EHooks {
  getActiveViewportId: () => string | null;
  getActiveUnifiedTool: () => string | null;
}
type Win = { __XNAT_E2E__: E2EHooks };

const viewport = (page: Page, pid: string) => page.locator(`[data-testid="unified-viewport:${pid}"]`);
const canvasOf = (page: Page, pid: string) => page.locator(`[data-testid="unified-viewport-element:${pid}"] canvas`);
const activeViewport = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getActiveViewportId());
const activeTool = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getActiveUnifiedTool());

test('active-viewport indicator + view-shortcuts scoped to active panel + global shortcut fires', async ({ page }) => {
  await enterLocalViewer(page);
  // panel_0 = scan A; 1×2 layout; panel_1 = scan B (independent canvases).
  await loadLocalDicom(page, ensureFixture('ct-axial-300'), 'panel_0');
  await page.locator('[title^="Viewport layout"]').click();
  await page.getByRole('button', { name: '1 x 2' }).click();
  await expect(viewport(page, 'panel_1')).toHaveCount(1, { timeout: 20_000 });
  await viewport(page, 'panel_1').click({ position: { x: 20, y: 20 } });
  await loadLocalDicom(page, ensureFixture('ct-axial-anatomy'), 'panel_1');
  await expect(canvasOf(page, 'panel_0')).toBeVisible({ timeout: 30_000 });
  await expect(canvasOf(page, 'panel_1')).toBeVisible({ timeout: 30_000 });

  // D1: click panel_0 → it is the active viewport (indicator), panel_1 is not.
  await viewport(page, 'panel_0').click({ position: { x: 40, y: 40 } });
  await expect(viewport(page, 'panel_0')).toHaveAttribute('data-active', 'true');
  await expect(viewport(page, 'panel_1')).toHaveAttribute('data-active', 'false');
  expect(await activeViewport(page)).toBe('panel_0');

  // D5 view shortcut: rotate (R) affects the ACTIVE panel (panel_0) only — its canvas
  // changes while the inactive panel_1 canvas is untouched (the active ring lives on
  // the container, not the canvas, so the canvas screenshot isolates the rotation).
  const p0Before = await canvasOf(page, 'panel_0').screenshot();
  const p1Before = await canvasOf(page, 'panel_1').screenshot();
  await page.keyboard.press('r');
  await expect.poll(async () => !(await canvasOf(page, 'panel_0').screenshot()).equals(p0Before), { timeout: 5_000 }).toBe(true);
  expect((await canvasOf(page, 'panel_1').screenshot()).equals(p1Before)).toBe(true);

  // D1: the active indicator follows focus — click panel_1 → it becomes active, panel_0 not.
  await viewport(page, 'panel_1').click({ position: { x: 40, y: 40 } });
  await expect(viewport(page, 'panel_1')).toHaveAttribute('data-active', 'true');
  await expect(viewport(page, 'panel_0')).toHaveAttribute('data-active', 'false');
  expect(await activeViewport(page)).toBe('panel_1');

  // GLOBAL shortcut: a tool switch fires regardless of which panel is focused.
  await page.keyboard.press('p'); // Pan
  await expect.poll(() => activeTool(page), { timeout: 5_000 }).toBe('Pan');
});
