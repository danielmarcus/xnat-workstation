/**
 * xnat-workstation:// links (docs/open-from-link.md), offline, on the login screen.
 *
 * The OS's delivery is replaced by emitting the event it raises (`open-url`, macOS) in the
 * main process; everything after that is the real path: main's validation, the IPC hand-off,
 * the renderer's dialog and sign-in. Sign-in goes to http://127.0.0.1:1, a port Chromium refuses,
 * so XNAT's login window fails to load and is never shown — the same state as a user closing it.
 *
 * NOT covered: OS registration (needs a packaged, installed app) and opening a session after a
 * successful sign-in (needs a live XNAT; unit-tested in hooks/useOpenLink.test.ts).
 */
import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect } from '../../fixtures/electron-app';

const link = (server: string) =>
  `xnat-workstation://open?${new URLSearchParams({ server, project: 'P1', session: 'XNAT_E00012', scan: '4' })}`;
const UNKNOWN = 'https://xnat.example.org';
const NOTHING_LISTENING = 'http://127.0.0.1:1';

async function openLink(electronApp: ElectronApplication, url: string): Promise<void> {
  await electronApp.evaluate(({ app }, u) => {
    app.emit('open-url', { preventDefault: () => {} }, u);
  }, url);
}

async function onLoginScreen(page: Page): Promise<void> {
  await expect(page.getByTestId('login-form')).toBeVisible();
}

test.describe('open from a link', () => {
  test('a server never connected to: asks first, naming it; an invalid link before it does nothing; Cancel changes nothing', async ({ electronApp, page }) => {
    await onLoginScreen(page);
    const server = page.getByLabel('Server');
    const before = await server.inputValue();

    await openLink(electronApp, link('http://evil.example.org'));
    await openLink(electronApp, link(UNKNOWN));

    const dialog = page.getByRole('dialog', { name: `Open a session from ${UNKNOWN}?` });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(`You have not connected to ${UNKNOWN} before`);
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await page.screenshot({ path: test.info().outputPath('unknown-server-dialog.png') });

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('login-link-hint')).toHaveCount(0);
    await expect(server).toHaveValue(before);
    await expect(page.getByTestId('login-error')).toHaveCount(0);
  });

  test('Open: sign-in to the link\'s server starts, and when it does not complete the login screen keeps that server', async ({ electronApp, page }) => {
    await onLoginScreen(page);
    await openLink(electronApp, link(NOTHING_LISTENING));

    const dialog = page.getByRole('dialog', { name: `Open a session from ${NOTHING_LISTENING}?` });
    await dialog.getByRole('button', { name: 'Open' }).click();

    await expect(page.getByTestId('login-error')).toContainText('Failed to load login page');
    await expect(page.getByLabel('Server')).toHaveValue(NOTHING_LISTENING);
    await expect(page.getByTestId('login-link-hint')).toHaveText('Sign in to open the linked session.');
    await page.screenshot({ path: test.info().outputPath('sign-in-prefilled.png') });
  });

  test('a server connected to before: sign-in starts without asking', async ({ electronApp, page }) => {
    await onLoginScreen(page);
    await page.evaluate((s) => {
      localStorage.setItem('xnat-viewer:recent-connections', JSON.stringify([{ serverUrl: s, lastUsed: Date.now() }]));
    }, NOTHING_LISTENING);

    await openLink(electronApp, link(NOTHING_LISTENING));

    // The attempt only happens past the dialog, so its error with no dialog shown means none was needed.
    await expect(page.getByTestId('login-error')).toContainText('Failed to load login page');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByLabel('Server')).toHaveValue(NOTHING_LISTENING);
  });
});
