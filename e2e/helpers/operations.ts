/**
 * Pick an operation in the Annotations panel's grouped Operation menu (R4-A,
 * annotation-panel-modes): the Operation button, then the item — as a user does.
 */
export async function pickOperation(panel: Locator, label: string): Promise<void> {
  await panel.getByRole('button', { name: 'Operation', exact: true }).click();
  await panel.getByRole('menu', { name: 'Operations' }).getByRole('menuitem', { name: label, exact: true }).click();
}

/** The items under one heading of the Operation menu (opened to read, then closed). */
export async function operationGroupItems(panel: Locator, group: string): Promise<string[]> {
  await panel.getByRole('button', { name: 'Operation', exact: true }).click();
  const menu = panel.getByRole('menu', { name: 'Operations' });
  await expect(menu).toBeVisible();
  const items = await menu.getByRole('group', { name: group, exact: true }).getByRole('menuitem').allTextContents();
  await panel.page().keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  return items;
}

/**
 * Open an operation from the Annotations panel's operation drawer: pick it in the grouped
 * Operation menu, as a user does. Returns the operation's body (e.g. `cleanup-sheet`),
 * optionally with a Cleanup operation chosen.
 */
import { expect, type Locator } from '@playwright/test';

const BODY_TEST_ID = { Cleanup: 'cleanup-sheet', Interpolate: 'interpolate-sheet', Propagate: 'propagate-sheet', 'Seeded segmentation': 'seeded-sheet', 'Region competition': 'region-sheet', '3D QC': 'qc3d-sheet' } as const;

export async function openOperation(panel: Locator, name: keyof typeof BODY_TEST_ID, cleanupOp?: string): Promise<Locator> {
  await pickOperation(panel, name);
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

/**
 * Every slider in an operation's body sits where its number says: a range input snaps its value
 * to min + k·step, so a default off that grid puts the thumb (the DOM value) at another number
 * than the one the row prints and the operation runs with.
 */
export async function expectSlidersOnTheirValues(body: Locator): Promise<void> {
  const rows = await body.locator('input[type="range"]').evaluateAll((els) => els.map((el) => {
    const input = el as HTMLInputElement;
    return { label: input.getAttribute('aria-label'), thumb: input.value, shown: input.nextElementSibling?.textContent ?? '' };
  }));
  expect(rows.length).toBeGreaterThan(0);
  for (const r of rows) expect(Number(r.thumb), `${r.label}: thumb at ${r.thumb}, row shows "${r.shown}"`).toBeCloseTo(parseFloat(r.shown), 9);
}
