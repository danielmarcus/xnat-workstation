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
 *     every level and reads the intrinsic width at each, in ONE synchronous pass with no
 *     paint in between. Add or remove a toolbar item and the numbers re-derive. A
 *     previous fix hardcoded them, which worked but went stale the moment the toolbar
 *     changed.
 *
 * Calibration is only possible because collapse is CSS-driven (`data-text-collapsed` /
 * `data-collapsed-groups`, see globals.css): every level's content is always in the DOM.
 * While it was conditional rendering, a collapsed level's content did not exist and only
 * the level currently on screen could be measured.
 *
 * `scrollWidth` is never used: the centre content is a flex row whose children shrink,
 * so scrollWidth === clientWidth at every window size (900/900, 1480/1480, 1600/1600
 * measured, while the true requirement at 900px was 988). Intrinsic width is read at
 * `max-content` instead.
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

/**
 * Width each level needs, widest (least collapsed) first. Measured by rendering the real
 * toolbar at every level and reading it at `max-content`; the style is restored before
 * the function returns, so nothing is painted mid-measurement.
 */
export function measureLevelWidths(root: HTMLElement): number[] {
  const prevText = root.getAttribute('data-text-collapsed');
  const prevGroups = root.getAttribute('data-collapsed-groups');
  const prevWidth = root.style.width;
  const prevOverflow = root.style.overflow;

  const widths: number[] = [];
  for (let level = 0; level <= MAX_LEVEL; level++) {
    const { textCollapsed, collapsedGroups } = attributesForLevel(level);
    root.setAttribute('data-text-collapsed', String(textCollapsed));
    root.setAttribute('data-collapsed-groups', collapsedGroups);
    root.style.width = 'max-content';
    root.style.overflow = 'visible';
    widths[level] = Math.ceil(root.getBoundingClientRect().width);
  }

  root.style.width = prevWidth;
  root.style.overflow = prevOverflow;
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
