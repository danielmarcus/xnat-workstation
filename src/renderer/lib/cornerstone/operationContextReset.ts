/**
 * Values an operation keeps as numbers of one scan, plane and segmentation — the ROI limit, the
 * Range of slices, the interpolation anchors A / B, the smart plan's per-segment overrides — are
 * cleared when that scan, plane or segmentation changes. They outlived it before and were
 * reinterpreted: a stale ROI limit silently confined Cleanup on the next scan (a one-row strip
 * after axial → sagittal), stale anchors replaced an arbitrary span of slices.
 */
import { useViewerStore } from '../../stores/viewerStore';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { useSemiAutoStore } from '../../stores/semiAutoStore';
import { useOperationSheetStore } from '../../stores/operationSheetStore';

/** What a viewport shows: its scan (first image and count) and its orientation. */
function viewportKey(viewportId: string): string {
  const v = useViewerStore.getState();
  const ids = v.panelImageIdsMap?.[viewportId] ?? [];
  return `${ids[0] ?? ''}|${ids.length}|${v.panelOrientationMap?.[viewportId] ?? ''}`;
}

/** The active viewport's view and the active segmentation — what slice numbers refer to. */
function activeKey(): string {
  const vp = useViewerStore.getState().activeViewportId;
  return `${vp}|${viewportKey(vp)}|${useSegmentationStore.getState().activeSegmentationId ?? ''}`;
}

let installed = false;
export function installOperationContextReset(): void {
  if (installed) return;
  installed = true;
  const roiKeys = new Map<string, string>();
  let active = activeKey();
  const check = () => {
    // The ROI limit belongs to its viewport's view.
    const roi = useSemiAutoStore.getState().roi;
    if (roi) {
      const k = viewportKey(roi.viewportId);
      const was = roiKeys.get(roi.viewportId);
      if (was !== undefined && was !== k) useSemiAutoStore.getState().setRoi(null);
      roiKeys.set(roi.viewportId, k);
    }
    const now = activeKey();
    if (now === active) return;
    active = now;
    const sheet = useOperationSheetStore.getState();
    if (sheet.interp.anchorA !== null || sheet.interp.anchorB !== null) sheet.setInterp({ anchorA: null, anchorB: null, ...(sheet.interp.fill === 'anchors' ? { fill: 'gaps' } : {}) });
    if (sheet.scope.slices === 'range') sheet.setScope({ slices: 'current' });
    else if (Object.keys(sheet.planOverrides).length) useOperationSheetStore.setState({ planOverrides: {} });
  };
  useViewerStore.subscribe(check);
  useSegmentationStore.subscribe(check);
  useSemiAutoStore.subscribe((s, prev) => { if (s.roi !== prev.roi && s.roi) roiKeys.set(s.roi.viewportId, viewportKey(s.roi.viewportId)); });
}
