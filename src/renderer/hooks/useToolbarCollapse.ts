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
 * ── Why this is a lookup and not a measure-and-react loop ──────────────────────────
 *
 * It used to measure the centre content's `scrollWidth` against its `clientWidth`,
 * collapse a level on overflow, and store the overflowing width as the threshold to
 * expand back at. That flickered while dragging the window wider: labels appeared, then
 * vanished, then appeared again (~1480–1550px).
 *
 * Two measured reasons, both fatal to that design:
 *
 *  1. `scrollWidth` could never report overflow. The centre content is a flex row whose
 *     children shrink, so `scrollWidth === clientWidth` at every window size (900/900,
 *     1480/1480, 1600/1600 — while the true requirement at 900px was 988). The overflow
 *     test was structurally blind, so collapse ran on transient mid-layout numbers and
 *     the stored thresholds were those bogus values.
 *
 *  2. The measurement was an OUTPUT of the decision. The right group (Annotate · Tags ·
 *     Settings) is 203px wide with labels and 119px without, so collapsing to level 1
 *     hands 84px BACK to the centre region being measured. Expanding therefore shrinks
 *     the space that justified expanding — a feedback loop that oscillates by
 *     construction, no matter how accurate the measurement is.
 *
 * So the level is now a pure function of the toolbar's OUTER width, which nothing about
 * collapsing can change. A monotonic function of width cannot be non-monotonic, so
 * flicker is impossible rather than merely unlikely.
 *
 * ── The numbers ───────────────────────────────────────────────────────────────────
 *
 * Measured, not invented (2026-09-14). Each level's intrinsic content width came from
 * rendering the real toolbar at that level and reading it at `max-content`; the right
 * group's width was added to convert to whole-toolbar width:
 *
 *   level 0: 1342 content + 203 right group = 1545
 *   level 1: 1227 + 119 = 1346
 *   level 2: 1133 + 119 = 1252
 *   level 3: 1043 + 119 = 1162
 *   level 4: 869 + 119 = 988   (floor; BrowserWindow minWidth stops us here)
 *
 * plus a 10px rounding margin. These do NOT self-adjust: adding or widening a toolbar
 * item means re-measuring. Two E2E specs guard that — the monotonic sweep in
 * `viewport/toolbar-collapse-monotonic` and the clipped-text invariant, which fails if a
 * threshold is set too generously for the content.
 */
import { useState, useLayoutEffect, useRef, useCallback, type RefObject } from 'react';

const MAX_LEVEL = 4;

/**
 * Minimum whole-toolbar width for each level, widest first. The first entry whose width
 * fits wins; below every entry we are at MAX_LEVEL.
 */
export const LEVEL_MIN_WIDTHS: ReadonlyArray<{ level: number; minWidth: number }> = [
  { level: 0, minWidth: 1555 },
  { level: 1, minWidth: 1356 },
  { level: 2, minWidth: 1262 },
  { level: 3, minWidth: 1172 },
];

const GROUP_COLLAPSE_LEVELS: Record<string, number> = {
  cine: 2,
  transform: 3,
  navigation: 4,
};

export interface CollapseState {
  collapseLevel: number;
  textCollapsed: boolean;
  isGroupCollapsed: (groupId: string) => boolean;
}

/**
 * The collapse level for a whole-toolbar width. Pure, and monotonic in `width`.
 *
 * A non-positive width means "not laid out yet" (first paint, a detached node, jsdom)
 * rather than "extremely narrow" — collapsing on that would flash a fully-collapsed
 * toolbar before the first real measurement. Assume full until we know otherwise.
 */
export function levelForWidth(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 0;
  for (const { level, minWidth } of LEVEL_MIN_WIDTHS) {
    if (width >= minWidth) return level;
  }
  return MAX_LEVEL;
}

/**
 * @param containerRef the OUTER toolbar element. It must be an element whose width is
 * independent of the collapse level — passing the centre content re-introduces the
 * feedback loop described above.
 */
export function useToolbarCollapse(containerRef: RefObject<HTMLDivElement | null>): CollapseState {
  const [collapseLevel, setCollapseLevel] = useState(0);
  const rafRef = useRef<number | null>(null);

  const update = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setCollapseLevel(levelForWidth(el.clientWidth));
  }, [containerRef]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(update);
    });
    observer.observe(el);
    update();

    return () => {
      observer.disconnect();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [containerRef, update]);

  const isGroupCollapsed = useCallback(
    (groupId: string): boolean => {
      const threshold = GROUP_COLLAPSE_LEVELS[groupId];
      return threshold != null && collapseLevel >= threshold;
    },
    [collapseLevel],
  );

  return {
    collapseLevel,
    textCollapsed: collapseLevel >= 1,
    isGroupCollapsed,
  };
}
