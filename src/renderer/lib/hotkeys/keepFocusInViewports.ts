/**
 * Keep the keyboard in the viewports.
 *
 * The viewer chrome — the XNAT browser, the annotations panel and its toolbox, the
 * toolbar, the DICOM tags panel, the controls overlaid on a viewport — is mouse-driven.
 * None of it has keyboard navigation, and keyboard shortcuts are viewport-only, so a
 * click on a control should change the thing and leave the user working in the image,
 * not move their keyboard somewhere with nothing to do.
 *
 * Clicking a control focuses it, though — a <button>, and just the same a slider, a
 * checkbox or a dropdown — and that stranded focus has two consequences:
 *
 *  - Chrome starts drawing a focus ring on it the moment any keyboard interaction happens
 *    (:focus-visible is granted retroactively to the already-focused element), in the
 *    macOS system accent colour — an outline that is not part of the design, appearing on
 *    a control used several actions ago.
 *  - Keys reach the control instead of the viewport: Space and Enter re-press a button,
 *    and the arrow keys move a slider or cycle a dropdown rather than changing slice.
 *
 * So focus is released after a pointer interaction with any non-text control in the
 * chrome. Two things legitimately keep the keyboard and are exempt:
 *
 *  - Text entry (`isTextEntry`) — the scan filter, a rename field, a number box all need
 *    the keyboard while the user types into them.
 *  - Modal dialogs. They are keyboard surfaces of their own: one focuses its Cancel
 *    button on open, and Enter / Escape act on it. There is no viewport to return to.
 *
 * A dropdown or colour picker is released when its value is chosen (`change`), not on
 * the click that opens it — blurring it then would close the picker under the pointer.
 *
 * The display half is in globals.css (no focus outline on anything this releases); the
 * hotkey guard in hotkeyService uses `holdsKeyboard` so that a control which does hold
 * focus never swallows the shortcuts.
 *
 * This is deliberately narrow. It does not make the chrome keyboard-navigable; it makes it
 * not take the keyboard. A trial of full keyboard navigation (branch
 * `keyboard-navigation`, docs/keyboard-navigation-trial.md) moved focus between regions
 * and was rejected: focus leaving the viewports is the thing that frustrates.
 */

/** Surfaces that are keyboard-driven by design: modal dialogs. */
const KEYBOARD_SURFACES = '[role="dialog"], [aria-modal="true"]';

/** Where focus belongs: the viewports. The viewport element is focusable on purpose. */
const VIEWPORTS = '[data-testid^="unified-viewport"]';

/** <input> types the user types into. Everything else (range, checkbox, radio, color,
 *  button, file…) is a control that is clicked or dragged. */
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'password', 'url', 'tel', 'number']);

/** A field the user types into — the only kind of control that may keep the keyboard. */
export function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT') return TEXT_INPUT_TYPES.has((el as HTMLInputElement).type);
  return (el as HTMLElement).isContentEditable === true;
}

function inKeyboardSurface(el: Element | null): boolean {
  return !!el?.closest(KEYBOARD_SURFACES);
}

/**
 * Whether key presses on `el` belong to it rather than to the shortcuts: text entry
 * anywhere, and any form control inside a modal dialog.
 */
export function holdsKeyboard(el: Element | null): boolean {
  if (isTextEntry(el)) return true;
  const tag = el?.tagName;
  return (tag === 'INPUT' || tag === 'SELECT') && inKeyboardSurface(el);
}

/** Controls whose picker opens on the click and is released on `change` instead. */
function opensPicker(el: Element): boolean {
  return el.tagName === 'SELECT' || (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'color');
}

function releaseIfStranded(): void {
  const active = document.activeElement as HTMLElement | null;
  if (!active || active === document.body) return;
  if (active.closest(VIEWPORTS)) return;
  if (isTextEntry(active) || inKeyboardSurface(active)) return;
  active.blur();
}

function onPointerUp(e: Event): void {
  const target = e.target as HTMLElement | null;
  if (!target || target.closest(VIEWPORTS)) return;
  if (isTextEntry(target) || inKeyboardSurface(target)) return;
  const control = target.closest('select, input');
  if (control && opensPicker(control)) return;
  // After the click has been dispatched, so nothing that reads document.activeElement
  // during its own handler sees it change underneath.
  queueMicrotask(releaseIfStranded);
}

function onChange(e: Event): void {
  const target = e.target as HTMLElement | null;
  if (!target || isTextEntry(target) || inKeyboardSurface(target)) return;
  queueMicrotask(releaseIfStranded);
}

let installed = false;

export function installKeepFocusInViewports(): () => void {
  if (installed) return () => {};
  installed = true;
  document.addEventListener('pointerup', onPointerUp, true);
  document.addEventListener('change', onChange, true);
  return () => {
    document.removeEventListener('pointerup', onPointerUp, true);
    document.removeEventListener('change', onChange, true);
    installed = false;
  };
}
