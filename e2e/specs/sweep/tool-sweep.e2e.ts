/**
 * The tool sweep: every Segmentation tool, in every orientation, on realistic data — checked
 * against invariants that hold for ANY tool, not against each tool's own expected result:
 *
 *   1. nothing throws, and the renderer logs no error;
 *   2. a tool that should change the mask does, and the voxel under the gesture is among the
 *      changes (catches plane / axis / world-vs-index mistakes);
 *   3. a 2D tool changes only the slice on screen — in that viewport's plane;
 *   4. only the active segment changes;
 *   5. one Ctrl+Z restores every segment exactly; Ctrl+⇧Z re-applies the same change;
 *   6. on a locked segment, nothing changes (and nothing throws).
 *
 * Each case collects every violation and reports them together.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Locator, Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';
import { clickTool, toolFamily } from '../../helpers/toolbox';

type Diff = Record<number, { added: number; removed: number; planes: number[]; focalChanged: boolean; now: number; maxPlaneMm: number; minFocalMm: number; voxelDiagMm: number }>;
type Hooks = {
  clearAllContainers: () => void;
  snapshotMembers: (tag: string) => number;
  diffMembers: (tag: string, panelId: string) => Diff | null;
  viewportPlane: (panelId: string) => { axis: 0 | 1 | 2; index: number; focal: [number, number, number]; dims: [number, number, number]; aligned: boolean } | null;
  inPlanePagePoint: (panelId: string, dx: number, dy: number) => { x: number; y: number } | null;
  sourceValueAtFocal: (panelId: string) => number | null;
};
const H = (page: Page) => ({
  snapshot: (tag: string) => page.evaluate((t) => (window as unknown as { __XNAT_E2E__: Hooks }).__XNAT_E2E__.snapshotMembers(t), tag),
  diff: (tag: string) => page.evaluate(([t, id]) => (window as unknown as { __XNAT_E2E__: Hooks }).__XNAT_E2E__.diffMembers(t, id), [tag, PANEL] as const),
  plane: () => page.evaluate((id) => (window as unknown as { __XNAT_E2E__: Hooks }).__XNAT_E2E__.viewportPlane(id), PANEL),
  point: (dx: number, dy: number) => page.evaluate(([id, x, y]) => (window as unknown as { __XNAT_E2E__: Hooks }).__XNAT_E2E__.inPlanePagePoint(id, x, y), [PANEL, dx, dy] as const),
});

const PANEL = 'panel_0';

async function pt(page: Page, dx: number, dy: number) {
  const p = await H(page).point(dx, dy);
  if (!p) throw new Error('no in-plane point');
  return p;
}
async function drag(page: Page, path: Array<[number, number]>, shift = false) {
  const pts = [];
  for (const [dx, dy] of path) pts.push(await pt(page, dx, dy));
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(p.x, p.y, { steps: 8 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
}
async function click(page: Page, dx = 0, dy = 0) {
  const p = await pt(page, dx, dy);
  await page.mouse.click(p.x, p.y);
}
const loop = (r: number, n = 24): Array<[number, number]> =>
  Array.from({ length: n + 1 }, (_, k) => [r * Math.cos((2 * Math.PI * k) / n), r * Math.sin((2 * Math.PI * k) / n)]);

type Expect = 'change' | 'any' | 'none';
interface ToolCase {
  label: string;
  expect: Expect;
  /** A 2D tool edits the slice on screen only. */
  flat: boolean;
  /** The voxel under the gesture's centre must change. */
  focal: boolean;
  gesture: (page: Page) => Promise<void>;
  /** After the gesture (e.g. a preview to commit). */
  after?: (page: Page) => Promise<void>;
  /**
   * A grow-cut tool (Cornerstone's WebGPU engine), by its Cornerstone name. Where the machine has
   * no WebGPU adapter it is disabled in the toolbox and refuses the gesture ('none').
   */
  growCut?: string;
}

const commitPreview = async (page: Page) => {
  await expect(page.getByTestId('mask-preview-bar')).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Enter');
};

