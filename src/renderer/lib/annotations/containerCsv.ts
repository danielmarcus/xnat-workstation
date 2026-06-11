/**
 * containerCsv — pure CSV serialization of a Container's members for the panel
 * kebab "Export to CSV…" action (D7.6). Emits per-member structural fields plus
 * computed metrics (voxel count, volume, and intensity statistics sampled from
 * the reference image): the segment-statistics the mockup calls for.
 *
 * This module stays pure: the caller computes the stats (via
 * segmentationService.getSegmentStatistics, which runs Cornerstone's labelmap
 * statistics worker) and passes them in keyed by member id. Members without
 * stats (e.g. contour-only RTSTRUCT, or a failed/blank computation) leave the
 * metric cells empty rather than emitting zeros.
 */
import type { Container } from '@shared/types/annotation';

/** Per-member computed metrics (subset of Cornerstone's NamedStatistics). */
export interface MemberStats {
  /** Number of labelmap voxels in the segment. */
  voxelCount?: number;
  /** Segment volume in mm³. */
  volumeMm3?: number;
  /** Mean intensity under the segment (modality units, e.g. HU). */
  mean?: number;
  min?: number;
  max?: number;
  stdDev?: number;
  /** Intensity unit (e.g. "HU"); column header stays generic. */
  intensityUnit?: string;
}

/** CSV-escape one cell: quote when it contains a comma, quote, or newline. */
function csvCell(value: string | number | boolean | undefined): string {
  const s = value === undefined || value === null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Round a metric to a sensible precision; blank when absent. */
function num(value: number | undefined, digits: number): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '';
}

const HEADER = [
  'Container', 'Type', 'XNAT Scan', 'Source Scan', 'Member', 'Index', 'Visible', 'Locked',
  'Voxel Count', 'Volume (mm³)', 'Mean', 'Min', 'Max', 'StdDev', 'Intensity Unit',
];

/**
 * Build a per-member CSV string (header row + one row per member) for `container`.
 * `statsByMemberId` supplies the computed metrics per member (by Member.id);
 * members absent from the map get empty metric cells. Always ends with a
 * trailing newline; an empty container still emits the header.
 */
export function buildContainerCsv(
  container: Container,
  statsByMemberId: Record<string, MemberStats> = {},
): string {
  const rows = container.members.map((m) => {
    const st = statsByMemberId[m.id] ?? {};
    return [
      csvCell(container.label),
      csvCell(container.kind),
      csvCell(container.source.scanId),
      csvCell(container.source.sourceScanId),
      csvCell(m.label),
      csvCell(m.segmentIndex ?? m.roiNumber ?? m.id),
      csvCell(m.visible),
      csvCell(m.locked),
      csvCell(num(st.voxelCount, 0)),
      csvCell(num(st.volumeMm3, 1)),
      csvCell(num(st.mean, 2)),
      csvCell(num(st.min, 2)),
      csvCell(num(st.max, 2)),
      csvCell(num(st.stdDev, 2)),
      csvCell(st.intensityUnit ?? ''),
    ].join(',');
  });
  return [HEADER.join(','), ...rows].join('\n') + '\n';
}
