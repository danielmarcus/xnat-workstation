/**
 * LoginForm Page Object
 *
 * Wraps selectors and actions for the XNAT login screen.
 */
import type { Page } from '@playwright/test';

export class LoginPage {
  constructor(private page: Page) {}

  // ─── Locators ──────────────────────────────────────────────────

  get form() {
    return this.page.locator('[data-testid="login-form"]');
  }

  get serverUrlInput() {
    return this.page.locator('#serverUrl');
  }

  get submitButton() {
    return this.page.locator('[data-testid="login-submit"]');
  }

  get errorMessage() {
    return this.page.locator('.text-red-400');
  }

  get connectingSpinner() {
    return this.page.locator('.animate-spin');
  }

  // ─── Actions ───────────────────────────────────────────────────

  async enterServerUrl(url: string) {
    await this.serverUrlInput.fill(url);
  }

  async clickSignIn() {
    await this.submitButton.click();
  }

  async isVisible() {
    return this.form.isVisible();
  }
}
