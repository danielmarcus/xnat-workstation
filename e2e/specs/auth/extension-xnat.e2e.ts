/**
 * Extensions and XNAT, signed in (extension framework X3 — docs/extension-framework.md, R4–R5):
 * the probe extension's own `ext` makes every call — through IPC, the app's XNAT session, and its
 * main part — against the configured server. Read-only on the server: nothing is written there.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures/auth';
import { getE2EConfig } from '../../helpers/env';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const edition = fs.mkdtempSync(path.join(os.tmpdir(), 'xnat-e2e-ext-xnat-'));
fs.cpSync(path.join(ROOT, 'e2e', 'fixtures', 'extensions', 'probe'), path.join(edition, 'probe'), { recursive: true });
test.use({ extensionsDir: edition });

type Probe = { ext: any; events: string[]; posts: unknown[] };
type Win = { __extProbe: Probe; __pending?: Promise<unknown>; __XNAT_E2E__: { clearAllContainers: () => void; seedSessionContainer: (s: string, d: boolean) => Promise<string>; getSegmentationCount: () => number; getSegmentationViewportIds: (id: string) => string[] } };
const probe = <T,>(page: Page, fn: (p: Probe, arg: any) => T | Promise<T>, arg?: unknown) =>
  page.evaluate(async ({ src, arg }) => {
    const p = (window as unknown as Win).__extProbe;
    try { return await (0, eval)(`(${src})`)(p, arg); } catch (e) { return { error: (e as Error).message }; }
  }, { src: fn.toString(), arg });

const config = getE2EConfig();
const NO_PROJECT = 'XW_NO_SUCH_PROJECT_E2E';
type Rows = { ResultSet: { Result: Array<Record<string, string>> } };

/** The test session's accession id, found through ext.xnat (the env may give its label). */
async function testSessionId(page: Page): Promise<string> {
  const rows = await probe(page, (p, a) => p.ext.xnat.getJson(`/data/projects/${a.p}/subjects/${a.s}/experiments`), { p: config.testProject, s: config.testSubject }) as Rows;
  const row = rows.ResultSet.Result.find((r) => r.ID === config.testSession || r.label === config.testSession);
  if (!row) throw new Error(`test session ${config.testSession} not found`);
  return row.ID;
}

test.beforeEach(async ({ authenticatedPage: page }) => {
  await expect.poll(() => page.evaluate(() => !!(window as unknown as Win).__extProbe)).toBe(true);
});

test('user(): the signed-in user, in both parts', async ({ authenticatedPage: page }) => {
  const user = await probe(page, (p) => p.ext.xnat.user()) as { serverUrl: string; username: string };
  expect(user.username).toBe(config.xnatUsername);
  expect(user.serverUrl.replace(/\/+$/, '')).toBe(config.xnatUrl.replace(/\/+$/, ''));
  expect(await probe(page, (p) => p.ext.channel.request({ op: 'user' }))).toEqual(user);
});

test('requests as the user: JSON, HTTP errors as responses, permissions, resource files', async ({ authenticatedPage: page }) => {
  const project = await probe(page, (p, id) => p.ext.xnat.getJson(`/data/projects/${id}`), config.testProject) as { items?: unknown[] };
  expect(project.items?.length).toBeGreaterThan(0);
  const missing = await probe(page, (p, id) => p.ext.xnat.request(`/data/projects/${id}`), NO_PROJECT) as { ok: boolean; status: number };
  expect(missing.ok).toBe(false);
  expect([403, 404]).toContain(missing.status);
  // The main part's XNAT is the same session.
  expect(await probe(page, (p, id) => p.ext.channel.request({ op: 'getJson', path: `/data/projects/${id}` }), config.testProject)).toEqual(project);

  const perms = await probe(page, (p, id) => p.ext.xnat.permissions(id), config.testProject) as { read: boolean; write: boolean };
  expect(perms.read).toBe(true);
  expect(typeof perms.write).toBe('boolean');
  expect(await probe(page, (p, id) => p.ext.xnat.permissions(id), NO_PROJECT)).toEqual({ read: false, write: false });

  const id = await testSessionId(page);
  const scans = await probe(page, (p, e) => p.ext.xnat.getJson(`/data/experiments/${e}/scans`), id) as Rows;
  const scan = scans.ResultSet.Result[0].ID;
  const resources = await probe(page, (p, a) => p.ext.xnat.getJson(`/data/experiments/${a.e}/scans/${a.s}/resources`), { e: id, s: scan }) as Rows;
  const label = resources.ResultSet.Result[0].label;
  const files = await probe(page, (p, r) => p.ext.xnat.resourceFiles(r), `/data/experiments/${id}/scans/${scan}/resources/${label}`) as Array<{ name: string; size: number; uri: string }>;
  expect(files.length).toBeGreaterThan(0);
  expect(files[0]).toMatchObject({ name: expect.any(String), size: expect.any(Number), uri: expect.stringContaining(`/scans/${scan}/`) });
});

