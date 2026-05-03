/**
 * Per-member visibility-mode application (D7.3).
 *
 * Phase 3.4. Translates a Member's `visibility` field
 * (`'hidden' | 'outlined' | 'filled'`) into the right Cornerstone
 * style + per-segment visibility calls, scoped to the segmentation +
 * segmentIndex (so different members within the same segmentation can
 * have different modes).
 *
 * Per §D7.3 visibility mode is GLOBAL per member, not per-viewport.
 * The Cornerstone style override for fill / outline goes onto the
 * `(segmentationId, segmentIndex)` specifier (no viewportId), so it
 * applies wherever the segmentation renders. The binary visibility
 * (hidden vs visible) is necessarily per-viewport in Cornerstone's
 * API, so we iterate the viewports attached to the segmentation and
 * apply uniformly.
 *
 * Sibling to `styling.ts` (Phase 2.4): that module is per-(viewport,
 * segmentation) for cross-series styling; this module is per-(member)
 * for the user-controlled visibility-mode cycling. Both run in
 * parallel — no overlap on the actual API calls.
 *
 * Same factory pattern as styling.ts so tests pass synthetic deps
 * without module-level Cornerstone mocks.
 */
import type { VisibilityMode } from '../../../types/annotation';
import type { SegmentationRepresentationKind } from './styling';

// ─── Pure resolution: mode → style ─────────────────────────────────────

export interface ResolvedMemberStyle {
  renderFill: boolean;
  renderOutline: boolean;
  /** True when the member should be visible at all on its viewports. */
  visible: boolean;
}

/**
 * Map a VisibilityMode to render-fill / render-outline / visible flags.
 * Pure — no Cornerstone interaction. Verified independently of the
 * application step (which iterates viewports).
 */
export function resolveMemberStyle(mode: VisibilityMode): ResolvedMemberStyle {
  switch (mode) {
    case 'hidden':
      return { renderFill: false, renderOutline: false, visible: false };
    case 'outlined':
      return { renderFill: false, renderOutline: true, visible: true };
    case 'filled':
      return { renderFill: true, renderOutline: true, visible: true };
  }
}

// ─── Cycling ──────────────────────────────────────────────────────────

/**
 * Cycle order: `filled` → `outlined` → `hidden` → `filled`.
 *
 * Per §D7.3 the eye icon "cycles between three states (off / outline /
 * filled)." This direction (most-visible → least-visible → most) matches
 * what the icon glyph (●/◐/○) suggests when read left-to-right.
 */
export function nextVisibilityMode(current: VisibilityMode): VisibilityMode {
  switch (current) {
    case 'filled':
      return 'outlined';
    case 'outlined':
      return 'hidden';
    case 'hidden':
      return 'filled';
  }
}

// ─── DI seam ──────────────────────────────────────────────────────────

export interface MemberVisibilityDeps {
  /**
   * Set a per-(segmentationId, segmentIndex) style override that applies
   * across all viewports. Underlying:
   *   csSegmentation.segmentationStyle.setStyle(
   *     { type, segmentationId, segmentIndex },
   *     styles,
   *     false,
   *   )
   */
  setSegmentStyle: (
    segmentationId: string,
    segmentIndex: number,
    kind: SegmentationRepresentationKind,
    styles: Record<string, unknown>,
  ) => void;

  /**
   * Set the binary visibility of one segment within one (viewport,
   * segmentation, kind) representation. Underlying:
   *   csSegmentation.config.visibility.setSegmentIndexVisibility(
   *     viewportId, { segmentationId, type }, segmentIndex, visible
   *   )
   */
  setSegmentVisibility: (
    viewportId: string,
    segmentationId: string,
    segmentIndex: number,
    kind: SegmentationRepresentationKind,
    visible: boolean,
  ) => void;

  /**
   * Enumerate the viewportIds the segmentation is currently attached to.
   * Used to fan out the per-segment visibility call. Returning an empty
   * array is fine — the style override still lands and any future viewport
   * attaches will pick it up.
   */
  getViewportIdsWithSegmentation: (segmentationId: string) => string[];

  /**
   * Resolve which representation kinds (Labelmap / Contour) the
   * segmentation has data for, so we apply the style to both when present.
   */
  getRepresentationKinds: (segmentationId: string) => SegmentationRepresentationKind[];
}

// ─── Apply ────────────────────────────────────────────────────────────

/**
 * Apply a member's visibility-mode to Cornerstone:
 *
 *   1. Per-(segmentationId, segmentIndex) style override for fill /
 *      outline, one call per representation kind the segmentation has.
 *   2. Per-segment binary visibility, one call per attached viewport
 *      per representation kind.
 *
 * Idempotent — calling with the same mode twice is a no-op from the user's
 * perspective (Cornerstone deduplicates internally; the worst case is
 * one redundant render frame).
 */
export function applyMemberVisibilityMode(
  deps: MemberVisibilityDeps,
  segmentationId: string,
  segmentIndex: number,
  mode: VisibilityMode,
): void {
  if (!segmentationId || !Number.isInteger(segmentIndex) || segmentIndex <= 0) return;

  const resolved = resolveMemberStyle(mode);
  const styleOverride = {
    renderFill: resolved.renderFill,
    renderOutline: resolved.renderOutline,
    renderFillInactive: resolved.renderFill,
    renderOutlineInactive: resolved.renderOutline,
  };

  const kinds = deps.getRepresentationKinds(segmentationId);
  const viewportIds = deps.getViewportIdsWithSegmentation(segmentationId);

  for (const kind of kinds) {
    deps.setSegmentStyle(segmentationId, segmentIndex, kind, { ...styleOverride });
    for (const viewportId of viewportIds) {
      deps.setSegmentVisibility(viewportId, segmentationId, segmentIndex, kind, resolved.visible);
    }
  }
}