const TOOLS: ToolCase[] = [
  { label: 'Brush', expect: 'change', flat: true, focal: true, gesture: (p) => drag(p, [[-4, 0], [4, 0]]) },
  // The default window (CT: Soft Tissue, −100…300 HU) holds the 110 HU lesion under the gesture.
  { label: 'Threshold', expect: 'change', flat: true, focal: true, gesture: (p) => drag(p, [[-4, 0], [4, 0]]) },
  { label: 'Dyn. Thresh', expect: 'change', flat: true, focal: true, gesture: (p) => drag(p, [[-2, 0], [2, 0]]) },
  { label: 'Sph. Brush', expect: 'change', flat: false, focal: true, gesture: (p) => drag(p, [[-4, 0], [4, 0]]) },
  { label: 'Sph. Thresh', expect: 'change', flat: false, focal: true, gesture: (p) => drag(p, [[-4, 0], [4, 0]]) },
  { label: 'Circle', expect: 'change', flat: true, focal: true, gesture: (p) => drag(p, [[0, 0], [8, 0]]) },
  { label: 'Rect', expect: 'change', flat: true, focal: true, gesture: (p) => drag(p, [[-8, -8], [8, 8]]) },
  { label: 'Sphere', expect: 'change', flat: false, focal: true, gesture: (p) => drag(p, [[0, 0], [8, 0]]) },
  { label: 'Paint Fill', expect: 'any', flat: true, focal: false, gesture: (p) => click(p) },
  // Region segments in 3D inside the sphere you drag; Region+ in 3D from one click.
  { label: 'Region', expect: 'change', flat: false, focal: true, growCut: 'RegionSegment', gesture: (p) => drag(p, [[0, 0], [12, 0]]) },
  { label: 'Region+', expect: 'change', flat: false, focal: true, growCut: 'RegionSegmentPlus', gesture: (p) => click(p) },
  { label: 'Rect Threshold', expect: 'change', flat: true, focal: true, gesture: (p) => drag(p, [[-8, -8], [8, 8]]) },
  // The circle's in-circle test runs in the view's axes (it is the Circle scissors), so unlike
  // Rect Threshold it is not refused on an oblique reformat.
  { label: 'Circle Threshold', expect: 'change', flat: true, focal: true, gesture: (p) => drag(p, [[0, 0], [8, 0]]) },
  { label: 'Contour Fill', expect: 'change', flat: true, focal: true, gesture: (p) => drag(p, loop(10)) },
  { label: 'Level Trace', expect: 'change', flat: true, focal: true, gesture: (p) => click(p), after: commitPreview },
  { label: 'Smart Brush', expect: 'change', flat: true, focal: true, gesture: (p) => drag(p, [[-3, 0], [3, 0]]) },
  { label: 'ROI limit', expect: 'none', flat: true, focal: false, gesture: (p) => drag(p, [[-10, -10], [10, 10]]) },
  { label: 'Select', expect: 'none', flat: true, focal: false, gesture: (p) => click(p) },
];

/** The app's own plane tools, which work on grid slices — refused on an oblique reformat. */
const REFUSE_ON_OBLIQUE_VIEW = new Set(['Level Trace', 'Smart Brush', 'Region', 'Region+', 'Rect Threshold']);

const CONTEXTS: Array<{ fixture: string; orientation: 'ACQUISITION' | 'SAGITTAL' | 'CORONAL' }> = [
  { fixture: 'ct-body-512', orientation: 'ACQUISITION' },
  { fixture: 'ct-body-512', orientation: 'SAGITTAL' },
  { fixture: 'ct-body-512', orientation: 'CORONAL' },
  { fixture: 'ct-body-oblique', orientation: 'ACQUISITION' },
  { fixture: 'ct-body-oblique', orientation: 'CORONAL' },
];

const GROW_CUT_GPU_UNAVAILABLE = 'Region and Region+ need WebGPU, which this computer does not provide. Use the Seeded segmentation operation (Fast GrowCut, on the CPU) instead.';

