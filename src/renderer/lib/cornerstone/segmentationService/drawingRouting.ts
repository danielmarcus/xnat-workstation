/**
 * Pure logic for the B3 drawing-routing block + D10 non-native edit
 * affordance. Returns a decision the caller (the toolService lock-guard
 * extension) consults at gesture-start to decide whether to swallow the
 * pointerdown.
 *
 * Rules per requirements §B3 / §D10:
 *
 *   - The user is using a drawing tool (caller's responsibility to filter).
 *   - If no active container is set, don't block — current code auto-creates
 *     a structure on first stroke. Phase 3 will tighten this once the
 *     list panel surfaces explicit container creation.
 *   - If the active container's native source identity is unknown, don't
 *     block — be permissive on incomplete metadata (the alternative is
 *     blocking everything during the brief window between segmentation
 *     creation and source-image-id tracking, which is bad UX).
 *   - If the viewport's currently-displayed series matches the active
 *     container's native series, don't block (A2a / native).
 *   - If the viewport's series differs from the container's native series
 *     but the FoR matches → block + hint suggesting the native series
 *     (cross-series A2b/A2c, D10 read-only).
 *   - If the viewport's FoR differs from the container's FoR → block +
 *     hint mentioning the frame-of-reference mismatch (A2d).
 *   - If no open viewport in the session has a series matching the
 *     active container's FoR (caller passes that as a precomputed flag),
 *     drawing is blocked everywhere with the "load a compatible series"
 *     hint (B3).
 *
 * The decision is pure and synchronous; the caller resolves the inputs
 * (active tool, active container identity, viewport identity, "any
 * FoR-matched viewport open" boolean) before calling.
 *
 * Phase 2.5a is the pure logic + Cornerstone wiring. Visual hint
 * (Phase 2.5b) reads the same `DrawingRoutingDecision.reason` string for
 * the inline message; Phase 2.5a just console.warns it.
 */
import type { SourceIdentityForEligibility } from './visibility';

/** Outcome of the decision. */
export type DrawingRoutingDecision =
  | { kind: 'allow' }
  | { kind: 'block'; reason: BlockReason; hintMessage: string };

export type BlockReason =
  | 'no-for-matched-viewport-open'
  | 'cross-series'
  | 'cross-for';

export interface DecisionInputs {
  /** Active container's native source identity, or null if unknown / no active. */
  activeContainerIdentity: SourceIdentityForEligibility | null;
  /** Viewport's currently-displayed series identity, or null if unknown. */
  viewportIdentity: SourceIdentityForEligibility | null;
  /** Whether ANY open viewport in the session shows a series matching the active container's FoR. */
  anyForMatchedViewportOpen: boolean;
  /** Optional human-readable description of the active container's native series (for hint text). */
  activeContainerSeriesDescription?: string | null;
}

/**
 * Decide whether a drawing gesture should be blocked on the current
 * (viewport, active container) pair. Returns a `block` outcome with a
 * user-facing hint message; the caller surfaces it in-place at the
 * viewport (Phase 2.5b).
 */
export function decideDrawingRouting(inputs: DecisionInputs): DrawingRoutingDecision {
  const { activeContainerIdentity, viewportIdentity, anyForMatchedViewportOpen } = inputs;

  // Be permissive on incomplete metadata — let the existing flow handle
  // it. Once the active container is set up properly, subsequent gestures
  // will route through this logic correctly.
  if (!activeContainerIdentity) return { kind: 'allow' };

  // §B3 "No FoR-matched viewport open": block on every viewport, including
  // viewports that don't even have metadata yet — drawing has no valid target
  // anywhere.
  if (!anyForMatchedViewportOpen) {
    return {
      kind: 'block',
      reason: 'no-for-matched-viewport-open',
      hintMessage:
        'Drawing blocked — no open viewport shares the structure’s frame of reference. ' +
        'Load a compatible series to continue.',
    };
  }

  // Permissive on viewport-side missing metadata (e.g., a viewport that
  // hasn't received its first slice yet).
  if (!viewportIdentity) return { kind: 'allow' };

  // §A2d cross-FoR: viewport's FoR differs from the structure's. v1 has no
  // SRO support, so this can't be drawn into.
  if (activeContainerIdentity.frameOfReferenceUID !== viewportIdentity.frameOfReferenceUID) {
    return {
      kind: 'block',
      reason: 'cross-for',
      hintMessage: 'Drawing blocked — this viewport has a different frame of reference.',
    };
  }

  // §A2b/§A2c cross-series: same FoR, different series. D10 says non-native
  // viewports are read-only; B3 says drawing is blocked at gesture-start.
  if (activeContainerIdentity.seriesUID !== viewportIdentity.seriesUID) {
    const native = inputs.activeContainerSeriesDescription
      ? `“${inputs.activeContainerSeriesDescription}”`
      : 'the structure’s native series';
    return {
      kind: 'block',
      reason: 'cross-series',
      hintMessage: `Drawing blocked — switch to ${native} to edit this structure.`,
    };
  }

  // Native: allow.
  return { kind: 'allow' };
}
