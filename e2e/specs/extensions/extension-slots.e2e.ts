/**
 * Extension UI slots (extension framework X2 — docs/extension-framework.md, wireframes E1–E7),
 * filled by the example extension (Session notes, built from TSX against the SDK) and by a
 * fixture whose tab throws and whose command asks for a key the app uses. Every slot is driven
 * through the real UI: tabs, toolbar, popover, view, Settings, keys and ⌘K.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures/electron-app';
import { enterLocalViewer, loadFixture } from '../../helpers/local-fixture';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const edition = fs.mkdtempSync(path.join(os.tmpdir(), 'xnat-e2e-ext-slots-'));
fs.cpSync(path.join(ROOT, 'dist', 'extensions', 'examples', 'session-notes'), path.join(edition, 'session-notes'), { recursive: true });
fs.cpSync(path.join(ROOT, 'e2e', 'fixtures', 'extensions', 'ui-throws'), path.join(edition, 'ui-throws'), { recursive: true });
test.use({ extensionsDir: edition });

const NOTES = 'org.xnat.examples.session-notes';
const FAULTY = 'org.xnat.e2e.ui-throws';

type Win = { __XNAT_E2E__: { clearAllContainers: () => void } };
test.beforeEach(async ({ page }) => {
  await page.evaluate(() => { try { localStorage.removeItem('xnat.sidebar.tab'); } catch { /* */ } });
  await page.reload({ waitUntil: 'load' });
  await enterLocalViewer(page);
});

const sidebarTab = (page: Page, name: string) => page.getByRole('tablist', { name: 'Sidebar' }).getByRole('tab', { name, exact: true });
const notesItem = (page: Page) => page.getByTestId(`extension-toolbar-item-${NOTES}`);

