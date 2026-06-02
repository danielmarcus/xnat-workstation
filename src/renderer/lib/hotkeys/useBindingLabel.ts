/**
 * React hooks that surface live hotkey bindings to the UI.
 * Spec §3.11 / §6.4 — tooltips auto-update when the user remaps.
 *
 * Source of truth: the merge of `DEFAULT_HOTKEY_MAP` with
 * `preferences.hotkeys.overrides` (per-action override). The hooks
 * subscribe to the preferences store so any remap propagates without
 * a refresh.
 */
import { useMemo } from 'react';
import { DEFAULT_HOTKEY_MAP } from './defaultHotkeyMap';
import {
  formatActionBinding,
  suffixTooltip as suffixTooltipPure,
} from './format';
import { usePreferencesStore } from '../../stores/preferencesStore';
import type { HotkeyAction, HotkeyMap } from '@shared/types/hotkeys';

/**
 * Subscribe to the live merged hotkey map. Re-renders whenever a
 * user remap lands in `preferences.hotkeys.overrides`.
 */
export function useHotkeyMap(): HotkeyMap {
  const overrides = usePreferencesStore((s) => s.preferences.hotkeys.overrides);
  return useMemo(
    () => mergeHotkeyMap(DEFAULT_HOTKEY_MAP, overrides),
    [overrides],
  );
}

/**
 * First-binding display label for an action, live.
 * `Brush` → "B", `edit.undo` (mac) → "⌘Z", and so on.
 */
export function useBindingLabel(action: HotkeyAction): string {
  const map = useHotkeyMap();
  return formatActionBinding(action, map);
}

/**
 * Tooltip helper — appends "(label)" when a binding exists.
 * Returns the bare text otherwise.
 */
export function useSuffixedTooltip(text: string, action: HotkeyAction): string {
  const map = useHotkeyMap();
  return suffixTooltipPure(text, action, map);
}

/**
 * Merge per-action override arrays on top of a base map. An override
 * with an empty array `[]` is treated as "cleared" (the action has
 * no binding).
 */
export function mergeHotkeyMap(base: HotkeyMap, overrides: HotkeyMap): HotkeyMap {
  // Cast-shaped iteration so TS understands the action key.
  const result: HotkeyMap = { ...base };
  for (const [action, bindings] of Object.entries(overrides) as [HotkeyAction, HotkeyMap[HotkeyAction]][]) {
    result[action] = bindings;
  }
  return result;
}
