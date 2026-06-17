/**
 * useActiveModality — resolves the DICOM modality (CT/MR/PT/…) of the scan shown in
 * the active viewport, by reading the active panel's first image's series metadata.
 *
 * Lives in the hooks layer because the Cornerstone `metaData` registry is off-limits to
 * presentational components (BOUNDARY §2). Re-resolves whenever the active viewport or
 * its images change (scan load / panel switch). Returns `undefined` until metadata is
 * available, which callers treat as "unknown" (e.g. fall back to the CT preset set).
 */
import { metaData } from '@cornerstonejs/core';
import { useViewerStore } from '../stores/viewerStore';

export function useActiveModality(): string | undefined {
  // Subscribing to both keeps the value re-resolving on panel switch and scan load.
  const activeViewportId = useViewerStore((s) => s.activeViewportId);
  const activeImageId = useViewerStore((s) => s.panelImageIdsMap[s.activeViewportId]?.[0]);
  void activeViewportId;

  if (!activeImageId) return undefined;
  try {
    return (metaData.get('generalSeriesModule', activeImageId) as { modality?: string } | undefined)?.modality;
  } catch {
    return undefined;
  }
}
