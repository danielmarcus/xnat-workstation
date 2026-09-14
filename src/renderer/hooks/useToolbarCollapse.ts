/**
 * useToolbarCollapse — how far the toolbar should collapse for the available width.
 *
 * Collapse levels (frozen toolbar §10 group order — viewer controls collapse from
 * least-essential to most-essential; the leftSlot, Layout/Hanging, Undo/Redo, Annotate
 * and Settings stay visible):
 *   0 = full (all labels + all groups inline)
 *   1 = text-collapsed (labels hidden on labeled buttons)
 *   2 = cine group collapsed
 *   3 = transform group collapsed
 *   4 = navigation group collapsed
 *
 * ── Calibrate once, then decide with a pure function ──────────────────────────────
 *
 * The level is a pure function of the toolbar's OUTER width, looked up in a table of
 * per-level widths that the toolbar MEASURES ABOUT ITSELF.
 *
 * Two properties matter, and the old design had neither:
 *
 *  1. **No feedback.** The input is the outer width, which collapsing cannot change.
 *     The previous version measured the centre content, but the right group (Annotate ·
 *     Tags · Settings) is 203px wide with labels and 119px without — so expanding handed
 *     84px back to the very region being measured. That oscillates by construction, and
 *     it is why dragging the window wider made labels flicker (~1480–1550px).
 *
 *  2. **Self-derived thresholds.** Calibration toggles the collapse attributes through
 *     every level and binary-searches the narrowest width that still renders intact, all
 *     synchronously with no paint in between. Add or remove a toolbar item and the
 *     numbers re-derive. A previous fix hardcoded them, which worked but went stale the
 *     moment the toolbar changed.
 *
 * The requirement per level is the narrowest width that still renders INTACT (binary
 * search on a clipping test), not the `max-content` width — max-content reports where
 * nothing is compressed at all, which for this toolbar overstated level 0 by ~500px.
 *
 * Calibration is only possible because collapse is CSS-driven (`data-text-collapsed` /
 * `data-collapsed-groups`, see globals.css): every level's content is always in the DOM.
 * While it was conditional rendering, a collapsed level's content did not exist and only
 * the level currently on screen could be measured.
 *
 * `scrollWidth` is never used: the centre content is a flex row whose children shrink, so
 * scrollWidth === clientWidth at every window size (900/900, 1480/1480, 1600/1600
 * measured). For the same reason `max-content` is not used either — see measureLevelWidths.
 */
import { useState, useLayoutEffect, useRef, useCallback, type RefObject } from 'react';

export const MAX_LEVEL = 4;

/** Groups folded away at each level, cumulative (level 3 also has cine collapsed). */
const GROUP_COLLAPSE_LEVELS: Record<string, number> = {
  cine: 2,
  transform: 3,
  navigation: 4,
};

/** The collapse attributes a given level puts on the toolbar root. */
export function attributesForLevel(level: number): { textCollapsed: boolean; collapsedGroups: string } {
  return {
    textCollapsed: level >= 1,
    collapsedGroups: Object.entries(GROUP_COLLAPSE_LEVELS)
      .filter(([, at]) => level >= at)
      .map(([id]) => id)
      .join(' '),
  };
}

export interface CollapseState {
  collapseLevel: number;
  textCollapsed: boolean;
  collapsedGroups: string;
  isGroupCollapsed: (groupId: string) => boolean;
}

/** Search bounds and the step the binary search resolves to. */
const SEARCH_FLOOR = 600;
const SEARCH_PRECISION = 16;
/**
 * Upper bound of the search. Deliberately a constant well beyond any real window rather
 * than the CURRENT width: using the current width as the ceiling meant a toolbar
 * calibrated in a narrow window could never discover that a level needs MORE than that
 * window, so it concluded everything fitted and never collapsed — items were then clipped
 * away by the content box's hidden overflow instead of folding into their dropdowns.
 */
const SEARCH_CEILING = 3000;

/**
 * Does the toolbar render intact at its current width — nothing clipped, nothing pushed
 * out of the overflow? This is the real fit test.
 */
function rendersIntact(root: HTMLElement, content: HTMLElement): boolean {
  for (const el of Array.from(content.querySelectorAll<HTMLElement>('*'))) {
    if (el.children.length) continue;
    if (!(el.textContent ?? '').trim()) continue;
    const box = el.getBoundingClientRect().width;
    const prev = el.getAttribute('style') ?? '';
    el.style.width = 'auto';
    el.style.maxWidth = 'none';
    el.style.overflow = 'visible';
    el.style.whiteSpace = 'nowrap';
    const needed = el.getBoundingClientRect().width;
    el.setAttribute('style', prev);
    if (needed > box + 0.5) return false;
  }
  // Anything pushed past the right edge of the (overflow-hidden) content box is cut off
  // without ever ellipsizing, so the text check alone would miss it. Take the RIGHTMOST
  // item: `button:last-of-type` looks like it would do this but does not — it matches the
  // first element that is the last button among ITS siblings, which for a nested toolbar
  // is an early button, so cut-off items went undetected and the toolbar under-collapsed.
  const contentRight = content.getBoundingClientRect().right;
  let rightmost = -Infinity;
  for (const el of Array.from(content.querySelectorAll<HTMLElement>('button'))) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue; // display:none (a collapsed group)
    if (r.right > rightmost) rightmost = r.right;
  }
  if (rightmost > contentRight + 0.5) return false;
  void root;
  return true;
}

