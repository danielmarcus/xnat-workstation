/**
 * Per-(segmentation, viewport) styling for the D9 non-native rendering rule.
 *
 * Phase 2.4 work. Maps the eligibility class produced by `visibility.ts` onto
 * Cornerstone's per-viewport-per-segmentation style and visibility APIs:
 *
 *   - native            → no override (inherit global style); visible = true
 *   - cross-series-A2b  → dashed contour outlines + reduced labelmap fill;
 *                         visible iff policy.enabled
 *   - cross-series-A2c  → hidden (visible = false) until per-container opt-in
 *                         lands in Phase 3 (policy.a2cOptedIn=false in Phase 2)
 *   - cross-FoR         → hidden (visible = false; would require an SRO)
 *   - null (unknown)    → leave default; visible = true (be permissive on
 *                         incomplete metadata; downstream layers will retry
 *                         once classification resolves)
 *
 * D9 visual treatment per requirements §D9:
 *   - Contour stroke: dashed (long dash 6 px, gap 3 px) for cross-series.
 *     Native contours stay solid.
 *   - Labelmap fill: reduced opacity (~50% of native). Cornerstone's
 *     `LabelmapStyle` does NOT expose `outlineDash`, so the dashed-outline
 *     rule from D9 cannot be applied to labelmaps via the published style
 *     API. Phase 2 ships with the opacity reduction only; the visual
 *     differentiation for labelmaps is the lower fill alpha, not dashed
 *     outlines. Fixing this requires either subclassing the labelmap
 *     renderer (forbidden by §0.2 unless we name a specific Cornerstone
 *     bug) or a canvas overlay layer — neither is in scope for Phase 2.
 *
 * Architecture mirrors `cornerstoneVisibilityAdapter.ts`: a factory that
 * takes the Cornerstone style/visibility/policy lookups as deps so tests
 * can pass synthetic stubs. The default export wires the real Cornerstone
 * APIs.
 *
 * Phase 2.4a is the standalone module + tests. Phase 2.4b wires it into
 * the segmentation attach paths and the preferencesStore subscription.
 */
import type { EligibilityClass } from './visibility';
import type { CrossSeriesRenderingPolicy } from './visibility';

// ─── Style constants (per requirements §D9) ─────────────────────────────

/**
 * Cross-series contour style: dashed outline. Cadence "6,3" matches the
 * D9 suggestion (long dash 6 px, gap 3 px). Stroke width and color are
 * intentionally unchanged from native — D9 says "legibility on dark
 * medical-imaging backgrounds is paramount; do not dim or desaturate."
 */
export const CROSS_SERIES_CONTOUR_STYLE = {
  renderOutline: true,
  renderFill: false,
  outlineWidth: 2,
  outlineDash: '6,3',
  outlineOpacity: 1,
  // Inactive-segment variants (when this segmentation is not the active one):
  renderOutlineInactive: true,
  outlineWidthInactive: 1,
  outlineDashInactive: '6,3',
  outlineOpacityInactive: 0.6,
} as const;

/**
 * Cross-series labelmap style: reduced fill alpha. Outlines render at the
 * same width as native (Cornerstone's LabelmapStyle has no `outlineDash`,
 * so we can't differentiate via dashed outline — see module comment).
 * Phase 2 visual signal for cross-series labelmaps is opacity alone.
 */
export const CROSS_SERIES_LABELMAP_STYLE = {
  renderFill: true,
  fillAlpha: 0.25, // ~50% of the typical native 0.5
  renderOutline: true,
  outlineWidth: 1,
  outlineOpacity: 0.6,
  renderFillInactive: true,
  fillAlphaInactive: 0.15,
  renderOutlineInactive: true,
  outlineWidthInactive: 1,
  outlineOpacityInactive: 0.4,
} as const;

// ─── Cornerstone-side surface (DI seam) ─────────────────────────────────
//
// `styling.ts` does not import from `@cornerstonejs/*`. The deps below are
// the entry points that mutate Cornerstone state. Tests pass synthetic
// stubs; production wires Cornerstone's real APIs.

export type SegmentationRepresentationKind = 'Labelmap' | 'Contour';

export interface StylingDeps {
  /**
   * Set the per-viewport-per-segmentation style override for one
   * representation kind. Cornerstone's
   * `csSegmentation.segmentationStyle.setStyle({ type, viewportId,
   * segmentationId }, styles, false)` is the underlying call.
   */
  setStyle: (
    viewportId: string,
    segmentationId: string,
    kind: SegmentationRepresentationKind,
    styles: Record<string, unknown>,
  ) => void;

