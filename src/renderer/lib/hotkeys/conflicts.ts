/**
 * Hotkey conflict detection — spec §8.3 / §6.5.
 *
 * Given a candidate binding the user wants to apply to an action,
 * return every other action already bound to the same key+modifier
 * combo. Settings UI uses this to:
 *   1. Block the assignment until the conflicting binding is cleared.
 *   2. Show an inline warning listing the conflicting action(s).
 *   3. Offer a "Clear conflicting binding" button.
 *
 * Pure module — no React, no preferences-store reads. Caller passes
 * the effective merged map (DEFAULT_HOTKEY_MAP ∘ overrides) plus the
 * candidate binding + the action being remapped. Same-action matches
 * are filtered out (rebinding an action to its own existing key is
 * a no-op, not a conflict).
 */
import type {
  HotkeyAction,
  HotkeyBinding,
  HotkeyMap,
  HotkeyModifiers,
} from '@shared/types/hotkeys';

/**
 * Canonical token used for comparison. Stringifies key + each modifier
 * in a stable order so `Ctrl+Shift+Z` and `Shift+Ctrl+Z` collapse to
 * the same token.
 */
export function bindingToken(binding: HotkeyBinding): string {
  const m = binding.modifiers ?? {};
  return [
    binding.key,
    m.ctrl ? '1' : '0',
    m.shift ? '1' : '0',
    m.alt ? '1' : '0',
    m.meta ? '1' : '0',
  ].join('|');
}

function modifiersFromBinding(b: HotkeyBinding): Required<HotkeyModifiers> {
  const m = b.modifiers ?? {};
  return {
    ctrl: !!m.ctrl,
    shift: !!m.shift,
    alt: !!m.alt,
    meta: !!m.meta,
  };
}

/** Two bindings collide when their key + every modifier match. */
export function bindingsCollide(a: HotkeyBinding, b: HotkeyBinding): boolean {
  if (a.key !== b.key) return false;
  const ma = modifiersFromBinding(a);
  const mb = modifiersFromBinding(b);
  return ma.ctrl === mb.ctrl && ma.shift === mb.shift && ma.alt === mb.alt && ma.meta === mb.meta;
}

/**
 * Return every action in `map` already bound to a binding that
 * collides with `candidate`. The action currently being remapped
 * (`exceptAction`) is skipped so reapplying its existing binding
 * doesn't read as a conflict.
 *
 * Order is the iteration order of `map`'s keys (typically the
 * declaration order in `DEFAULT_HOTKEY_MAP`).
 */
export function findConflictingActions(
  map: HotkeyMap,
  candidate: HotkeyBinding,
  exceptAction: HotkeyAction | null,
): HotkeyAction[] {
  if (!candidate.key) return [];
  const out: HotkeyAction[] = [];
  for (const [action, bindings] of Object.entries(map) as [HotkeyAction, HotkeyBinding[] | undefined][]) {
    if (action === exceptAction) continue;
    if (!bindings) continue;
    if (bindings.some((b) => bindingsCollide(b, candidate))) {
      out.push(action);
    }
  }
  return out;
}