test('openSession() opens it the browser\'s way and reports opened; sessionChanged fires', async ({ authenticatedPage: page }) => {
  const id = await testSessionId(page);
  await probe(page, (p) => { p.events.length = 0; });
  const r = await probe(page, (p, a) => p.ext.viewer.openSession({ projectId: a.p, subjectId: a.s, sessionId: a.e }), { p: config.testProject, s: config.testSubject, e: id });
  expect(r).toEqual({ outcome: 'opened' });
  expect(await probe(page, (p) => p.ext.viewer.session())).toMatchObject({ projectId: config.testProject, sessionId: id });
  expect(await probe(page, (p) => p.events)).toContain('sessionChanged');
});

test('annotations.openScan() opens an annotation scan of the session, as clicking it does (X4)', async ({ authenticatedPage: page }) => {
  const id = await testSessionId(page);
  const scans = await probe(page, (p, e) => p.ext.xnat.getJson(`/data/experiments/${e}/scans`), id) as Rows;
  const annotation = scans.ResultSet.Result.find((r) => /^(SEG|RTSTRUCT|SR)$/i.test(r.type ?? '') || /seg|rtstruct|sr/i.test(r.xsiType ?? ''));
  test.skip(!annotation, 'the test session has no SEG / RTSTRUCT / SR scan');
  const ref = { projectId: config.testProject, subjectId: config.testSubject, sessionId: id };
  try {
    expect(await probe(page, (p, r) => p.ext.viewer.openSession(r), ref)).toEqual({ outcome: 'opened' });
    expect(await probe(page, (p, a) => p.ext.annotations.openScan(a.ref, a.scan), { ref, scan: annotation!.ID })).toEqual({ outcome: 'opened' });
    const listed = await probe(page, (p, scan) => p.ext.annotations.list().find((a: { xnatScanId?: string }) => a.xnatScanId === scan), annotation!.ID) as { versionToken?: string } | undefined;
    expect(listed).toBeTruthy();
  } finally {
    await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers());
  }
});

test('openSession() reports cancelled when the user cancels at the unsaved-changes prompt', async ({ authenticatedPage: page }) => {
  const id = await testSessionId(page);
  const all = await probe(page, (p, pr) => p.ext.xnat.getJson(`/data/projects/${pr}/experiments`), config.testProject) as Rows;
  const other = all.ResultSet.Result.find((r) => r.ID !== id && /SessionData$/i.test(r.xsiType ?? ''));
  test.skip(!other, 'the test project has no second image session');
  const otherSubject = await probe(page, (p, e) => p.ext.xnat.getJson(`/data/experiments/${e}`), other!.ID) as { items: Array<{ data_fields: { subject_ID: string } }> };

  if ((await probe(page, (p) => p.ext.viewer.session()?.sessionId)) !== id) {
    expect(await probe(page, (p, a) => p.ext.viewer.openSession({ projectId: a.p, subjectId: a.s, sessionId: a.e }), { p: config.testProject, s: config.testSubject, e: id })).toEqual({ outcome: 'opened' });
  }
  // 'opened' comes before the session's annotations finish auto-loading, and that load
  // detaches what is already on the viewport: seeded now, the work would be shown nowhere, and
  // a switch rightly does not prompt about work it takes from no viewport. Wait until the
  // auto-load has settled (the count holds for a second).
  let last = -1;
  let steady = 0;
  await expect.poll(async () => {
    const n = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getSegmentationCount());
    steady = n === last ? steady + 1 : 0;
    last = n;
    return steady >= 4;
  }, { intervals: [250], timeout: 30_000 }).toBe(true);
  // Unsaved work in this session (local only — nothing is saved to the server), on screen.
  const seeded = await page.evaluate((e) => (window as unknown as Win).__XNAT_E2E__.seedSessionContainer(e, true), id);
  await expect.poll(() => page.evaluate((s) => (window as unknown as Win).__XNAT_E2E__.getSegmentationViewportIds(s).length, seeded)).toBeGreaterThan(0);
  try {
    await page.evaluate((a) => {
      const w = window as unknown as Win;
      w.__pending = w.__extProbe.ext.viewer.openSession({ projectId: a.p, subjectId: a.s, sessionId: a.e });
    }, { p: config.testProject, s: otherSubject.items[0].data_fields.subject_ID, e: other!.ID });
    await page.getByRole('button', { name: 'Cancel' }).click();
    expect(await page.evaluate(() => (window as unknown as Win).__pending)).toEqual({ outcome: 'cancelled' });
    expect(await probe(page, (p) => p.ext.viewer.session()?.sessionId)).toBe(id);
  } finally {
    await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers());
  }
});