  /**
   * Reset the per-viewport-per-segmentation style override so the
   * segmentation reverts to the global default style. Implemented via
   * `setStyle(..., {}, false)` — the empty object replaces any prior
   * override and Cornerstone falls back to global defaults.
   */
  resetStyle: (
    viewportId: string,
    segmentationId: string,
    kind: SegmentationRepresentationKind,
  ) => void;

  /**
   * Set the visibility of a (viewport, segmentation, kind) representation.
   * Backed by `csSegmentation.setSegmentationRepresentationVisibility(...)`.
   */
  setVisibility: (
    viewportId: string,
    segmentationId: string,
    kind: SegmentationRepresentationKind,
    visible: boolean,
  ) => void;

  /**
   * Resolve which representation kinds (Labelmap / Contour) the segmentation
   * has data for. A "both" segmentation has both kinds attached.
   */
  getRepresentationKinds: (segmentationId: string) => SegmentationRepresentationKind[];

  /**
   * Resolve the eligibility of a (segmentation, viewport) pair. Wraps
   * `classifySegmentationOnViewport` from `visibility.ts`. Returns null
   * when classification is unknown.
   */
  classify: (segmentationId: string, viewportId: string) => EligibilityClass | null;

  /** Read the current cross-series rendering policy from preferencesStore. */
  readPolicy: () => CrossSeriesRenderingPolicy;
}

// ─── Pure resolution: eligibility → action ──────────────────────────────

export type StyleAction =
  /** Native or unknown; reset any override and show. */
  | { kind: 'reset' }
  /** Cross-series renderable; apply the D9 style for the kind. */
  | { kind: 'apply-cross-series'; visible: true }
  /** Hidden: cross-FoR, A2c without opt-in, or master toggle off. */
  | { kind: 'hide' };

export function resolveAction(
  eligibility: EligibilityClass | null,
  policy: CrossSeriesRenderingPolicy,
): StyleAction {
  if (eligibility === null) return { kind: 'reset' };
  if (eligibility === 'native') return { kind: 'reset' };
  if (eligibility === 'cross-FoR') return { kind: 'hide' };

  // cross-series-A2b or cross-series-A2c
  if (eligibility === 'cross-series-A2b') {
    return policy.enabled ? { kind: 'apply-cross-series', visible: true } : { kind: 'hide' };
  }
  // cross-series-A2c: needs both global enabled AND per-container opt-in
  if (policy.enabled && policy.a2cOptedIn) {
    return { kind: 'apply-cross-series', visible: true };
  }
  return { kind: 'hide' };
}

// ─── Factory ────────────────────────────────────────────────────────────

export interface StylingService {
  /**
   * Apply visibility style to a single (segmentation, viewport) pair.
   * Idempotent — call any number of times; the resolved action determines
   * the current state.
   */
  applyForSegmentationViewport(segmentationId: string, viewportId: string): void;
  /** Apply to every (segmentation, viewport) pair the deps know about. */
  applyForAllPairs(pairs: Array<{ segmentationId: string; viewportId: string }>): void;
}

export function createStylingService(deps: StylingDeps): StylingService {
  function applyOne(segmentationId: string, viewportId: string, kind: SegmentationRepresentationKind, action: StyleAction): void {
    if (action.kind === 'reset') {
      deps.resetStyle(viewportId, segmentationId, kind);
      deps.setVisibility(viewportId, segmentationId, kind, true);
      return;
    }
    if (action.kind === 'hide') {
      deps.setVisibility(viewportId, segmentationId, kind, false);
      return;
    }
    // apply-cross-series
    const styles = kind === 'Contour' ? CROSS_SERIES_CONTOUR_STYLE : CROSS_SERIES_LABELMAP_STYLE;
    deps.setStyle(viewportId, segmentationId, kind, { ...styles });
    deps.setVisibility(viewportId, segmentationId, kind, action.visible);
  }

  return {
    applyForSegmentationViewport(segmentationId, viewportId) {
      const eligibility = deps.classify(segmentationId, viewportId);
      const policy = deps.readPolicy();
      const action = resolveAction(eligibility, policy);
      const kinds = deps.getRepresentationKinds(segmentationId);
      for (const kind of kinds) {
        applyOne(segmentationId, viewportId, kind, action);
      }
    },
    applyForAllPairs(pairs) {
      for (const { segmentationId, viewportId } of pairs) {
        const eligibility = deps.classify(segmentationId, viewportId);
        const policy = deps.readPolicy();
        const action = resolveAction(eligibility, policy);
        const kinds = deps.getRepresentationKinds(segmentationId);
        for (const kind of kinds) {
          applyOne(segmentationId, viewportId, kind, action);
        }
      }
    },
  };
}
