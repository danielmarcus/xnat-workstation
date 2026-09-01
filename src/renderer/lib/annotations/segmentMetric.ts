/**
 * segmentMetric — pure formatting of a SEG member's inline geometry metric for the
 * Annotations panel member row (frozen mockup §3: `86 cm³` in the row's metric
 * slot, alongside the measurement values SR members show there).
 *
 * The numbers come from `segmentationService.getSegmentStatistics` (Cornerstone's
 * labelmap statistics worker); this module only decides how to print them, so the
 * rounding rules are unit-testable without a labelmap.
 */

/** The subset of Cornerstone's segment statistics this row needs. */
export interface SegmentMetricInput {
  voxelCount?: number;
  volumeMm3?: number;
}

/**
 * The row's metric text, or undefined when there is nothing meaningful to show
 * (nothing painted — the row's own "(empty)" marker covers that case).
 */
export function formatSegmentMetric(stats: SegmentMetricInput | undefined): string | undefined {
  if (!stats) return undefined;
  const voxels = Number.isFinite(stats.voxelCount) ? Number(stats.voxelCount) : undefined;
  if (voxels === 0) return undefined;

  const mm3 = Number.isFinite(stats.volumeMm3) && Number(stats.volumeMm3) > 0
    ? Number(stats.volumeMm3)
    : undefined;

  if (mm3 == null) {
    // No spacing metadata (or a failed computation): a raw voxel count is still
    // honest, and beats printing a volume we don't have.
    return voxels && voxels > 0 ? `${voxels} voxels` : undefined;
  }

  const cm3 = mm3 / 1000;
  if (cm3 >= 10) return `${Math.round(cm3)} cm³`;
  if (cm3 >= 0.05) return `${cm3.toFixed(1)} cm³`;
  return `${Math.round(mm3)} mm³`;
}