async function addNote(page: Page, text: string) {
  await sidebarTab(page, 'Notes').click();
  await page.getByTestId(`extension-sidebar-tab-${NOTES}`).getByRole('button', { name: '+ Add note' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add note' });
  await dialog.getByLabel('Note').fill(text);
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function openSettings(page: Page) {
  await page.getByTitle('Open settings').click();
  return page.getByRole('dialog', { name: 'Settings' });
}

test('E1 · the sidebar gets a tab per extension beside Browse; the choice is remembered', async ({ page }) => {
  const tabs = page.getByRole('tablist', { name: 'Sidebar' }).getByRole('tab');
  await expect(tabs).toHaveText(['Browse', 'Notes', 'Faulty']); // in the edition's order
  await expect(sidebarTab(page, 'Browse')).toHaveAttribute('aria-selected', 'true');
  await addNote(page, 'Motion on slices 40–44');
  const tab = page.getByTestId(`extension-sidebar-tab-${NOTES}`);
  await expect(tab).toContainText('1 note');
  await expect(tab.getByTestId('notes-session')).toHaveText('No XNAT session open'); // local files: no XNAT session (X3)
  await expect(tab).toContainText('Motion on slices 40–44');

  await page.reload({ waitUntil: 'load' });
  await enterLocalViewer(page);
  await expect(sidebarTab(page, 'Notes')).toHaveAttribute('aria-selected', 'true');
});

test('E2 + E3 · the toolbar item shows the count and its popover opens the full-window view; Back or Esc returns', async ({ page }) => {
  await addNote(page, 'Check left hippocampus');
  await expect(notesItem(page)).toContainText('1 note');
  await notesItem(page).getByRole('button', { name: /1 note \(Session notes\)/ }).click();
  const popover = page.getByTestId('extension-toolbar-popover');
  await expect(popover).toContainText('1 note');
  await popover.getByRole('button', { name: 'All notes…' }).click();

  const view = page.getByTestId('extension-view');
  await expect(view).toContainText('All notes');
  await expect(view).toContainText('· Session notes');
  await expect(view.locator('table')).toContainText('Check left hippocampus');
  // The viewer's toolbar controls are greyed and inert while the view covers the viewer.
  const firstViewerControl = page.locator('[data-viewer-controls-start] ~ *').first();
  await expect(firstViewerControl).toHaveCSS('opacity', '0.4');
  await expect(firstViewerControl).toHaveCSS('pointer-events', 'none');

  await expect(page.getByTestId('extension-toolbar-popover')).toHaveCount(0); // closed by opening the view
  await page.keyboard.press('Escape');
  await expect(view).toHaveCount(0);
  await expect(firstViewerControl).toHaveCSS('opacity', '1');

  await notesItem(page).getByRole('button', { name: /1 note \(Session notes\)/ }).click();
  await page.getByTestId('extension-toolbar-popover').getByRole('button', { name: 'All notes…' }).click();
  await view.getByRole('button', { name: '← Back to viewer' }).click();
  await expect(view).toHaveCount(0);
});

test('E4 · the extension\'s Settings page is nested under Extensions and changes the extension', async ({ page }) => {
  await expect(notesItem(page)).toBeVisible();
  const settings = await openSettings(page);
  await settings.getByRole('button', { name: 'Extensions', exact: true }).click();
  await settings.getByTestId(`extension-row-${NOTES}`).getByRole('button', { name: 'Settings…' }).click();
  const pageEl = settings.getByTestId(`extension-settings-page-${NOTES}`);
  await expect(pageEl).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Session notes', exact: true })).toBeVisible(); // nested in the list
  await pageEl.getByLabel('Show the note count in the toolbar').uncheck();
  await expect(notesItem(page)).toHaveCount(0);
  await pageEl.getByLabel('Show the note count in the toolbar').check();
  await expect(notesItem(page)).toBeVisible();
});

test('E6 · keys: N / ⇧N run the extension\'s commands; they are listed, remappable, and a clash leaves the app\'s key alone', async ({ page }) => {
  await addNote(page, 'first');
  await addNote(page, 'second'); // newest first, and selected
  const selected = page.getByTestId(`extension-sidebar-tab-${NOTES}`).locator('[data-note-selected="true"]');
  await expect(selected).toContainText('second');
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press('n');
  await expect(selected).toContainText('first');
  await page.keyboard.press('Shift+N');
  await expect(selected).toContainText('second');

  const settings = await openSettings(page);
  await settings.getByRole('button', { name: 'Hotkeys', exact: true }).click();
  const action = settings.getByRole('combobox').first();
  await expect(action.locator('option', { hasText: 'Session notes: Next note' })).toHaveCount(1);
  await action.selectOption({ label: 'Faulty: Grab W' });
  await expect(settings.getByTestId('hotkey-extension-clash')).toContainText('Asked for w');
  await action.selectOption({ label: 'Session notes: Next note' });
  await settings.getByPlaceholder('e.g. w, Escape, Space').fill('j');
  await settings.getByRole('button', { name: 'Set Override' }).click();
  await settings.getByTitle('Close', { exact: true }).click();

  await page.keyboard.press('j');
  await expect(selected).toContainText('first');
  await page.keyboard.press('n'); // remapped away
  await expect(selected).toContainText('first');

  const s2 = await openSettings(page);
  await s2.getByRole('button', { name: 'Hotkeys', exact: true }).click();
  await s2.getByRole('button', { name: 'Reset Hotkeys' }).click();
  await s2.getByTitle('Close', { exact: true }).click();
});

test('E6 · ⌘K lists the extension\'s commands, named with it; picking one runs it', async ({ page }) => {
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers());
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+k');
  const finder = page.getByRole('dialog', { name: 'Find a tool or operation' });
  await page.keyboard.type('all notes');
  await expect(finder.getByRole('option').first()).toContainText('Open All notes');
  await expect(finder.getByRole('option').first()).toContainText('Session notes');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('extension-view')).toContainText('All notes');
  await page.keyboard.press('Escape');
});

test('E7 · a slot that throws shows the error in place; the rest of the app and the other extension carry on', async ({ page }) => {
  await sidebarTab(page, 'Faulty').click();
  const card = page.getByTestId(`extension-sidebar-tab-${FAULTY}`).getByTestId('extension-slot-error');
  await expect(card).toContainText('Faulty stopped working.');
  await expect(card).toContainText('tab boom');
  await expect(card.getByRole('button', { name: 'Reload extension' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Copy details' })).toBeVisible();
  // The other extension and the app are unaffected.
  await addNote(page, 'still works');
  await expect(notesItem(page)).toContainText('1 note');
});

test('disabling an extension removes every slot, command and key it added; enabling brings them back', async ({ page }) => {
  await expect(sidebarTab(page, 'Notes')).toBeVisible();
  await expect(notesItem(page)).toBeVisible();
  const settings = await openSettings(page);
  await settings.getByRole('button', { name: 'Extensions', exact: true }).click();
  const row = settings.getByTestId(`extension-row-${NOTES}`);
  await row.getByLabel('Enable Session notes').click();
  await expect(row.getByTestId('extension-state')).toHaveText('Disabled');
  await expect(settings.getByRole('button', { name: 'Session notes', exact: true })).toHaveCount(0); // its page is gone
  await settings.getByRole('button', { name: 'Hotkeys', exact: true }).click();
  await expect(settings.getByRole('combobox').first().locator('option', { hasText: 'Session notes:' })).toHaveCount(0);
  await settings.getByTitle('Close', { exact: true }).click();
  await expect(sidebarTab(page, 'Notes')).toHaveCount(0);
  await expect(notesItem(page)).toHaveCount(0);

  const s2 = await openSettings(page);
  await s2.getByRole('button', { name: 'Extensions', exact: true }).click();
  await s2.getByTestId(`extension-row-${NOTES}`).getByLabel('Enable Session notes').click();
  await expect(s2.getByTestId(`extension-row-${NOTES}`).getByTestId('extension-state')).toHaveText('Active');
  await s2.getByTitle('Close', { exact: true }).click();
  await expect(sidebarTab(page, 'Notes')).toBeVisible();
  await expect(notesItem(page)).toBeVisible();
});
