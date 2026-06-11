/**
 * containerCsv — pure CSV serialization of a Container's members for the panel
 * kebab "Export to CSV…" action (D7.6). Emits the structural per-member fields
 * we can derive reliably today: container identity + XNAT scan lineage, and per
 * member the label, index, visibility, and lock state.
 *
 * NOTE (scope): the frozen mockup also lists volumetric / HU / area metrics for
 * the CSV. Those are NOT emitted here because no segment-statistics computation
 * exists yet (the projected Member carries no stats; segmentationService leaves
 * cachedStats empty). Adding those columns is a follow-up that depends on a
 * metrics pass — see PHASES "Segmentation Enhancements".
 */
import type { Container } from '@shared/types/annotation';

/** CSV-escape one cell: quote when it contains a comma, quote, or newline. */
function csvCell(value: string | number | boolean | undefined): string {
  const s = value === undefined || value === null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const HEADER = ['Container', 'Type', 'XNAT Scan', 'Source Scan', 'Member', 'Index', 'Visible', 'Locked'];

/**
 * Build a per-member CSV string (header row + one row per member) for `container`.
 * Always ends with a trailing newline. A container with no members still emits
 * the header.
 */
export function buildContainerCsv(container: Container): string {
  const rows = container.members.map((m) =>
    [
      csvCell(container.label),
      csvCell(container.kind),
      csvCell(container.source.scanId),
      csvCell(container.source.sourceScanId),
      csvCell(m.label),
      csvCell(m.segmentIndex ?? m.roiNumber ?? m.id),
      csvCell(m.visible),
      csvCell(m.locked),
    ].join(','),
  );
  return [HEADER.join(','), ...rows].join('\n') + '\n';
}
