/**
 * useToolbarCollapse — ResizeObserver-based hook that determines how much the
 * toolbar should collapse based on available width.
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
 * Collapse order is least-essential → most-essential. The leftSlot, Layout/Hanging,
 * Undo/Redo, and the right group (Annotate · Tags · Settings) stay inline; only the
 * measured center groups (cine, transform, navigation) fold into icon-trigger popovers.
 *
 * Strategy: collapse one level at a time, re-render, then re-measure. Each
 * level records the scrollWidth that triggered the collapse. When the
 * container later grows wider than a stored threshold, we expand back. Below the
 * fully-collapsed width the window itself stops shrinking (BrowserWindow minWidth).
 */
import { useState, useLayoutEffect, useRef, useCallback, type RefObject } from 'react';

const MAX_LEVEL = 4;
const HYSTERESIS_PX = 20;

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

export function useToolbarCollapse(containerRef: RefObject<HTMLDivElement | null>): CollapseState {
  const [collapseLevel, setCollapseLevel] = useState(0);
  const levelRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  // expandThresholds[n] = the scrollWidth observed at level n when it
  // overflowed. When clientWidth later exceeds this, we can expand back.
  const expandThresholds = useRef<number[]>([]);

  const update = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    const available = el.clientWidth;
    const needed = el.scrollWidth;
    let next = levelRef.current;

    if (needed > available && next < MAX_LEVEL) {
      // Content overflows — record threshold and collapse ONE level.
      // After re-render, the cascade effect will check again.
      expandThresholds.current[next] = needed;
      next++;
    } else {
      // Try to expand: check thresholds from current level downward.
      while (next > 0) {
        const threshold = expandThresholds.current[next - 1];
        if (threshold != null && available >= threshold + HYSTERESIS_PX) {
          next--;
        } else {
          break;
        }
      }
    }

    if (next !== levelRef.current) {
      levelRef.current = next;
      setCollapseLevel(next);
    }
  }, [containerRef]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(update);
    });
    observer.observe(el);

    // Initial measurement.
    update();

    return () => {
      observer.disconnect();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [containerRef, update]);

  // After collapsing one level, re-measure on the next frame to see if
  // another level is needed. Only cascade upward (increasing level).
  const prevLevelRef = useRef(0);
  if (collapseLevel !== prevLevelRef.current) {
    const increased = collapseLevel > prevLevelRef.current;
    prevLevelRef.current = collapseLevel;
    if (increased) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(update);
    }
  }

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
