/**
 * Click a toolbox tool by its label, wherever it lives.
 *
 * The Segmentation toolbox splits its tools over Paint · Shape · Smart tabs (SegWorks
 * parity D2), so a tool may not be on screen until its tab is chosen — exactly what a
 * user does. Tools pinned above the tabs, and the other kinds' toolboxes (no tabs), are
 * clicked directly.
 */
import type { Locator } from '@playwright/test';

export async function clickTool(scope: Locator, label: string): Promise<void> {
  const button = scope.getByRole('button', { name: label, exact: true });
  if (await button.isVisible()) {
    await button.click();
    return;
  }
  const tabs = scope.getByRole('tab');
  const n = await tabs.count();
  for (let i = 0; i < n; i++) {
    await tabs.nth(i).click();
    if (await button.isVisible()) {
      await button.click();
      return;
    }
  }
  throw new Error(`[clickTool] no tool labelled "${label}" in any toolbox tab`);
}
