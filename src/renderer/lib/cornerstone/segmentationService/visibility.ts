/**
 * FoR-eligibility / cross-series visibility classifier.
 *
 * Pure logic that decides whether a member (RTSTRUCT structure or SEG segment)
 * is renderable on a viewport given the two sides' source identities, and
 * whether — when it is renderable — it counts as the viewport's *native* series
 * or as a *cross-series* render that requires the D9 visual flag.
 *
 * Phase 2.1 lands the classifier + the default-policy helper. The metadata
 * lookup that produces the inputs (a member's source identity + a viewport's
 * displayed-series identity) is wired in Phase 2.3.
 *
 * Maps to:
 *   - requirements §A2 (A2a native, A2b cross-series same FoR, A2c same FoR
 *     anatomically-inconsistent, A2d different FoR);
 *   - design §7.4 Phase 2 ("same FoR + different AcquisitionNumber → A2c
 *     off-by-default; same AcquisitionNumber → A2b on-by-default; when
 *     uncertain, prefer A2b").
 */

/** Classification of a (member, viewport) pair against the A2 rules. */
export type EligibilityClass =
  /** A2a — viewport's active series is the member's native series. */
  | 'native'
  /**
   * A2b — different series sharing the FoR, anatomy reasonably consistent
   * (same AcquisitionNumber, or AcquisitionNumber missing on either side).
   * Renders by default with the D9 non-native visual flag.
   */
  | 'cross-series-A2b'
  /**
   * A2c — same FoR but evidence of anatomical movement (different
   * AcquisitionNumber on both sides). Off by default; user toggle is the
   * safety net.
   */
  | 'cross-series-A2c'
  /** A2d — FoR mismatch with no registration. Not renderable. */
  | 'cross-FoR';

/**
 * Source identity of either a member (its native series identity at draw time)
 * or a viewport (the series currently displayed in it). Same shape both sides;
 * the classifier just compares them.
 */
export interface SourceIdentityForEligibility {
  /** DICOM SeriesInstanceUID. Compared with strict `===` per PS3.3 C.7.4.1. */
  seriesUID: string;
  /** DICOM FrameOfReferenceUID (0020,0052). */
  frameOfReferenceUID: string;
  /**
   * DICOM AcquisitionNumber (0020,0012) for the series's representative image.
   * `null` when the tag is absent or unreliable; treated as "uncertain" by
   * the classifier (per design §7.4: "when uncertain, prefer A2b").
   */
  acquisitionNumber: number | null;
}

/**
 * Classify whether a member is eligible to render on a viewport, and if so,
 * under which of the A2 rules.
 *
 * Per requirements §A2, FoR equality is by strict UID match. AcquisitionNumber
 * is consulted only to distinguish A2b (render by default) from A2c (off by
 * default). When AcquisitionNumber is missing on either side, the classifier
 * resolves uncertainty in favor of A2b — anatomy is presumed consistent until
 * we have evidence otherwise.
 */
export function classifyForEligibility(
  member: SourceIdentityForEligibility,
  viewport: SourceIdentityForEligibility,
): EligibilityClass {
  if (member.frameOfReferenceUID !== viewport.frameOfReferenceUID) {
    return 'cross-FoR';
  }

  if (member.seriesUID === viewport.seriesUID) {
    return 'native';
  }

  const memberAcq = member.acquisitionNumber;
  const viewportAcq = viewport.acquisitionNumber;
  const bothPresent = memberAcq !== null && viewportAcq !== null;
  if (bothPresent && memberAcq !== viewportAcq) {
    return 'cross-series-A2c';
  }

  return 'cross-series-A2b';
}

/**
 * Cross-series rendering policy resolved for a particular (member, viewport)
 * pair. `enabled` is the global master toggle (Phase 2.2 preference;
 * `preferencesStore.multiViewport.crossSeriesRendering`). `a2cOptedIn` is the
 * per-container opt-in for breath-hold/4D-CT siblings — Phase 2 always passes
 * `false` here; Phase 3 wires the list-panel toggle that lets the user
 * explicitly enable A2c rendering for a given structure-set.
 */
export interface CrossSeriesRenderingPolicy {
  /** Master toggle. When false, no cross-series rendering at all. */
  enabled: boolean;
  /** Per-container A2c opt-in. Phase 3 surface; pass `false` in Phase 2. */
  a2cOptedIn: boolean;
}

/**
 * Decide whether the eligibility class should render given the resolved
 * cross-series policy (requirements §A2b / §A2c / §D11).
 *
 *   - native → always renders.
 *   - cross-series-A2b → renders when the global toggle is on (default true);
 *     hidden when the user has flipped the master switch off.
 *   - cross-series-A2c → renders only when both the global toggle is on AND
 *     the user has opted in for the structure-set. Phase 2 callers always
 *     pass `a2cOptedIn: false`, so A2c structures stay hidden until the
 *     Phase 3 list-panel control lights up.
 *   - cross-FoR → never renders (would require an SRO; v1 out of scope).
 */
export function shouldRenderByDefault(
  eligibility: EligibilityClass,
  policy: CrossSeriesRenderingPolicy,
): boolean {
  switch (eligibility) {
    case 'native':
      return true;
    case 'cross-series-A2b':
      return policy.enabled;
    case 'cross-series-A2c':
      return policy.enabled && policy.a2cOptedIn;
    case 'cross-FoR':
      return false;
  }
}

/** True for any of the cross-series classes (A2b or A2c). Convenience for D9. */
export function isCrossSeries(eligibility: EligibilityClass): boolean {
  return eligibility === 'cross-series-A2b' || eligibility === 'cross-series-A2c';
}
