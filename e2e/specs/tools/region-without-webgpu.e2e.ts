/**
 * Region and Region+ on a machine with no WebGPU adapter.
 *
 * Cornerstone's grow-cut, their only engine, runs on WebGPU. Where `navigator.gpu.requestAdapter()`
 * resolves null (a GPU-less host, a VM, a remote desktop — and this suite's Linux runner with
 * software WebGL) it used to throw "Cannot read properties of null (reading 'requestDevice')" as
 * an unhandled page error and change nothing, silently. Now:
 *
 *   - both toolbox buttons are disabled, their tooltip saying why;
 *   - a tool that is active anyway (chosen before the check answered) refuses the gesture with a
 *     toast saying why; no voxel changes, nothing throws.
 *
 * Only meaningful where there is no adapter; on a machine with WebGPU it skips, saying so. On a
 * GPU-less Linux host run it as:
 *   E2E_ELECTRON_ARGS="--enable-unsafe-swiftshader --ignore-gpu-blocklist" xvfb-run -a npx playwright test region-without-webgpu
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';
import { clickTool } from '../../helpers/toolbox';

const PANEL = 'panel_0';
const MESSAGE = 'Region and Region+ need WebGPU, which this computer does not provide. Use the Seeded segmentation operation (Fast GrowCut, on the CPU) instead.';

type Hooks = {
  snapshotMembers: (tag: string) => number;
  diffMembers: (tag: string, panelId: string) => Record<number, { added: number; removed: number }> | null;
  inPlanePagePoint: (panelId: string, dx: number, dy: number) => { x: number; y: number } | null;
  setActiveUnifiedTool: (toolName: string) => void;
};

async function hasWebGpuAdapter(page: Page): Promise<boolean> {
  return page.evaluate(async () => !!(await (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu?.requestAdapter()));
}

async function point(page: Page, dx: number, dy: number) {
  const p = await page.evaluate(([id, x, y]) => (window as unknown as { __XNAT_E2E__: Hooks }).__XNAT_E2E__.inPlanePagePoint(id, x, y), [PANEL, dx, dy] as const);
  if (!p) throw new Error('no in-plane point');
  return p;
}

const CASES: Array<{ label: string; toolName: string; gesture: (page: Page) => Promise<void> }> = [
  {
    label: 'Region',
    toolName: 'RegionSegment',
    gesture: async (page) => {
      const a = await point(page, 0, 0), b = await point(page, 12, 0);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 8 });
      await page.mouse.up();
    },
  },
  {
    label: 'Region+',
    toolName: 'RegionSegmentPlus',
    gesture: async (page) => {
      const a = await point(page, 0, 0);
      await page.mouse.click(a.x, a.y);
    },
  },
];

for (const c of CASES) {
  test(`${c.label} without WebGPU: disabled with a reason, and refuses with a toast`, async ({ page }) => {
    test.setTimeout(90_000);
    await loadFixture(page, 'ct-body-512', PANEL);
    test.skip(await hasWebGpuAdapter(page), 'this machine has a WebGPU adapter — the case is for one without');

    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e.stack ?? e).slice(0, 400)));

    const panel = page.locator('[data-testid="annotations-side-panel"]');
    if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
    await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
    await page.keyboard.press('Escape');
    const toolbox = panel.locator('[data-testid="context-toolbox"]');
    await expect(toolbox.getByRole('button', { name: 'Brush', exact: true })).toBeVisible({ timeout: 10_000 });

    // The toolbox: disabled, the tooltip saying why.
    const button = toolbox.getByRole('button', { name: c.label, exact: true });
    await expect(button).toBeDisabled({ timeout: 10_000 });
    await expect(button).toHaveAttribute('title', MESSAGE);

    // A tool already active (chosen before the check answered) refuses the gesture itself.
    await clickTool(toolbox, 'Brush');
    await page.evaluate((name) => (window as unknown as { __XNAT_E2E__: Hooks }).__XNAT_E2E__.setActiveUnifiedTool(name), c.toolName);
    await page.evaluate(() => (window as unknown as { __XNAT_E2E__: Hooks }).__XNAT_E2E__.snapshotMembers('before'));
    await c.gesture(page);

    await expect(page.getByTestId('viewport-toast').filter({ hasText: MESSAGE })).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(2_000); // a grow-cut, had one started, writes within seconds
    const d = await page.evaluate((id) => (window as unknown as { __XNAT_E2E__: Hooks }).__XNAT_E2E__.diffMembers('before', id), PANEL);
    const changed = Object.values(d ?? {}).filter((m) => m.added + m.removed > 0);
    expect(changed, `voxels changed: ${JSON.stringify(d)}`).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
}
