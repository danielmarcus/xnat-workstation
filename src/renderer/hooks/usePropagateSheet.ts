/**
 * The Propagate sheet (SegWorks parity branch 3 I3; #169–181): grow the active segment
 * from the slice on screen into its neighbours, following the image.
 */
import { OBLIQUE_VIEW_MESSAGE } from '../lib/cornerstone/maskIslands';
import { maskOpsService, type RunResult } from '../lib/cornerstone/maskOpsService';
import { clearStaleNotice, commitPreview, discardPreview } from '../lib/cornerstone/maskPreview';
import { closeOperation, confirmCloseOperation, STALE_PREVIEW_MESSAGE } from './operationLifecycle';
import { hotkeyService } from '../lib/hotkeys/hotkeyService';
import { useMaskPreviewStore } from '../stores/maskPreviewStore';
import { useOperationSheetStore, type PropagateSettings } from '../stores/operationSheetStore';
import { useSegmentationStore } from '../stores/segmentationStore';

function describe(r: Extract<RunResult, { ok: false }>): string {
  switch (r.reason) {
    case 'no-seed': return 'Paint the segment on the slice on screen first — propagation starts there';
    case 'no-change': return 'Nothing matched on the neighbouring slices — try a wider tolerance';
    case 'no-image': return 'The image under the segment is not available';
    case 'no-target': return 'Select a segment to propagate';
    case 'no-viewport': return 'Open the segment’s scan in this viewport';
    case 'oblique-view': return OBLIQUE_VIEW_MESSAGE;
    default: return 'Propagation unavailable';
  }
}

export function usePropagateSheet() {
  const sheet = useOperationSheetStore();
  const p = sheet.prop;
  const open = sheet.openSheet === 'propagate';
  const previewActive = useMaskPreviewStore((st) => st.active);
  const previewReadOnly = useMaskPreviewStore((st) => st.readOnly);
  const discardedStale = useMaskPreviewStore((st) => st.discardedStale);
  const activeSegmentationId = useSegmentationStore((st) => st.activeSegmentationId);
  const activeSegmentIndex = useSegmentationStore((st) => st.activeSegmentIndex);
  const segmentations = useSegmentationStore((st) => st.segmentations);
  const seg = segmentations.find((c) => c.segmentationId === activeSegmentationId)?.segments.find((m) => m.segmentIndex === activeSegmentIndex);
  const target = seg ? { name: seg.label, color: `rgb(${seg.color[0]}, ${seg.color[1]}, ${seg.color[2]})`, locked: seg.locked } : null;
  const modality = p.modality ?? (open ? maskOpsService.activeModality() : 'ct');

  const run = (commit: boolean) => {
    clearStaleNotice();
    const r = maskOpsService.previewPropagation({
      direction: p.direction,
      maxSlices: p.maxSlices,
      zSmoothing: p.zSmoothing,
      options: {
        modality, huTolerance: p.huTolerance, sigma: p.sigma, stable: p.stable, growPx: p.growPx,
        fillHoles: p.fillHoles, edgeGuard: p.edgeGuard, maxAreaChange: p.maxAreaChangePct / 100,
      },
    }, { commit });
    sheet.setMessage(r.ok ? (r.readOnly ? `${target?.name ?? 'This segment'} is locked — preview only` : null) : describe(r));
    hotkeyService.focusActiveViewport();
  };
  const changing = () => { if (useMaskPreviewStore.getState().active) discardPreview(); clearStaleNotice(); };

  return {
    open,
    target,
    settings: p,
    modality,
    message: sheet.message ?? (discardedStale ? STALE_PREVIEW_MESSAGE : target?.locked ? `${target.name} is locked — preview only` : null),
    summary: previewActive ? 'Preview pending' : p.direction === 'both' ? 'Both directions' : p.direction === 'forward' ? 'Forward' : 'Backward',
    previewActive,
    previewReadOnly,
    confirmingLeave: sheet.confirmingLeave,
    advancedOpen: !!sheet.advancedOpen.propagate,
    toggleAdvanced: () => sheet.toggleAdvanced('propagate'),
    set: (patch: Partial<PropagateSettings>) => { changing(); sheet.setProp(patch); },
    preview: () => run(false),
    commit: () => {
      if (useMaskPreviewStore.getState().active) { commitPreview(); hotkeyService.focusActiveViewport(); return; }
      run(true);
    },
    discard: () => { discardPreview(); hotkeyService.focusActiveViewport(); },
    close: closeOperation,
    confirmLeave: confirmCloseOperation,
    cancelLeave: () => sheet.setConfirmingLeave(false),
  };
}

export type PropagateSheetModel = ReturnType<typeof usePropagateSheet>;