/**
 * Width each level needs, widest (least collapsed) first.
 *
 * The requirement is the narrowest width at which the level still renders INTACT, found
 * by binary search. It is emphatically NOT the `max-content` width: this toolbar is a
 * flex row that compresses gracefully, so max-content reports the width at which nothing
 * is squeezed at all — measured, that was 1545px for level 0 while level 0 in fact
 * renders perfectly down to ~1050px. Calibrating on max-content therefore hid the labels
 * while ~500px of usable space sat visibly empty, and kept them hidden when the window
 * was widened again.
 *
 * ~6 probes per level, on mount and on content change only — never per frame. The style
 * is restored before returning, so nothing is painted mid-search.
 */
export function measureLevelWidths(root: HTMLElement): number[] {
  const content = root.querySelector<HTMLElement>('[data-toolbar-content]');
  if (!content) return [];

  const prevText = root.getAttribute('data-text-collapsed');
  const prevGroups = root.getAttribute('data-collapsed-groups');
  const prevWidth = root.style.width;

  const ceiling = SEARCH_CEILING;
  const widths: number[] = [];

  for (let level = 0; level <= MAX_LEVEL; level++) {
    const { textCollapsed, collapsedGroups } = attributesForLevel(level);
    root.setAttribute('data-text-collapsed', String(textCollapsed));
    root.setAttribute('data-collapsed-groups', collapsedGroups);

    let low = SEARCH_FLOOR;
    let high = Math.max(ceiling, SEARCH_FLOOR + SEARCH_PRECISION);
    root.style.width = `${high}px`;
    if (!rendersIntact(root, content)) {
      // Even at the ceiling it does not fit; nothing narrower will.
      widths[level] = high;
      continue;
    }
    while (high - low > SEARCH_PRECISION) {
      const mid = Math.floor((low + high) / 2);
      root.style.width = `${mid}px`;
      if (rendersIntact(root, content)) high = mid;
      else low = mid;
    }
    widths[level] = high;
  }

  root.style.width = prevWidth;
  if (prevText === null) root.removeAttribute('data-text-collapsed');
  else root.setAttribute('data-text-collapsed', prevText);
  if (prevGroups === null) root.removeAttribute('data-collapsed-groups');
  else root.setAttribute('data-collapsed-groups', prevGroups);

  return widths;
}

/**
 * The least-collapsed level whose measured width fits. Pure, and monotonic in `width`
 * as long as `levelWidths` is non-increasing — which it is by construction, since each
 * level removes content.
 *
 * A non-positive width means "not laid out yet" (first paint, a detached node, jsdom)
 * rather than "extremely narrow": assume full, so the toolbar does not flash fully
 * collapsed before its first measurement.
 */
export function levelForWidth(width: number, levelWidths: readonly number[]): number {
  if (!Number.isFinite(width) || width <= 0) return 0;
  if (levelWidths.length === 0) return 0;
  for (let level = 0; level <= MAX_LEVEL; level++) {
    const needed = levelWidths[level];
    if (needed == null || width >= needed) return level;
  }
  return MAX_LEVEL;
}

/**
 * @param containerRef the OUTER toolbar element — the one carrying the collapse
 * attributes. Its width must be independent of the collapse level; passing the centre
 * content re-introduces the feedback loop described above.
 */
export function useToolbarCollapse(containerRef: RefObject<HTMLDivElement | null>): CollapseState {
  const [collapseLevel, setCollapseLevel] = useState(0);
  const levelWidths = useRef<number[]>([]);
  const rafRef = useRef<number | null>(null);

  const update = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setCollapseLevel(levelForWidth(el.clientWidth, levelWidths.current));
  }, [containerRef]);

  const calibrate = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    levelWidths.current = measureLevelWidths(el);
    update();
  }, [containerRef, update]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    calibrate();

    const observer = new ResizeObserver(() => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(update);
    });
    observer.observe(el);

    // Re-calibrate when the toolbar's own content changes — a button added or removed, a
    // label re-worded, a font finishing loading. Attribute changes are ignored, because
    // applying a level is itself an attribute write and would otherwise re-enter.
    const mutations = new MutationObserver(() => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(calibrate);
    });
    mutations.observe(el, { childList: true, subtree: true, characterData: true });

    return () => {
      observer.disconnect();
      mutations.disconnect();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [containerRef, update, calibrate]);

  const { textCollapsed, collapsedGroups } = attributesForLevel(collapseLevel);

  const isGroupCollapsed = useCallback(
    (groupId: string): boolean => {
      const threshold = GROUP_COLLAPSE_LEVELS[groupId];
      return threshold != null && collapseLevel >= threshold;
    },
    [collapseLevel],
  );

  return { collapseLevel, textCollapsed, collapsedGroups, isGroupCollapsed };
}
