/**
 * Annotations through the extension API (extension framework X4 — docs/extension-framework.md,
 * R7). The probe extension's own `ext.annotations` acts through the Annotations panel's actions,
 * so what it does shows in the panel exactly as a user's action would; saving runs the real
 * queue → transport path against the in-memory mock XNAT (nothing reaches a server), conflict
 * detection included; an approved container is refused as the panel refuses it.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures/electron-app';
import { loadFixture } from '../../helpers/local-fixture';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const edition = fs.mkdtempSync(path.join(os.tmpdir(), 'xnat-e2e-ext-ann-'));
fs.cpSync(path.join(ROOT, 'e2e', 'fixtures', 'extensions', 'probe'), path.join(edition, 'probe'), { recursive: true });
test.use({ extensionsDir: edition });

type Probe = { ext: any; events: string[] };
type Hooks = {
  clearAllContainers: () => void;
  installMockXnatTransport: () => void;
  injectTransportConflict: () => void;
  setUnifiedBrushSize: (n: number) => void;
  setActiveUnifiedTool: (t: string) => void;
  getTransportEntry: (id: string) => { versionToken?: string } | null;
};
type Win = { __extProbe: Probe; __XNAT_E2E__: Hooks };
const probe = <T,>(page: Page, fn: (p: Probe, arg: any) => T | Promise<T>, arg?: unknown) =>
  page.evaluate(async ({ src, arg }) => {
    const p = (window as unknown as Win).__extProbe;
    try { return await (0, eval)(`(${src})`)(p, arg); } catch (e) { return { error: (e as Error).message }; }
  }, { src: fn.toString(), arg });

const panelOf = (page: Page) => page.locator('[data-testid="annotations-side-panel"]');

test.beforeEach(async ({ page }) => {
  await expect.poll(() => page.evaluate(() => !!(window as unknown as Win).__extProbe)).toBe(true);
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers());
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  if (!(await panelOf(page).isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
});
test.afterEach(({ page }) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers()));

test('create() from a template makes the named members, in the panel, and the first is active', async ({ page }) => {
  const made = await probe(page, (p) => p.ext.annotations.create({
    kind: 'SEG', label: 'Liver study', members: [{ label: 'Liver', color: [200, 40, 40] }, { label: 'Tumour', color: [250, 200, 0] }],
  })) as { id: string; label: string; members: Array<{ label: string }> };
  expect(made).toMatchObject({ kind: 'SEG', label: 'Liver study', members: [{ label: 'Liver' }, { label: 'Tumour' }] });

  const row = panelOf(page).getByTestId(`container-row-${made.id}`);
  await expect(row).toContainText('Liver study');
  await expect(panelOf(page).locator('[data-testid="member-row-1"]')).toContainText('Liver');
  await expect(panelOf(page).locator('[data-testid="member-row-2"]')).toContainText('Tumour');
  await expect(panelOf(page).locator('[data-testid="member-row-1"]')).toHaveAttribute('data-active', 'true');
  expect(await probe(page, (p) => p.ext.annotations.active())).toMatchObject({ annotation: { id: made.id }, memberId: '1' });

  const structure = await probe(page, (p) => p.ext.annotations.create({ kind: 'RTSTRUCT', label: 'Targets', members: [{ label: 'GTV' }, { label: 'CTV' }] })) as { kind: string; members: Array<{ label: string }> };
  expect(structure).toMatchObject({ kind: 'RTSTRUCT', label: 'Targets', members: [{ label: 'GTV' }, { label: 'CTV' }] });
});

test('select() activates a member as a row click does', async ({ page }) => {
  const made = await probe(page, (p) => p.ext.annotations.create({ kind: 'SEG', members: [{ label: 'A' }, { label: 'B' }] })) as { id: string };
  await probe(page, (p, id) => p.ext.annotations.select(id, '2'), made.id);
  await expect(panelOf(page).locator('[data-testid="member-row-2"]')).toHaveAttribute('data-active', 'true');
  await expect(panelOf(page).locator('[data-testid="member-row-1"]')).not.toHaveAttribute('data-active', 'true');
  expect(await probe(page, (p, id) => p.ext.annotations.select(id, '9'), made.id)).toMatchObject({ error: expect.stringMatching(/no member 9/) });
});

async function paint(page: Page) {
  await page.evaluate(() => { const h = (window as unknown as Win).__XNAT_E2E__; h.setUnifiedBrushSize(25); h.setActiveUnifiedTool('Brush'); });
  const box = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - 20, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 20, cy + 20, { steps: 4 });
  await page.mouse.up();
}

test('save() is the panel\'s save: a version token on success, a conflict when the server changed', async ({ page }) => {
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.installMockXnatTransport());
  const made = await probe(page, (p) => p.ext.annotations.create({ kind: 'SEG', label: 'Saved by extension' })) as { id: string };
  await paint(page);
  const saved = await probe(page, (p, id) => p.ext.annotations.save(id), made.id) as { outcome: string; versionToken?: string };
  expect(saved.outcome).toBe('saved');
  expect(saved.versionToken).toBeTruthy();
  expect(saved.versionToken).toBe((await page.evaluate((id) => (window as unknown as Win).__XNAT_E2E__.getTransportEntry(id), made.id))?.versionToken);
  expect(await probe(page, (p, id) => p.ext.annotations.list().find((a: { id: string }) => a.id === id).versionToken, made.id)).toBe(saved.versionToken);

  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.injectTransportConflict());
  await paint(page);
  expect(await probe(page, (p, id) => p.ext.annotations.save(id), made.id)).toMatchObject({ outcome: 'conflict' });
});

test('an approved container is refused, as the panel refuses it', async ({ page }) => {
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.installMockXnatTransport());
  const made = await probe(page, (p) => p.ext.annotations.create({ kind: 'SEG', label: 'To approve' })) as { id: string };
  await panelOf(page).getByLabel('Approve').click();
  await page.getByRole('button', { name: 'Approve', exact: true }).last().click();
  await expect.poll(() => probe(page, (p, id) => p.ext.annotations.list().find((a: { id: string }) => a.id === id).approved, made.id)).toBe(true);
  expect(await probe(page, (p, id) => p.ext.annotations.save(id), made.id)).toMatchObject({ outcome: 'failed', reason: expect.stringMatching(/approved/) });
  // Selecting is not editing: still allowed, as a row click is.
  await probe(page, (p, id) => p.ext.annotations.select(id), made.id);
  expect(await probe(page, (p) => p.ext.annotations.active())).toMatchObject({ annotation: { id: made.id } });
});

test('openScan() of a scan the session does not have fails and says why', async ({ page }) => {
  // The offline harness's stand-in XNAT connection lists no scans; opening a real annotation
  // scan is the signed-in suite's (e2e/specs/auth/extension-xnat.e2e.ts).
  expect(await probe(page, (p) => p.ext.annotations.openScan({ projectId: 'P', subjectId: 'S', sessionId: 'E1' }, '3004')))
    .toEqual({ outcome: 'failed', reason: 'Session E1 has no scan 3004' });
});
