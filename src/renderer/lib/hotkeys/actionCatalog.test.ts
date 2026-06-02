import { describe, expect, it } from 'vitest';
import {
  ACTION_LABEL,
  ACTION_CATEGORY,
  CATEGORY_ORDER,
  actionsByCategory,
} from './actionCatalog';
import type { HotkeyAction } from '@shared/types/hotkeys';

describe('actionCatalog', () => {
  it('every action has a label', () => {
    for (const action of Object.keys(ACTION_CATEGORY) as HotkeyAction[]) {
      expect(ACTION_LABEL[action]).toBeTruthy();
    }
  });

  it('every action has a category that appears in CATEGORY_ORDER', () => {
    const known = new Set(CATEGORY_ORDER);
    for (const cat of Object.values(ACTION_CATEGORY)) {
      expect(known.has(cat)).toBe(true);
    }
  });

  it('label set === category set (no orphan actions on either side)', () => {
    expect(new Set(Object.keys(ACTION_LABEL))).toEqual(new Set(Object.keys(ACTION_CATEGORY)));
  });

  it('actionsByCategory groups every action; every category key exists', () => {
    const grouped = actionsByCategory();
    expect([...grouped.keys()]).toEqual([...CATEGORY_ORDER]);
    const total = [...grouped.values()].reduce((n, arr) => n + arr.length, 0);
    expect(total).toBe(Object.keys(ACTION_LABEL).length);
  });

  it('Tools / Editing tools / Viewport / Layout / Slice each have entries', () => {
    const grouped = actionsByCategory();
    for (const cat of ['Tools', 'Editing tools', 'Viewport', 'Layout', 'Slice'] as const) {
      expect(grouped.get(cat)!.length).toBeGreaterThan(0);
    }
  });
});
