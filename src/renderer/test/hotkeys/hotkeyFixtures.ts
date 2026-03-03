import type { HotkeyAction, HotkeyMap } from '@shared/types/hotkeys';

export const HOTKEY_ACTIONS = {
  zoomIn: 'viewport.zoomIn',
  zoomOut: 'viewport.zoomOut',
  nextSlice: 'slice.next',
  toggleAnnotations: 'panel.toggleAnnotations',
  cycleViewport: 'panel.nextViewport',
} satisfies Record<string, HotkeyAction>;

export const TEST_HOTKEY_MAP: HotkeyMap = {
  [HOTKEY_ACTIONS.zoomIn]: [{ key: 'K', modifiers: { ctrl: true, shift: true } }],
  [HOTKEY_ACTIONS.zoomOut]: [{ key: '-' }],
  [HOTKEY_ACTIONS.nextSlice]: [{ key: 'ArrowDown' }, { key: 'PageDown' }],
  [HOTKEY_ACTIONS.toggleAnnotations]: [{ key: 'a' }],
  [HOTKEY_ACTIONS.cycleViewport]: [{ key: 'Tab' }],
};

export function resetHotkeyServiceToDefaultMap(
  setMap: (map: HotkeyMap) => void,
): void {
  setMap({});
}

export function installMap(
  setMap: (map: HotkeyMap) => void,
  map: HotkeyMap = TEST_HOTKEY_MAP,
): void {
  setMap(map);
}
