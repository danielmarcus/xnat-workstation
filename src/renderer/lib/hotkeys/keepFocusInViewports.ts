/**
 * Keep the keyboard in the viewports.
 *
 * The side panels — the XNAT browser and the annotations panel — are mouse-driven. They
 * have no keyboard navigation and are not meant to acquire the keyboard: a click on a scan
 * row or a member row should load or select the thing and leave the user working in the
 * image, not move their keyboard somewhere with nothing to do.
 *
 * Clicking a <button> focuses it, though, and that stranded focus has two consequences:
 *
 *  - Chrome starts drawing a focus ring on it the moment any keyboard interaction happens
 *    (:focus-visible is granted retroactively to the already-focused element), so an
 *    outline appears on a row clicked several actions ago. Reported as an outline showing
 *    up "very sporadically".
 *  - Space and Enter then re-activate that row rather than reaching the viewport, so a
 *    shortcut silently does the wrong thing.
 *
 * So focus is released after a click on a non-text control inside those panels. Text entry
 * is exempt — the scan filter, a rename field, a colour picker all need to keep the
 * keyboard while the user types into them.
 *
 * This is deliberately narrow. It does not make the panels keyboard-navigable; it makes
 * them not take the keyboard. A trial of full keyboard navigation (branch
 * `keyboard-navigation`, docs/keyboard-navigation-trial.md) moved focus between regions
 * and was rejected: focus leaving the viewports is the thing that frustrates.
 */
const PANEL_ROOTS = ['[data-testid="xnat-browser"]', '[data-testid="annotations-side-panel"]'];

/** Controls that legitimately hold the keyboard while the user types into them. */
function ownsKeyboard(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return (el as HTMLElement).isContentEditable === true;
}

function onPointerUp(e: Event): void {
  const target = e.target as HTMLElement | null;
  if (!target) return;
  if (!PANEL_ROOTS.some((sel) => target.closest(sel))) return;
  if (ownsKeyboard(target) || ownsKeyboard(document.activeElement)) return;

  // After the click has been dispatched, so nothing that reads document.activeElement
  // during its own handler sees it change underneath.
  queueMicrotask(() => {
    const active = document.activeElement as HTMLElement | null;
    if (!active || ownsKeyboard(active)) return;
    if (!PANEL_ROOTS.some((sel) => active.closest(sel))) return;
    active.blur();
  });
}

let installed = false;

export function installKeepFocusInViewports(): () => void {
  if (installed) return () => {};
  installed = true;
  document.addEventListener('pointerup', onPointerUp, true);
  return () => {
    document.removeEventListener('pointerup', onPointerUp, true);
    installed = false;
  };
}
