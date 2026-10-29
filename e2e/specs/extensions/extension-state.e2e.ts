/**
 * App state, the channel and XNAT for extensions, offline (extension framework X3 —
 * docs/extension-framework.md, R4–R6). A probe extension hands its own `ext` to the spec, so
 * every call here goes through the real extension API: IPC to main, the main part, the stores.
 * The signed-in half (XNAT requests, opening a session, the unsaved-changes prompt) is
 * e2e/specs/auth/extension-xnat.e2e.ts.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures/electron-app';
import { loadFixture } from '../../helpers/local-fixture';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const edition = fs.mkdtempSync(path.join(os.tmpdir(), 'xnat-e2e-ext-state-'));
fs.cpSync(path.join(ROOT, 'e2e', 'fixtures', 'extensions', 'probe'), path.join(edition, 'probe'), { recursive: true });
test.use({ extensionsDir: edition });

type Probe = { ext: any; events: string[]; posts: unknown[] };
type Win = { __extProbe: Probe; __XNAT_E2E__: { clearAllContainers: () => void } };
/** Run `fn` in the page with the probe's ext; returns its result (or { error } if it rejected). */
const probe = <T,>(page: Page, fn: (p: Probe, arg: any) => T | Promise<T>, arg?: unknown) =>
  page.evaluate(async ({ src, arg }) => {
    const p = (window as unknown as Win).__extProbe;
    try { return await (0, eval)(`(${src})`)(p, arg); } catch (e) { return { error: (e as Error).message }; }
  }, { src: fn.toString(), arg });

test.beforeEach(async ({ page }) => {
  await expect.poll(() => page.evaluate(() => !!(window as unknown as Win).__extProbe)).toBe(true);
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers());
});

test('the channel: the renderer part asks its main part and gets its answer, errors included; main can post', async ({ page }) => {
  expect(await probe(page, (p) => p.ext.channel.request({ hello: 1 }))).toEqual({ echo: { hello: 1 } });
  expect(await probe(page, (p) => p.ext.channel.request({ op: 'throw' }))).toEqual({ error: 'main handler failed' });
  expect(await probe(page, (p) => p.ext.channel.request({ op: 'post', n: 7 }))).toBe('posted');
  await expect.poll(() => probe(page, (p) => p.posts)).toEqual([{ from: 'main', n: 7 }]);
});

test('signed out: no user in either part; XNAT calls and openSession say why', async ({ page }) => {
  expect(await probe(page, (p) => p.ext.xnat.user())).toBeNull();
  expect(await probe(page, (p) => p.ext.channel.request({ op: 'user' }))).toBeNull();
  expect(await probe(page, (p) => p.ext.xnat.request('/data/projects'))).toEqual({ error: 'Not signed in to XNAT' });
  expect(await probe(page, (p) => p.ext.channel.request({ op: 'getJson', path: '/data/projects' }))).toEqual({ error: 'Not signed in to XNAT' });
  expect(await probe(page, (p) => p.ext.xnat.request('https://evil.example/data/x'))).toMatchObject({ error: expect.stringMatching(/Not an XNAT path/) });
  expect(await probe(page, (p) => p.ext.viewer.openSession({ projectId: 'P', subjectId: 'S', sessionId: 'E1' })))
    .toEqual({ outcome: 'failed', reason: 'Not signed in to XNAT' });
  expect(await probe(page, (p) => p.ext.viewer.session())).toBeNull();
});

test('state and events follow the app: the active viewport, and annotations as the panel lists them', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await probe(page, (p) => { p.events.length = 0; });
  expect(await probe(page, (p) => p.ext.viewer.activeViewport())).toEqual({ id: 'panel_0' });

  // Create a segmentation through the panel, as a user does.
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  await expect.poll(() => probe(page, (p) => p.events)).toEqual(expect.arrayContaining(['annotationsChanged', 'activeAnnotationChanged']));
  const list = await probe(page, (p) => p.ext.annotations.list()) as Array<{ id: string; kind: string; members: unknown[] }>;
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({ kind: 'SEG', members: [expect.objectContaining({ id: expect.any(String) })] });
  expect(await probe(page, (p) => p.ext.annotations.active())).toMatchObject({ annotation: { id: list[0].id } });

  // In a 2×2 layout, Tab moves to the next viewport.
  await page.keyboard.press('4'); // layout.2x2
  await probe(page, (p) => { p.events.length = 0; });
  await page.keyboard.press('Tab');
  await expect.poll(() => probe(page, (p) => p.events)).toContain('activeViewportChanged');
  expect(await probe(page, (p) => p.ext.viewer.activeViewport())).not.toEqual({ id: 'panel_0' });
});
