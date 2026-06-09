/**
 * forEligibility — Frame-of-Reference eligibility for annotation containers
 * (requirements §A.2). PURE LOGIC: no Cornerstone / store imports, fully
 * unit-testable. Given a container's spatial identity and a viewport's, decides
 * whether and how the container renders on that viewport. Every downstream
 * behavior reads this: render attach + non-native style (Slice 2), gesture-start
 * blocking (Slice 3), and the list "different FoR" marker (Phase 3).
 *
 * The four outcomes:
 *  - native            (A2a) full style, editable on the source slice
 *  - cross-series-show (A2b) render by default, non-native style, read-only
 *  - cross-series-hide (A2c) off by default; the "show related" toggle re-enables
 *  - different-for     (A2d) do NOT render; the list still lists it with a marker
 */

export type Eligibility = 'native' | 'cross-series-show' | 'cross-series-hide' | 'different-for';

export interface ContainerSpatialId {
  /** Container's referenced Frame of Reference UID (0020,0052). */
  frameOfReferenceUID: string | null;
  /** The series the container was authored/derived against. */
  nativeSeriesInstanceUID: string | null;
  /** All series the container references (lineage) — a viewport on any is native. */
  referencedSeriesInstanceUIDs: string[];
}

export interface ViewportSpatialId {
  viewportId: string;
  frameOfReferenceUID: string | null;
  seriesInstanceUID: string | null;
  /** Captured for diagnostics only — deliberately NOT a decision input (A2c). */
  acquisitionNumber: number | null;
}

export interface EligibilityInputs {
  container: ContainerSpatialId;
  viewport: ViewportSpatialId;
  /**
   * Bulk-anatomy displacement (mm) between the container's native series and the
   * viewport's series. null/undefined = unknown ⇒ "when uncertain, show" (A2c).
   */
  bulkDisplacementMm?: number | null;
  /** Above this, a same-FoR/different-series pair is treated as A2c. Default 10 mm. */
  displacementThresholdMm?: number;
  /** D11 session toggle: user forced "show related" for this container→series pair. */
  userShowRelatedOverride?: boolean;
}

const DEFAULT_DISPLACEMENT_THRESHOLD_MM = 10;

export function classifyEligibility(inputs: EligibilityInputs): Eligibility {
  const { container, viewport } = inputs;

  // A2d — different (or unprovable) Frame of Reference: never render.
  if (
    !container.frameOfReferenceUID ||
    !viewport.frameOfReferenceUID ||
    container.frameOfReferenceUID !== viewport.frameOfReferenceUID
  ) {
    return 'different-for';
  }

  // A2a — the viewport's series is the container's native/referenced series.
  if (
    viewport.seriesInstanceUID &&
    (viewport.seriesInstanceUID === container.nativeSeriesInstanceUID ||
      container.referencedSeriesInstanceUIDs.includes(viewport.seriesInstanceUID))
  ) {
    return 'native';
  }

  // Same FoR, a different series — cross-series. Show vs hide:
  if (inputs.userShowRelatedOverride) return 'cross-series-show';

  // A2c — hide ONLY when corroborated bulk displacement exceeds the threshold
  // (separate breath-holds / 4D phase bins). AcquisitionNumber difference alone
  // never hides; unknown displacement defaults to show ("when uncertain, prefer
  // A2b over A2c").
  const threshold = inputs.displacementThresholdMm ?? DEFAULT_DISPLACEMENT_THRESHOLD_MM;
  if (inputs.bulkDisplacementMm != null && inputs.bulkDisplacementMm > threshold) {
    return 'cross-series-hide';
  }

  return 'cross-series-show'; // A2b
}
