/**
 * Click a toolbox tool by its label, wherever it lives.
 *
 * Segmentation tools are grouped into families whose modes choose the tool
 * (annotation-panel-modes, 2026-10-28): "Threshold" is the Brush family with Limit =
 * Window and Kernel = 2D. A tool's former label is mapped to those clicks — the ones a
 * user makes — so specs keep naming the tool they mean. Other labels (a family, another
 * kind's tool, the ROI limit toggle) are clicked directly.
 */
import type { Locator } from '@playwright/test';

/** Former Segmentation tool label → [family, ...[mode group, option] in click order]. */
const SEG_TOOL_PATH: Record<string, [string, ...Array<[string, string]>]> = {
  Brush: ['Brush', ['Kernel', '2D'], ['Limit', 'None']],
  'Sph. Brush': ['Brush', ['Limit', 'None'], ['Kernel', '3D']],
  Threshold: ['Brush', ['Limit', 'Window'], ['Kernel', '2D']],
  'Sph. Thresh': ['Brush', ['Limit', 'Window'], ['Kernel', '3D']],
  'Dyn. Thresh': ['Brush', ['Limit', 'From click']],
  'Smart Brush': ['Brush', ['Limit', 'Edges']],
  'Paint Fill': ['Fill'],
  Circle: ['Shape', ['Limit', 'None'], ['Shape', 'Circle']],
  Rect: ['Shape', ['Limit', 'None'], ['Shape', 'Rect']],
  Sphere: ['Shape', ['Limit', 'None'], ['Shape', 'Sphere']],
  'Rect Threshold': ['Shape', ['Limit', 'Window'], ['Shape', 'Rect']],
  'Circle Threshold': ['Shape', ['Limit', 'Window'], ['Shape', 'Circle']],
  'Contour Fill': ['Contour'],
  Region: ['Region', ['Gesture', 'Drag']],
  'Region+': ['Region', ['Gesture', 'Click']],
  'Level Trace': ['Trace'],
};

export async function clickTool(scope: Locator, label: string): Promise<void> {
  const path = SEG_TOOL_PATH[label];
  const family = path && scope.getByTestId('toolbox-grid').getByRole('button', { name: path[0], exact: true });
  if (path && (await family!.isVisible())) {
    await family!.click();
    for (const [group, option] of path.slice(1) as Array<[string, string]>) {
      await scope
        .getByTestId('toolbox-controls')
        .getByRole('group', { name: group, exact: true })
        .getByRole('button', { name: option, exact: true })
        .click();
    }
    return;
  }
  const button = scope.getByRole('button', { name: label, exact: true }).first();
  if (await button.isVisible()) {
    await button.click();
    return;
  }
  throw new Error(`[clickTool] no tool labelled "${label}"`);
}

/** The family button a tool's label lives under (the label itself for a non-Segmentation tool). */
export function toolFamily(label: string): string {
  return SEG_TOOL_PATH[label]?.[0] ?? label;
}
