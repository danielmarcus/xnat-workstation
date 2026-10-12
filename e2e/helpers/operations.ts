/**
 * Open an operation from the Annotations panel's Operations row (SegWorks parity D1, as
 * amended 2026-10-12): pick it in the "Operation" picker, as a user does. Returns the
 * operation's body (`cleanup-sheet`), optionally with a Cleanup operation chosen.
 */
import { expect, type Locator } from '@playwright/test';

export async function openOperation(panel: Locator, name: 'Cleanup', cleanupOp?: string): Promise<Locator> {
  await panel.getByLabel('Operation', { exact: true }).selectOption({ label: name });
  const sheet = panel.getByTestId('cleanup-sheet');
  await expect(sheet).toBeVisible();
  if (cleanupOp) await sheet.getByLabel('Cleanup operation').selectOption({ label: cleanupOp });
  return sheet;
}
