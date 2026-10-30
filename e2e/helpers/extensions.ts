/**
 * Extensions in E2E (docs/extension-framework.md): reach a running extension's own `ext` (the
 * host lists them under a test harness), and give the example extension a demonstration
 * licence through its own import path — renderer part → its main part, which verifies the
 * signature and keeps it in secure storage.
 */
import type { Page } from '@playwright/test';
import { demoLicence, BASIC, PRO } from '../../extensions/examples/session-notes/e2e/demoLicence';

export { demoLicence, BASIC, PRO };
export const NOTES = 'org.xnat.examples.session-notes';

type Ext = { channel: { request(m: unknown): Promise<unknown> }; storage: { keys(): Promise<string[]>; delete(k: string): Promise<void> } };
type Win = { __xnatWorkstationExtensions?: Record<string, Ext> };

export async function waitForExtension(page: Page, id: string): Promise<void> {
  await page.waitForFunction((x) => !!(window as unknown as Win).__xnatWorkstationExtensions?.[x], id);
}

/** Install a licence in Session notes, as its Settings page's import does (minus the dialog). */
export async function installLicence(page: Page, text: string): Promise<void> {
  await waitForExtension(page, NOTES);
  await page.evaluate(({ id, text }) => (window as unknown as Win).__xnatWorkstationExtensions![id].channel.request({ op: 'install-licence', text }), { id: NOTES, text });
}

export async function removeLicence(page: Page): Promise<void> {
  await waitForExtension(page, NOTES);
  await page.evaluate((id) => (window as unknown as Win).__xnatWorkstationExtensions![id].channel.request({ op: 'remove-licence' }), NOTES);
}

/** Session notes with every feature: a Pro licence. */
export const installPro = (page: Page) => installLicence(page, demoLicence({ tier: 'Pro', features: PRO }));
