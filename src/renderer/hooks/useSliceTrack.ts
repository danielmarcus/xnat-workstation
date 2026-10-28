/**
 * The slice track on a viewport's scrollbar (SegWorks parity D5): where the active
 * segment is along the stack, and — while an operation sheet's scope is a Range — that
 * range, draggable. Display numbering throughout (what the overlay shows).
 */
import { useEffect, useState } from 'react';
import { Enums as CoreEnums } from '@cornerstonejs/core';
import { occupiedDisplaySlices, onLabelmapModified, toRuns } from '../lib/cornerstone/sliceTrack';
import { useOperationSheetStore } from '../stores/operationSheetStore';
import { discardPreview } from '../lib/cornerstone/maskPreview';
import { useSegmentationStore } from '../stores/segmentationStore';
import { useViewerStore } from '../stores/viewerStore';

export interface SliceTrack {
  /** Inclusive runs of displayed slice indices (0-based) holding the active segment. */
  runs: Array<[number, number]>;
  color: string | null;
  /** The operation range (0-based display indices), when one is being set. */
  range: { from: number; to: number } | null;
  /** While interpolating: the empty runs between occupied runs (0-based, inclusive). */
  gaps: Array<[number, number]>;
  /** While interpolating: anchors A and B (0-based), if set. */
  anchors: { a: number | null; b: number | null } | null;
  setRange: (from: number, to: number) => void;
}

export function useSliceTrack(panelId: string): SliceTrack {
  const containerId = useSegmentationStore((s) => s.activeSegmentationId);
  const segmentIndex = useSegmentationStore((s) => s.activeSegmentIndex);
  const seg = useSegmentationStore((s) =>
    s.segmentations.find((c) => c.segmentationId === s.activeSegmentationId)?.segments.find((m) => m.segmentIndex === s.activeSegmentIndex),
  );
  const total = useViewerStore((s) => s.viewports[panelId]?.totalImages ?? 0);
  // The plane shown: a sagittal ↔ coronal switch keeps the slice count (512 and 512) but not the
  // slices — the bands showed the previous plane's until the next edit.
  const orientation = useViewerStore((s) => s.panelOrientationMap?.[panelId] ?? '');
  const isActive = useViewerStore((s) => s.activeViewportId === panelId);
  const cleanupOpen = useOperationSheetStore((s) => s.openSheet === 'cleanup');
  const interpolating = useOperationSheetStore((s) => s.openSheet === 'interpolate');
  const interp = useOperationSheetStore((s) => s.interp);
  const scope = useOperationSheetStore((s) => s.scope);
  const setScope = useOperationSheetStore((s) => s.setScope);
  const [runs, setRuns] = useState<Array<[number, number]>>([]);

  useEffect(() => {
    if (!containerId || !(segmentIndex > 0) || total <= 1) {
      setRuns([]);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const compute = () => setRuns(toRuns(occupiedDisplaySlices(panelId, containerId, segmentIndex) ?? []));
    compute();
    const later = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(compute, 120);
    };
    const off = onLabelmapModified(later);
    // The plane changes when the CAMERA does — after the store says so (the reorientation is
    // asynchronous): recompute on a change of view-plane normal (not on every scroll).
    const element = document.querySelector(`[data-testid="unified-viewport-element:${panelId}"]`);
    let normal = '';
    const onCamera = (e: Event) => {
      const n = (e as CustomEvent<{ camera?: { viewPlaneNormal?: number[] } }>).detail?.camera?.viewPlaneNormal;
      const key = n ? n.map((v) => v.toFixed(3)).join(',') : '';
      if (key && key !== normal) { normal = key; later(); }
    };
    element?.addEventListener(CoreEnums.Events.CAMERA_MODIFIED, onCamera);
    return () => {
      off();
      element?.removeEventListener(CoreEnums.Events.CAMERA_MODIFIED, onCamera);
      if (timer) clearTimeout(timer);
    };
  }, [panelId, containerId, segmentIndex, total, orientation]);

  // The Range and the anchors are slice numbers of the ACTIVE viewport (and the range is
  // Cleanup's): shown, and draggable, there only — on another viewport they meant other slices.
  const range = isActive && cleanupOpen && scope.slices === 'range' ? { from: scope.from - 1, to: scope.to - 1 } : null;
  const gaps: Array<[number, number]> = [];
  if (interpolating) for (let i = 1; i < runs.length; i++) gaps.push([runs[i - 1][1] + 1, runs[i][0] - 1]);
  return {
    runs,
    gaps,
    anchors: interpolating && isActive ? { a: interp.anchorA !== null ? interp.anchorA - 1 : null, b: interp.anchorB !== null ? interp.anchorB - 1 : null } : null,
    color: seg ? `rgb(${seg.color[0]}, ${seg.color[1]}, ${seg.color[2]})` : null,
    range,
    // A new range invalidates a pending preview of the old one (its Commit wrote the old range).
    setRange: (from, to) => { discardPreview(); setScope({ from: from + 1, to: to + 1 }); },
  };
}
