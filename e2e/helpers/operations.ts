/**
 * Open an operation from the Annotations panel's Operations row (SegWorks parity D1, as
 * amended 2026-10-12): pick it in the "Operation" picker, as a user does. Returns the
 * operation's body (e.g. `cleanup-sheet`), optionally with a Cleanup operation chosen.
 */
import { expect, type Locator } from '@playwright/test';

const BODY_TEST_ID = { Cleanup: 'cleanup-sheet', Interpolate: 'interpolate-sheet', Propagate: 'propagate-sheet', 'Seeded segmentation': 'seeded-sheet', 'Region competition': 'region-sheet', '3D QC': 'qc3d-sheet' } as const;

export async function openOperation(panel: Locator, name: keyof typeof BODY_TEST_ID, cleanupOp?: string): Promise<Locator> {
  await panel.getByLabel('Operation', { exact: true }).selectOption({ label: name });
  const sheet = panel.getByTestId(BODY_TEST_ID[name]);
  await expect(sheet).toBeVisible();
  if (cleanupOp) await sheet.getByLabel('Cleanup operation').selectOption({ label: cleanupOp });
  return sheet;
}

/**
 * Move a slider (an operation's number parameter) to a value — as dragging it does: the value set
 * through the element's own setter, then the `input` event React's onChange listens to. (A slider
 * cannot be typed into, and the arrow keys belong to the viewport.)
 */
export async function setSlider(slider: Locator, value: number): Promise<void> {
  await slider.evaluate((el, v) => {
    const input = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String(v));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  await expect(slider).toHaveValue(String(value));
}
