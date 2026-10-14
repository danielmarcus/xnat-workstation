/**
 * The operation sweep: the Operations section's operations, in every orientation, on realistic
 * data — checked against invariants that hold for ANY operation (see tool-sweep.e2e.ts):
 * nothing throws or logs an error; the Slice scope changes only the slice on screen (in that
 * viewport's plane); only the active segment changes; one Ctrl+Z restores every segment
 * exactly; Interpolate writes only between the slices it interpolates; 3D QC opens and closes
 * cleanly. Each case collects every violation and reports them together.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Locator, Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';
import { clickTool } from '../../helpers/toolbox';
import { openOperation } from '../../helpers/operations';

type Diff = Record<number, { added: number; removed: number; planes: number[]; focalChanged: boolean; now: number }>;
type Hooks = {
  snapshotMembers: (tag: string) => number;
  diffMembers: (tag: string, panelId: string) => Diff | null;
  viewportPlane: (panelId: string) => { axis: 0 | 1 | 2; index: number; focal: [number, number, number]; dims: [number, number, number]; aligned: boolean } | null;
  inPlanePagePoint: (panelId: string, dx: number, dy: number) => { x: number; y: number } | null;
};
const PANEL = 'panel_0';
const H = (page: Page) => ({
  snapshot: (tag: string) => page.evaluate((t) => (window as unknown as { __XNAT_E2E__: Hooks }).__XNAT_E2E__.snapshotMembers(t), tag),
  diff: (tag: string) => page.evaluate(([t, id]) => (window as unknown as { __XNAT_E2E__: Hooks }).__XNAT_E2E__.diffMembers(t, id), [tag, PANEL] as const),
  plane: () => page.evaluate((id) => (window as unknown as { __XNAT_E2E__: Hooks }).__XNAT_E2E__.viewportPlane(id), PANEL),
  point: (dx: number, dy: number) => page.evaluate(([id, x, y]) => (window as unknown as { __XNAT_E2E__: Hooks }).__XNAT_E2E__.inPlanePagePoint(id, x, y), [PANEL, dx, dy] as const),
});

async function drag(page: Page, path: Array<[number, number]>) {
  const pts = [];
  for (const [dx, dy] of path) { const p = await H(page).point(dx, dy); if (!p) throw new Error('no point'); pts.push(p); }
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(p.x, p.y, { steps: 8 });
  await page.mouse.up();
}

function captureErrors(page: Page): () => string[] {
  const errors: string[] = [];
  const onConsole = (m: { type(): string; text(): string }) => { if (m.type() === 'error') errors.push(`console.error: ${m.text().slice(0, 300)}`); };
  const onPageError = (e: Error) => errors.push(`pageerror: ${String(e.stack ?? e).slice(0, 400)}`);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  return () => { page.off('console', onConsole); page.off('pageerror', onPageError); return errors; };
}

async function step(page: Page, key: 'ArrowUp' | 'ArrowDown', times: number) {
  for (let i = 0; i < times; i++) {
    const before = (await H(page).plane())?.index;
    await page.locator(`[data-testid="unified-viewport-element:${PANEL}"]`).hover();
    await page.keyboard.press(key);
    await expect.poll(async () => (await H(page).plane())?.index).not.toBe(before);
  }
}

/** Wait until the masks stop changing: the same for ~1 s (see tool-sweep.e2e.ts). */
async function settled(page: Page, tag: string): Promise<Diff> {
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

/**
 * Two segments. The active one is painted on the slice on screen (a square over the lesion and
 * a speck beside it) and on the slice 4 further on (a smaller square); the view returns to the
 * first painted slice, so the gap lies beyond it.
 */
async function setup(page: Page, fixture: string, orientation: string): Promise<{ panel: Locator; painted: [number, number] }> {
  await loadFixture(page, fixture, PANEL);
  if (orientation !== 'ACQUISITION') {
    const before = await H(page).plane();
    await page.locator(`[data-panel-id="${PANEL}"]`).getByTitle('Viewport orientation').selectOption(orientation);
    await expect.poll(async () => (await H(page).plane())?.axis ?? -1, { timeout: 15_000 }).not.toBe(before?.axis ?? 2);
  }
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await expect(toolbox.getByRole('button', { name: 'Brush', exact: true })).toBeVisible({ timeout: 10_000 });
  await panel.getByRole('button', { name: 'Add member' }).first().click();
  await page.keyboard.press('Escape');
  await clickTool(toolbox, 'Rect');
  await drag(page, [[35, 35], [50, 50]]);
  await panel.locator('[data-testid^="member-row-"]').first().click();
  const a = (await H(page).plane())!.index;
  await drag(page, [[-10, -10], [10, 10]]);
  await drag(page, [[18, -2], [20, 0]]);
  await step(page, 'ArrowDown', 4);
  const b = (await H(page).plane())!.index;
  await drag(page, [[-8, -8], [8, 8]]);
  await step(page, 'ArrowUp', 4);
  return { panel, painted: [a, b] };
}

interface OpCase {
  name: string;
  run: (panel: Locator, page: Page) => Promise<void>;
  /** Changes must lie on the slice on screen only. */
  flat: boolean;
  expect: 'change' | 'any';
  /** Changes must lie strictly between the two painted slices. */
  between?: boolean;
}

const commit = async (sheet: Locator, page: Page) => {
  await expect(page.getByTestId('mask-preview-bar')).toBeVisible({ timeout: 20_000 });
  await sheet.getByRole('button', { name: 'Commit' }).click();
};

const CLEANUP = ['Fill holes', 'Keep largest', 'Remove speckles', 'Remove strays', 'Median smooth', 'Gaussian smooth', 'Smooth edges', 'Morph open', 'Morph close'];
const OPS: OpCase[] = [
  ...CLEANUP.flatMap((op): OpCase[] => (['Slice', 'Volume'] as const).map((scope) => ({
    name: `Cleanup · ${op} · ${scope}`,
    flat: scope === 'Slice',
    expect: 'any',
    run: async (panel, page) => {
      const sheet = await openOperation(panel, 'Cleanup', op);
      await sheet.getByRole('group', { name: 'Slices' }).getByRole('button', { name: scope, exact: true }).click();
      await sheet.getByRole('button', { name: 'Preview', exact: true }).click();
      // Some operations find nothing to do — then there is no preview, and that is fine.
      if (await page.getByTestId('mask-preview-bar').isVisible({ timeout: 5_000 }).catch(() => false)) await sheet.getByRole('button', { name: 'Commit' }).click();
    },
  }))),
  {
    name: 'Interpolate',
    flat: false,
    expect: 'change',
    between: true,
    run: async (panel, page) => {
      const sheet = await openOperation(panel, 'Interpolate');
      await sheet.getByRole('button', { name: 'Preview', exact: true }).click();
      // It may refuse (an oblique reformat) — then there is no preview to commit.
      if (await page.getByTestId('mask-preview-bar').isVisible({ timeout: 10_000 }).catch(() => false)) await sheet.getByRole('button', { name: 'Commit' }).click();
    },
  },
  {
    name: 'Propagate',
    flat: false,
    expect: 'any',
    run: async (panel, page) => {
      const sheet = await openOperation(panel, 'Propagate');
      await sheet.getByRole('button', { name: 'Preview', exact: true }).click();
      if (await page.getByTestId('mask-preview-bar').isVisible({ timeout: 10_000 }).catch(() => false)) await sheet.getByRole('button', { name: 'Commit' }).click();
    },
  },
];

const CONTEXTS: Array<{ fixture: string; orientation: 'ACQUISITION' | 'SAGITTAL' | 'CORONAL' }> = [
  { fixture: 'ct-body-512', orientation: 'ACQUISITION' },
  { fixture: 'ct-body-512', orientation: 'SAGITTAL' },
  { fixture: 'ct-body-512', orientation: 'CORONAL' },
  { fixture: 'ct-body-oblique', orientation: 'CORONAL' },
];

for (const ctx of CONTEXTS) {
  test.describe(`${ctx.fixture} · ${ctx.orientation}`, () => {
    for (const op of OPS) {
      test(op.name, async ({ page }) => {
        test.setTimeout(120_000);
        const { panel, painted } = await setup(page, ctx.fixture, ctx.orientation);
        const problems: string[] = [];
        const plane = await H(page).plane();
        await H(page).snapshot('before');
        const errorsOf = captureErrors(page);
        try {
          await op.run(panel, page);
        } catch (e) {
          problems.push(`could not run: ${String(e).split('\n')[0]}`);
        }
        const d = await settled(page, 'before');
        // On an oblique reformat the operations that act on the slice on screen refuse, and the
        // painted "slices" lie across the grid — only the generic invariants apply.
        const oblique = !plane?.aligned;
        if (op.expect === 'change' && !oblique && !changed(d, 1)) problems.push('the active segment did not change');
        if (changed(d, 1) && !oblique) {
          const pl = d[1].planes;
          if (op.flat && (pl.length !== 1 || pl[0] !== plane?.index)) problems.push(`Slice scope changed slices ${pl.slice(0, 8).join(',')}${pl.length > 8 ? '…' : ''} along axis ${plane?.axis}, not just the one on screen (${plane?.index})`);
          if (op.between) {
            const [lo, hi] = [Math.min(...painted), Math.max(...painted)];
            const outside = pl.filter((z) => z <= lo || z >= hi);
            if (outside.length) problems.push(`interpolation wrote slices ${outside.join(',')} outside the gap (${lo}, ${hi})`);
          }
        }
        if (changed(d, 2)) problems.push(`the other segment changed (+${d[2].added} −${d[2].removed})`);
        if (changed(d, 1) || changed(d, 2)) {
          await page.locator(`[data-testid="unified-viewport-element:${PANEL}"]`).hover();
          await page.keyboard.press('Control+z');
          const u = await settled(page, 'before');
          if (changed(u, 1) || changed(u, 2)) problems.push(`one undo did not restore the masks (${JSON.stringify(u)})`);
        }
        problems.push(...errorsOf());
        expect(problems, problems.join('\n')).toEqual([]);
      });
    }

    test('3D QC opens, builds, and closes cleanly', async ({ page }) => {
      test.setTimeout(120_000);
      const { panel } = await setup(page, ctx.fixture, ctx.orientation);
      const problems: string[] = [];
      await H(page).snapshot('before');
      const viewports = await page.locator('[data-testid^="unified-viewport-element:"]').count();
      const errorsOf = captureErrors(page);
      try {
        const sheet = await openOperation(panel, '3D QC');
        await expect(sheet.getByTestId('qc3d-report')).toBeVisible({ timeout: 30_000 });
        await panel.getByRole('button', { name: 'Close operation' }).click();
      } catch (e) {
        problems.push(`3D QC: ${String(e).split('\n')[0]}`);
      }
      await expect.poll(() => page.locator('[data-testid^="unified-viewport-element:"]').count(), { timeout: 10_000 }).toBe(viewports).catch(() => problems.push('the layout was not restored'));
      const d = await settled(page, 'before');
      if (changed(d, 1) || changed(d, 2)) problems.push('3D QC changed a segment');
      problems.push(...errorsOf());
      expect(problems, problems.join('\n')).toEqual([]);
    });
  });
}
