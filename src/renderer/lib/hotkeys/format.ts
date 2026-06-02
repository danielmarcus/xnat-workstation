/**
 * Hotkey display formatter — turns `HotkeyBinding` values into the
 * compact strings shown in tooltips and the cheatsheet. Spec §3.11 /
 * §6.3 / §6.4.
 *
 * Conventions:
 * - Modifier order: Ctrl/Meta → Alt → Shift → key (matches macOS HIG
 *   for combined Cmd+Shift+letter; on non-Mac the same order reads
 *   left-to-right naturally).
 * - Meta is rendered as ⌘ on macOS, "Ctrl" on Windows/Linux to match
 *   the host platform. Plain Ctrl always reads as "Ctrl".
 * - Shift → ⇧, Alt/Option → ⌥, Ctrl → Ctrl, Meta → ⌘ (mac) / Ctrl
 *   (non-mac).
 * - Special key names ("ArrowUp", "Escape", "Tab", " ", etc.) are
 *   normalised to the symbols / words the user expects ("↑", "Esc",
 *   "Tab", "Space").
 * - Letter keys are uppercased.
 *
 * Pure functions — no React, no DOM. The React hook that reads from
 * the preferences store lives in `useBindingLabel.ts`.
 */
import type {
  HotkeyAction,
  HotkeyBinding,
  HotkeyMap,
} from '@shared/types/hotkeys';

/**
 * Detect macOS at module load. `navigator` is only defined in the
 * renderer, so callers in tests can override by stubbing `navigator`
 * before importing. Test override: pass `isMac` to `formatBinding`.
 */
function detectMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = navigator.platform ?? '';
  if (platform) return /Mac|iPhone|iPad/i.test(platform);
  const ua = navigator.userAgent ?? '';
  return /Mac|iPhone|iPad/i.test(ua);
}

/** Canonical display string for a single special key. */
const SPECIAL_KEY_LABELS: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
  ' ': 'Space',
  Enter: '⏎',
  Backspace: '⌫',
  Delete: 'Del',
  Tab: 'Tab',
  Home: 'Home',
  End: 'End',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
};

/**
 * Format a single binding for display. Returns "" for an empty
 * binding (no key). The optional `isMac` override exists for tests
 * that want to assert both platforms without monkey-patching
 * `navigator`.
 */
export function formatBinding(binding: HotkeyBinding | null | undefined, isMac?: boolean): string {
  if (!binding || !binding.key) return '';
  const mac = isMac ?? detectMac();
  const parts: string[] = [];
  const mods = binding.modifiers ?? {};
  if (mods.ctrl) parts.push('Ctrl');
  if (mods.meta) parts.push(mac ? '⌘' : 'Ctrl');
  if (mods.alt) parts.push(mac ? '⌥' : 'Alt');
  if (mods.shift) parts.push('⇧');
  parts.push(formatKey(binding.key));
  return parts.join(mac ? '' : '+');
}

/** Display label for the key portion (without modifiers). */
export function formatKey(key: string): string {
  if (key in SPECIAL_KEY_LABELS) return SPECIAL_KEY_LABELS[key];
  if (key.length === 1) return key.toUpperCase();
  // Function keys ("F1") and any other multi-char key — return as-is.
  return key;
}

/**
 * Format the first binding for a given action against a map. Returns
 * "" when the action has no bindings (or the action is missing).
 * This is the canonical "tooltip suffix" generator.
 */
export function formatActionBinding(
  action: HotkeyAction,
  map: HotkeyMap,
  isMac?: boolean,
): string {
  const bindings = map[action];
  if (!bindings || bindings.length === 0) return '';
  return formatBinding(bindings[0], isMac);
}

/**
 * Wrap a tooltip text with the action's binding in parentheses.
 *
 *   suffixTooltip("Brush", "tool.brush", map) // → "Brush (B)"
 *   suffixTooltip("Settings", "no.such.action", map) // → "Settings"
 */
export function suffixTooltip(
  text: string,
  action: HotkeyAction,
  map: HotkeyMap,
  isMac?: boolean,
): string {
  const label = formatActionBinding(action, map, isMac);
  return label ? `${text} (${label})` : text;
}
