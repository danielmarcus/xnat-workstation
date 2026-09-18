/**
 * Spatial identity of an annotation container and of a viewport — the two things compared
 * to decide whether a viewport is showing the scan a container belongs to.
 *
 * These types used to live in `forEligibility.ts`, alongside a four-outcome classifier
 * (requirements A2a–A2d) that also decided whether a container should render, dimmed and
 * read-only, on a SIBLING series of the same exam. That rule was removed as incorrect: an
 * annotation belongs to the scan it was drawn on. The identities themselves are still
 * needed, so they survive here without the classifier.
 */
export interface ContainerSpatialId {
  /** Container's referenced Frame of Reference UID (0020,0052). */
  frameOfReferenceUID: string | null;
  /** The series the container was authored/derived against. */
  nativeSeriesInstanceUID: string | null;
  /** All series the container references (lineage) — a viewport on any is its own. */
  referencedSeriesInstanceUIDs: string[];
}

export interface ViewportSpatialId {
  viewportId: string;
  frameOfReferenceUID: string | null;
  seriesInstanceUID: string | null;
  /** Captured for diagnostics only — never a decision input. */
  acquisitionNumber: number | null;
}