/** Whether the renderer has a WebGPU adapter (Region / Region+ need one). */
async function hasWebGpuAdapter(page: Page): Promise<boolean> {
  return page.evaluate(async () => !!(await (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu?.requestAdapter()));
}

/** Errors the renderer logs while a case runs. */
function captureErrors(page: Page): () => string[] {
  const errors: string[] = [];
  const onConsole = (m: { type(): string; text(): string }) => { if (m.type() === 'error') errors.push(`console.error: ${m.text().slice(0, 300)}`); };
  const onPageError = (e: Error) => errors.push(`pageerror: ${String(e.stack ?? e).slice(0, 400)}`);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  return () => { page.off('console', onConsole); page.off('pageerror', onPageError); return errors; };
}

async function setup(page: Page, fixture: string, orientation: string): Promise<{ panel: Locator; toolbox: Locator }> {
  await loadFixture(page, fixture, PANEL);
  if (orientation !== 'ACQUISITION') {
    const before = await H(page).plane();
    await page.locator(`[data-panel-id="${PANEL}"]`).getByTitle('Viewport orientation').selectOption(orientation);
    await expect.poll(async () => (await H(page).plane())?.axis ?? -1, { timeout: 15_000 })
      .not.toBe(before?.axis ?? 2);
  }
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await expect(toolbox.getByRole('button', { name: 'Brush', exact: true })).toBeVisible({ timeout: 10_000 });
  // A second segment with voxels of its own, away from the gestures — it must never change.
  await panel.getByRole('button', { name: 'Add member' }).first().click();
  await page.keyboard.press('Escape');
  await clickTool(toolbox, 'Rect');
  await drag(page, [[35, 35], [50, 50]]);
  await panel.locator('[data-testid^="member-row-"]').first().click();
  return { panel, toolbox };
}

/**
 * Wait until the masks stop changing: the same for ~1 s. Some tools write asynchronously (a
 * grow-cut takes a second or two), so "unchanged twice in a row" is not "done".
 */
async function settled(page: Page, tag: string, awaitChange = false): Promise<Diff> {
  if (awaitChange) {
    // A tool that should change the mask gets up to 15 s to start (a 3D grow-cut takes seconds).
    for (let i = 0; i < 75; i++) {
      const d = await H(page).diff(tag);
      if (d && Object.values(d).some((m) => m.added + m.removed > 0)) break;
      await page.waitForTimeout(200);
    }
  }
  let last = '';
  let same = 0;
  for (let i = 0; i < 60 && same < 6; i++) {
    await page.waitForTimeout(170);
    const key = JSON.stringify(await H(page).diff(tag));
    same = key === last ? same + 1 : 0;
    last = key;
  }
  return JSON.parse(last) as Diff;
}

const changed = (d: Diff, idx: number) => !!d[idx] && d[idx].added + d[idx].removed > 0;

for (const ctx of CONTEXTS) {
  test.describe(`${ctx.fixture} · ${ctx.orientation}`, () => {
    for (const tool of TOOLS) {
      test(`${tool.label}`, async ({ page }) => {
        test.setTimeout(90_000);
        const { panel, toolbox } = await setup(page, ctx.fixture, ctx.orientation);
        const problems: string[] = [];
        const plane = await H(page).plane();
        await H(page).snapshot('before');
        // On an oblique reformat the plane tools refuse (their "slice on screen" would be a grid
        // slice that is not the one shown, or Cornerstone's grid-axis box) — nothing may change.
        // Without WebGPU the grow-cut tools are disabled, saying why; one active anyway (chosen
        // before the check answered) refuses the gesture with that message — nothing may change.
        const noGpu = !!tool.growCut && !(await hasWebGpuAdapter(page));
        const expectHere: Expect = noGpu || (!plane?.aligned && REFUSE_ON_OBLIQUE_VIEW.has(tool.label)) ? 'none' : tool.expect;
        const errorsOf = captureErrors(page);
        if (noGpu) {
          const button = toolbox.getByTestId('toolbox-grid').getByRole('button', { name: toolFamily(tool.label), exact: true });
          await expect(button).toBeDisabled({ timeout: 10_000 });
          await expect(button).toHaveAttribute('title', GROW_CUT_GPU_UNAVAILABLE);
          await page.evaluate((name) => (window as unknown as { __XNAT_E2E__: { setActiveUnifiedTool: (n: string) => void } }).__XNAT_E2E__.setActiveUnifiedTool(name), tool.growCut!);
        } else {
          await clickTool(toolbox, tool.label);
        }
        try {
          await tool.gesture(page);
          if (tool.after && expectHere !== 'none') await tool.after(page);
        } catch (e) {
          problems.push(`gesture failed: ${String(e).split('\n')[0]}`);
        }
        if (noGpu) await expect(page.getByTestId('viewport-toast').filter({ hasText: GROW_CUT_GPU_UNAVAILABLE })).toBeVisible({ timeout: 10_000 });
        const d = await settled(page, 'before', expectHere === 'change');
        const active = d[1], other = d[2];
        if (expectHere === 'change' && !changed(d, 1)) problems.push('the active segment did not change');
        if (expectHere === 'none' && (changed(d, 1) || changed(d, 2))) problems.push(`a segment changed (${JSON.stringify(d)})`);
        if (changed(d, 1) && plane?.aligned) {
          if (tool.focal && !active.focalChanged) problems.push(`the voxel under the gesture did not change (changes on slices ${active.planes.slice(0, 8).join(',')} of axis ${plane?.axis}; screen slice ${plane?.index})`);
          if (tool.flat && (active.planes.length !== 1 || active.planes[0] !== plane?.index)) {
            problems.push(`a 2D tool changed slices ${active.planes.slice(0, 8).join(',')}${active.planes.length > 8 ? '…' : ''} along axis ${plane?.axis}, not just the one on screen (${plane?.index})`);
          }
        } else if (changed(d, 1)) {
          // An oblique reformat cuts across the grid: a 2D edit is the voxels the plane passes
          // through (centres within half a voxel diagonal of it), and it reaches the gesture.
          if (tool.flat && active.maxPlaneMm > active.voxelDiagMm / 2 + 0.01) problems.push(`a 2D tool changed voxels ${active.maxPlaneMm.toFixed(2)} mm from the plane on screen (a voxel diagonal is ${active.voxelDiagMm.toFixed(2)} mm)`);
          if (tool.focal && active.minFocalMm > active.voxelDiagMm) problems.push(`the change does not reach the gesture: nearest ${active.minFocalMm.toFixed(2)} mm away`);
        }
        if (changed(d, 2)) problems.push(`the other segment changed (+${other.added} −${other.removed})`);

        if (changed(d, 1) || changed(d, 2)) {
          await H(page).snapshot('after');
          await page.locator(`[data-testid="unified-viewport-element:${PANEL}"]`).hover();
          await page.keyboard.press('Control+z');
          const u = await settled(page, 'before');
          if (changed(u, 1) || changed(u, 2)) problems.push(`one undo did not restore the masks (${JSON.stringify(u)})`);
          await page.keyboard.press('Control+Shift+z');
          const r = await settled(page, 'after');
          if (changed(r, 1) || changed(r, 2)) problems.push(`redo did not re-apply the same change (${JSON.stringify(r)})`);
        }
        problems.push(...errorsOf());

        // Locked: the same gesture changes nothing, and throws nothing.
        if (expectHere !== 'none') {
          await page.keyboard.press('Control+z');
          await settled(page, 'before');
          await panel.locator('[data-testid^="member-row-"]').first().getByRole('button', { name: 'Toggle lock' }).click();
          await H(page).snapshot('locked');
          const lockedErrors = captureErrors(page);
          try {
            await tool.gesture(page);
            if (tool.after && (await page.getByTestId('mask-preview-bar').isVisible())) await page.keyboard.press('Enter');
          } catch { /* a refused gesture may leave nothing to commit */ }
          const l = await settled(page, 'locked');
          if (changed(l, 1)) problems.push(`a locked segment changed (+${l[1].added} −${l[1].removed})`);
          if (changed(l, 2)) problems.push('the other segment changed while the active one was locked');
          problems.push(...lockedErrors().map((e) => `(locked) ${e}`));
        }
        expect(problems, problems.join('\n')).toEqual([]);
      });
    }
  });
}

// Operations read the image in modality units (HU on CT). The fixture stores HU + 1024 with a
// −1024 rescale intercept, as real CT does; the lesion at the focal point is 110 ± 12 HU.
for (const orientation of ['ACQUISITION', 'SAGITTAL', 'CORONAL'] as const) {
  test(`the image is read in HU (${orientation})`, async ({ page }) => {
    await setup(page, 'ct-body-512', orientation);
    const v = await page.evaluate((id) => (window as unknown as { __XNAT_E2E__: Hooks }).__XNAT_E2E__.sourceValueAtFocal(id), PANEL);
    expect(v).not.toBeNull();
    expect(v!).toBeGreaterThanOrEqual(98);
    expect(v!).toBeLessThanOrEqual(122);
  });
}
