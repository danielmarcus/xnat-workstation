/**
 * Open an operation from the Annotations panel's Operations row (SegWorks parity D1, as
 * amended 2026-10-12): pick it in the "Operation" picker, as a user does. Returns the
 * operation's body (e.g. `cleanup-sheet`), optionally with a Cleanup operation chosen.
 */
import { expect, type Locator } from '@playwright/test';

const BODY_TEST_ID = { Cleanup: 'cleanup-sheet', Interpolate: 'interpolate-sheet', Propagate: 'propagate-sheet', '3D QC': 'qc3d-sheet' } as const;

export async function openOperation(panel: Locator, name: keyof typeof BODY_TEST_ID, cleanupOp?: string): Promise<Locator> {
  await panel.getByLabel('Operation', { exact: true }).selectOption({ label: name });
  const sheet = panel.getByTestId(BODY_TEST_ID[name]);
  await expect(sheet).toBeVisible();
  if (cleanupOp) await sheet.getByLabel('Cleanup operation').selectOption({ label: cleanupOp });
  return sheet;
}
