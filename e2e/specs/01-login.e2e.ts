/**
 * Login Flow E2E Tests
 *
 * Tests the login form rendering, direct login, and browser popup login.
 * Each test gets its own Electron app instance since login tests mutate
 * auth state and can't share a single instance.
 */
import { test as base, _electron, expect } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { getE2EConfig, type E2EConfig } from '../helpers/env';
import path from 'path';

// Per-test Electron fixture (NOT worker-scoped — fresh app for each test)
const test = base.extend<{
  electronApp: Awaited<ReturnType<typeof _electron.launch>>;
  page: Awaited<ReturnType<Awaited<ReturnType<typeof _electron.launch>>['firstWindow']>>;
}>({
  electronApp: async ({}, use) => {
    const projectRoot = path.resolve(__dirname, '..', '..');
    const mainEntry = path.join(projectRoot, 'dist', 'main', 'main', 'index.js');
    const app = await _electron.launch({
      args: [mainEntry],
      cwd: projectRoot,
      env: { ...process.env, E2E_TESTING: '1', NODE_ENV: 'production' },
    });
    await use(app);
    // Force-kill to avoid hanging on modal dialogs during quit
    const pid = app.process().pid;
    try { if (pid) process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  },
  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await use(page);
  },
});

let config: E2EConfig;

test.describe('Login Flow', () => {
  test.beforeAll(() => { config = getE2EConfig(); });

  test('login form renders on launch', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await expect(loginPage.form).toBeVisible();
    await expect(loginPage.serverUrlInput).toBeVisible();
    await expect(loginPage.submitButton).toBeVisible();
    await expect(loginPage.submitButton).toHaveText('Sign In with XNAT');
  });

  test('empty URL disables submit button', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.serverUrlInput.fill('');
    await expect(loginPage.submitButton).toBeDisabled();
  });

  test('direct login authenticates and transitions to viewer', async ({ page }) => {
    const result = await page.evaluate(
      async ({ url, user, pass }) => {
        return (window as any).electronAPI.e2e.directLogin(url, user, pass);
      },
      { url: config.xnatUrl, user: config.xnatUser, pass: config.xnatPassword },
    );

    expect(result.success, `Login failed: ${result.error}`).toBe(true);

    // Reload so the connection store's startup checkSession() detects the session
    await page.reload({ waitUntil: 'domcontentloaded' });

    // Login form should disappear after the store transitions to 'connected'
    const loginPage = new LoginPage(page);
    await expect(loginPage.form).toBeHidden({ timeout: 30_000 });
  });

  test('browser login popup opens and authenticates', async ({ electronApp, page }) => {
    const loginPage = new LoginPage(page);

    // Enter the server URL
    await loginPage.enterServerUrl(config.xnatUrl);

    // Click Sign In — this triggers a popup BrowserWindow
    const popupPromise = electronApp.waitForEvent('window');
    await loginPage.clickSignIn();
    const popup = await popupPromise;

    // Wait for the XNAT login page to load in the popup
    await popup.waitForLoadState('domcontentloaded');

    // Fill in the XNAT login form
    // XNAT's default login page uses #user and #pass, but some versions
    // use #username and #password. Try both patterns.
    const usernameField =
      (await popup.locator('#username').count()) > 0
        ? popup.locator('#username')
        : popup.locator('#user');

    const passwordField =
      (await popup.locator('#password').count()) > 0
        ? popup.locator('#password')
        : popup.locator('#pass');

    await usernameField.fill(config.xnatUser);
    await passwordField.fill(config.xnatPassword);

    // Submit the form
    const submitBtn =
      (await popup.locator('#login_form input[type="submit"]').count()) > 0
        ? popup.locator('#login_form input[type="submit"]')
        : popup.locator('input[type="submit"], button[type="submit"]').first();

    await submitBtn.click();

    // The popup should close automatically after successful auth
    await popup.waitForEvent('close', { timeout: 30_000 });

    // Login form should disappear from the main window
    await expect(loginPage.form).toBeHidden({ timeout: 30_000 });
  });
});
