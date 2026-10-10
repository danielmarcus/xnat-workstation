/**
 * The Interpolate sheet (SegWorks parity branch 3 I2; #152–168): what to fill (every gap,
 * the slice on screen, between anchors A and B), the method, the gap table, and — while the
 * sheet is open — sheet-scoped keys: A / B set an anchor at the slice on screen, ⇧A / ⇧B
 * clear it, ⇧C clears both (they mean Angle / Brush again once the sheet closes).
 */
import { useEffect, useState } from 'react';
import { maskOpsService, type RunResult } from '../lib/cornerstone/maskOpsService';
import { commitPreview, discardPreview } from '../lib/cornerstone/maskPreview';
import { onLabelmapModified } from '../lib/cornerstone/sliceTrack';
import { hotkeyService } from '../lib/hotkeys/hotkeyService';
import { INTERPOLATION_LABELS } from '../lib/segmentation/interpolation/interpolate';
import { useMaskPreviewStore } from '../stores/maskPreviewStore';
import { useOperationSheetStore, type InterpolateSettings } from '../stores/operationSheetStore';
import { useSegmentationStore } from '../stores/segmentationStore';
import { useViewerStore } from '../stores/viewerStore';

function describe(r: Extract<RunResult, { ok: false }>, fill: InterpolateSettings['fill']): string {
  if (r.reason === 'no-change') {
    return fill === 'current' ? 'The slice on screen is not an empty slice between painted ones'
      : fill === 'anchors' ? 'Nothing to fill between the anchors'
      : 'No gaps to fill';
  }
  if (r.reason === 'no-target') return 'Select a segment to interpolate';
  if (r.reason === 'no-viewport') return 'Open the segment’s scan in a viewport first';
  return 'Interpolation unavailable';
}

export function useInterpolateSheet() {
  const sheet = useOperationSheetStore();
  const s = sheet.interp;
  const open = sheet.openSheet === 'interpolate';
  const previewActive = useMaskPreviewStore((st) => st.active);
  const previewReadOnly = useMaskPreviewStore((st) => st.readOnly);
  const activeSegmentationId = useSegmentationStore((st) => st.activeSegmentationId);
  const activeSegmentIndex = useSegmentationStore((st) => st.activeSegmentIndex);
  const segmentations = useSegmentationStore((st) => st.segmentations);
  const activeViewportId = useViewerStore((st) => st.activeViewportId);
  const vp = useViewerStore((st) => st.viewports[st.activeViewportId]);
  const currentSlice = (vp?.imageIndex ?? 0) + 1;
  const seg = segmentations.find((c) => c.segmentationId === activeSegmentationId)?.segments.find((m) => m.segmentIndex === activeSegmentIndex);
  const target = seg ? { name: seg.label, color: `rgb(${seg.color[0]}, ${seg.color[1]}, ${seg.color[2]})`, locked: seg.locked } : null;

  // The gap table: recomputed when the sheet opens and whenever the labelmap changes.
  const [gaps, setGaps] = useState<ReturnType<typeof maskOpsService.interpolationGaps>>([]);
  useEffect(() => {
    if (!open) return;
    const compute = () => setGaps(maskOpsService.interpolationGaps(activeViewportId));
    compute();
    return onLabelmapModified(compute);
  }, [open, activeViewportId, activeSegmentationId, segmentations]);

  // Sheet-scoped anchor keys.
  useEffect(() => {
    if (!open) return;
    return hotkeyService.pushKeyLayer({
      onKeyDown: (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return false;
        const st = useOperationSheetStore.getState();
        const here = (useViewerStore.getState().viewports[useViewerStore.getState().activeViewportId]?.imageIndex ?? 0) + 1;
        const k = e.key.toLowerCase();
        if (k === 'a') { st.setInterp(e.shiftKey ? { anchorA: null } : { anchorA: here, fill: 'anchors' }); return true; }
        if (k === 'b') { st.setInterp(e.shiftKey ? { anchorB: null } : { anchorB: here, fill: 'anchors' }); return true; }
        if (k === 'c' && e.shiftKey) { st.setInterp({ anchorA: null, anchorB: null }); return true; }
        return false;
      },
    });
  }, [open]);

  const run = (commit: boolean, fill?: { kind: 'gap'; from: number; to: number }) => {
    if (!fill && s.fill === 'anchors' && (s.anchorA === null || s.anchorB === null)) {
      sheet.setMessage('Set both anchors: A and B (keys A and B) on painted slices');
      return;
    }
    const f = fill ?? (s.fill === 'anchors'
      ? { kind: 'anchors' as const, a: s.anchorA! - 1, b: s.anchorB! - 1 }
      : { kind: s.fill });
    const r = maskOpsService.previewInterpolation(
      { method: s.method, distance: s.distance, fill: f, labels: { kind: sheet.scope.labels } },
      { commit },
    );
    sheet.setMessage(r.ok ? (r.readOnly ? `${target?.name ?? 'This segment'} is locked — preview only` : null) : describe(r, s.fill));
    hotkeyService.focusActiveViewport();
  };
  const changing = () => { if (useMaskPreviewStore.getState().active) discardPreview(); };

  return {
    open,
    target,
    settings: s,
    methods: Object.entries(INTERPOLATION_LABELS).map(([id, v]) => ({ id, ...v })),
    labels: sheet.scope.labels,
    gaps,
    currentSlice,
    message: sheet.message ?? (target?.locked ? `${target.name} is locked — preview only` : null),
    previewActive,
    previewReadOnly,
    confirmingLeave: sheet.confirmingLeave,
    advancedOpen: !!sheet.advancedOpen.interpolate,
    toggleAdvanced: () => sheet.toggleAdvanced('interpolate'),
    set: (patch: Partial<InterpolateSettings>) => { changing(); sheet.setInterp(patch); hotkeyService.focusActiveViewport(); },
    setLabels: (labels: 'active' | 'all') => { changing(); sheet.setScope({ labels }); },
    setAnchorHere: (which: 'A' | 'B') => { changing(); sheet.setInterp(which === 'A' ? { anchorA: currentSlice, fill: 'anchors' } : { anchorB: currentSlice, fill: 'anchors' }); },
    previewGap: (from: number, to: number) => run(false, { kind: 'gap', from: from - 1, to: to - 1 }),
    preview: () => run(false),
    commit: () => {
      if (useMaskPreviewStore.getState().active) { commitPreview(); hotkeyService.focusActiveViewport(); return; }
      run(true);
    },
    discard: () => { discardPreview(); hotkeyService.focusActiveViewport(); },
    back: () => {
      if (useMaskPreviewStore.getState().active && !useMaskPreviewStore.getState().readOnly) { sheet.setConfirmingLeave(true); return; }
      discardPreview();
      sheet.closeSheet();
    },
    confirmLeave: () => { discardPreview(); sheet.closeSheet(); },
    cancelLeave: () => sheet.setConfirmingLeave(false),
  };
}

export type InterpolateSheetModel = ReturnType<typeof useInterpolateSheet>;
