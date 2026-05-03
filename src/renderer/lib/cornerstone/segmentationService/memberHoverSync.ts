/**
 * Row → canvas hover sync (Phase 3.5c-row, D2 / D7.8 row-side).
 *
 * Subscribes to `useContainerSelectionStore.hoverMemberId`. When a member
 * is hovered in the list panel, applies a transient style highlight
 * (bumped outline width + brighter outline) to the corresponding segment
 * on every viewport the segmentation is attached to. When the hover
 * clears or moves to a different member, the previous override is
 * cleared so the segment returns to its visibility-mode style.
 *
 * The reciprocal canvas → row direction (hover on canvas → highlight
 * the matching row + write hoverMemberId) is staged separately as
 * Phase 3.5c-canvas because it requires Cornerstone tool-event hit-
 * testing across annotations + segments per viewport.
 *
 * Same DI seam pattern as `memberVisibility.ts` — Cornerstone calls go
 * through injected functions so tests can pass synthetic stubs without
 * module-level mocks.
 */
import type { SegmentationRepresentationKind } from './styling';

// ─── Style constants ──────────────────────────────────────────────────

/**
 * Hover highlight override for contour members: thicker outline, fully
 * opaque, no fill change. Hover is a transient inspection cue per §D2;
 * the existing visibility-mode style (filled / outlined / hidden) is
 * what governs whether fill / stroke render at all.
 */
const HOVER_CONTOUR_STYLE = {
  outlineWidth: 4,
  outlineWidthInactive: 4,
  outlineOpacity: 1,
  outlineOpacityInactive: 1,
} as const;

const HOVER_LABELMAP_STYLE = {
  outlineWidth: 3,
  outlineWidthInactive: 3,
  outlineOpacity: 1,
  outlineOpacityInactive: 1,
} as const;

// ─── DI seam ──────────────────────────────────────────────────────────

export interface MemberHoverSyncDeps {
  /**
   * Set a per-(segmentationId, segmentIndex) style override for one
   * representation kind. Cornerstone:
   *   csSegmentation.segmentationStyle.setStyle(
   *     { type, segmentationId, segmentIndex },
   *     styles, false,
   *   )
   */
  setSegmentStyle: (
    segmentationId: string,
    segmentIndex: number,
    kind: SegmentationRepresentationKind,
    styles: Record<string, unknown>,
  ) => void;

  /**
   * Reset the style override for one (segmentationId, segmentIndex, kind)
   * tuple, so the segment falls back to whatever the visibility-mode
   * style applied. Implemented via setStyle(specifier, {}, false).
   */
  resetSegmentStyle: (
    segmentationId: string,
    segmentIndex: number,
    kind: SegmentationRepresentationKind,
  ) => void;

  /** Resolve representation kinds for a segmentation. */
  getRepresentationKinds: (segmentationId: string) => SegmentationRepresentationKind[];

  /**
   * Trigger a render on every viewport the segmentation is attached to so
   * the new style takes effect immediately (some Cornerstone style changes
   * don't auto-render).
   */
  renderSegmentationViewports: (segmentationId: string) => void;
}

// ─── Reference identity for "what's currently highlighted" ────────────

/**
 * Tracks the current hover highlight target so we can clear it before
 * applying a new one. `null` means nothing is highlighted.
 */
interface HoverTarget {
  segmentationId: string;
  segmentIndex: number;
}

// ─── Application ──────────────────────────────────────────────────────

/**
 * Apply a hover highlight to one (segmentationId, segmentIndex) tuple.
 * Iterates representation kinds (Labelmap / Contour) so a "both" segmentation
 * gets the highlight on whichever rep is rendering.
 */
export function applyHoverHighlight(
  deps: MemberHoverSyncDeps,
  segmentationId: string,
  segmentIndex: number,
): void {
  if (!segmentationId || !Number.isInteger(segmentIndex) || segmentIndex <= 0) return;
  const kinds = deps.getRepresentationKinds(segmentationId);
  for (const kind of kinds) {
    const styles = kind === 'Contour' ? HOVER_CONTOUR_STYLE : HOVER_LABELMAP_STYLE;
    deps.setSegmentStyle(segmentationId, segmentIndex, kind, { ...styles });
  }
  deps.renderSegmentationViewports(segmentationId);
}

/**
 * Clear the hover highlight on one (segmentationId, segmentIndex) tuple.
 * The segment reverts to its visibility-mode / cross-series base style.
 */
export function clearHoverHighlight(
  deps: MemberHoverSyncDeps,
  segmentationId: string,
  segmentIndex: number,
): void {
  if (!segmentationId || !Number.isInteger(segmentIndex) || segmentIndex <= 0) return;
  const kinds = deps.getRepresentationKinds(segmentationId);
  for (const kind of kinds) {
    deps.resetSegmentStyle(segmentationId, segmentIndex, kind);
  }
  deps.renderSegmentationViewports(segmentationId);
}

/**
 * State machine: track the current highlight so transitions clear the
 * previous before applying the new. Returns a function that should be
 * called with the new (or null) hover target.
 *
 * Example:
 *   const dispatch = createHoverDispatcher(deps);
 *   useContainerSelectionStore.subscribe((s) => {
 *     dispatch(resolveHoverTarget(s.hoverMemberId));
 *   });
 *
 * The store-subscription wiring lives in `segmentationService.initialize()`;
 * this module owns only the state-machine + apply/clear primitives.
 */
export function createHoverDispatcher(
  deps: MemberHoverSyncDeps,
): (next: HoverTarget | null) => void {
  let current: HoverTarget | null = null;
  return (next: HoverTarget | null) => {
    if (sameTarget(current, next)) return;
    if (current) {
      clearHoverHighlight(deps, current.segmentationId, current.segmentIndex);
    }
    if (next) {
      applyHoverHighlight(deps, next.segmentationId, next.segmentIndex);
    }
    current = next;
  };
}

function sameTarget(a: HoverTarget | null, b: HoverTarget | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.segmentationId === b.segmentationId && a.segmentIndex === b.segmentIndex;
}

export type { HoverTarget };
