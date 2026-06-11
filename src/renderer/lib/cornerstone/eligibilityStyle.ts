/**
 * eligibilityStyle — pure mapping from a forEligibility classification to the
 * render ACTION (attach? hidden? non-native? read-only?) and the per-viewport
 * non-native STYLE props. No Cornerstone imports; unit-testable.
 *
 * D9 reconciliation: Cornerstone's contour renderer supports dashed outline
 * (`outlineDash` → SVG stroke-dasharray) + reduced fill, but the LABELMAP renderer
 * has no dash/hatch — only fill opacity + outline. So a cross-series SEG is shown
 * with reduced fill opacity + a thin outline; a cross-series RTSTRUCT/contour with
 * a dashed stroke + reduced fill. Style is display-only (never persisted).
 */
import type { Eligibility } from './forEligibility';

export interface EligibilityAction {
  /** Add the representation to this viewport at all. */
  attach: boolean;
  /** Render with the non-native (visiting) style. */
  nonNative: boolean;
  /** Edits/handles are not allowed against this viewport (A2b/A2c read-only). */
  readOnly: boolean;
}

export function actionForEligibility(eligibility: Eligibility): EligibilityAction {
  switch (eligibility) {
    case 'native':
      return { attach: true, nonNative: false, readOnly: false };
    case 'cross-series-show':
      return { attach: true, nonNative: true, readOnly: true };
    case 'cross-series-hide':
      // A2c displaced sibling: do NOT attach. For a shared derived volume labelmap,
      // not-attaching is the only reliable per-viewport hide — Cornerstone's actor
      // visibility is viewport-wide, so attaching-then-hiding can't suppress it. The
      // container still LISTS (store-driven); the "show related" toggle re-attaches.
      return { attach: false, nonNative: false, readOnly: true };
    case 'different-for':
    default:
      return { attach: false, nonNative: false, readOnly: true };
  }
}

/** Per-viewport non-native style props (fed to segmentationStyle.setStyle). */
export interface NonNativeStyle {
  fillAlpha: number;
  fillAlphaInactive: number;
  /** Contour only — dashed stroke. Absent for labelmap (renderer has no dash). */
  outlineDash?: string;
  outlineDashInactive?: string;
  renderOutline?: boolean;
  outlineWidth?: number;
}

const NON_NATIVE_FILL_ALPHA = 0.25; // ~half of the native 0.5

export function nonNativeStyleFor(repType: 'Contour' | 'Labelmap'): NonNativeStyle {
  if (repType === 'Contour') {
    return {
      outlineDash: '4,4',
      outlineDashInactive: '4,4',
      fillAlpha: NON_NATIVE_FILL_ALPHA,
      fillAlphaInactive: NON_NATIVE_FILL_ALPHA,
    };
  }
  // Labelmap / SEG — reduced fill opacity + thin outline (no dash available).
  return {
    fillAlpha: NON_NATIVE_FILL_ALPHA,
    fillAlphaInactive: NON_NATIVE_FILL_ALPHA,
    renderOutline: true,
    outlineWidth: 1,
  };
}
