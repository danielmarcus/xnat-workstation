/**
 * The Interpolate sheet (SegWorks parity branch 3 I2; #152–168): what to fill (every gap,
 * the slice on screen, between anchors A and B), the method, the gap table, and — while it
 * is open — anchor keys: ⌥A / ⌥B set an anchor at the slice on screen, ⌥⇧A / ⌥⇧B clear it,
 * ⌥⇧C clears both. They are chords, not bare letters, because an operation stays open while
 * the user paints: bare A / B would have taken Angle and Brush away for as long as it was
 * open (D12, narrowed 2026-10-12). Matched on the physical key (`e.code`): on a Mac, ⌥A
 * types "å".
 */
import { OBLIQUE_VIEW_MESSAGE } from '../lib/cornerstone/maskIslands';
import { useEffect, useState } from 'react';
import { maskOpsService, type RunResult } from '../lib/cornerstone/maskOpsService';
import { clearStaleNotice, commitPreview, discardPreview } from '../lib/cornerstone/maskPreview';
import { closeOperation, confirmCloseOperation, STALE_PREVIEW_MESSAGE } from './operationLifecycle';
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
  if (r.reason === 'no-viewport') return 'Open the segment’s scan in this viewport';
  if (r.reason === 'oblique-view') return OBLIQUE_VIEW_MESSAGE;
  return 'Interpolation unavailable';
}

export function useInterpolateSheet() {
  const sheet = useOperationSheetStore();
  const s = sheet.interp;
  const open = sheet.openSheet === 'interpolate';
  const previewActive = useMaskPreviewStore((st) => st.active);
  const previewReadOnly = useMaskPreviewStore((st) => st.readOnly);
  const discardedStale = useMaskPreviewStore((st) => st.discardedStale);
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
  // Debounced: a brush fires a change per mouse move, and each recompute reads every segment.
  const orientation = useViewerStore((st) => st.panelOrientationMap?.[st.activeViewportId] ?? '');
  useEffect(() => {
    if (!open) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const compute = () => setGaps(maskOpsService.interpolationGaps(activeViewportId));
    compute();
    const off = onLabelmapModified(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(compute, 150);
    });
    return () => { off(); if (timer) clearTimeout(timer); };
  }, [open, activeViewportId, activeSegmentationId, segmentations, orientation]);

  // Anchor chords (⌥A / ⌥B, ⌥⇧ to clear) while the operation is open.
  useEffect(() => {
    if (!open) return;
    return hotkeyService.pushKeyLayer({
      onKeyDown: (e) => {
        if (!e.altKey || e.ctrlKey || e.metaKey) return false;
        const st = useOperationSheetStore.getState();
        const here = (useViewerStore.getState().viewports[useViewerStore.getState().activeViewportId]?.imageIndex ?? 0) + 1;
        if (e.code === 'KeyA') { st.setInterp(e.shiftKey ? { anchorA: null } : { anchorA: here, fill: 'anchors' }); return true; }
        if (e.code === 'KeyB') { st.setInterp(e.shiftKey ? { anchorB: null } : { anchorB: here, fill: 'anchors' }); return true; }
        if (e.code === 'KeyC' && e.shiftKey) { st.setInterp({ anchorA: null, anchorB: null }); return true; }
        return false;
      },
    });
  }, [open]);

  /** `segmentIndex`: a gap-table row's own segment — its gap, whatever the Labels setting. */
  const run = (commit: boolean, fill?: { kind: 'gap'; from: number; to: number }, segmentIndex?: number) => {
    clearStaleNotice();
    if (!fill && s.fill === 'anchors' && (s.anchorA === null || s.anchorB === null)) {
      sheet.setMessage('Set both anchors, A and B (⌥A and ⌥B), on painted slices');
      return;
    }
    const f = fill ?? (s.fill === 'anchors'
      ? { kind: 'anchors' as const, a: s.anchorA! - 1, b: s.anchorB! - 1 }
      : { kind: s.fill });
    const r = maskOpsService.previewInterpolation(
      { method: s.method, distance: s.distance, fill: f, labels: segmentIndex !== undefined ? { kind: 'pick', segmentIndices: [segmentIndex] } : { kind: sheet.scope.labels } },
      { commit },
    );
    sheet.setMessage(r.ok ? (r.readOnly ? `${target?.name ?? 'This segment'} is locked — preview only` : null) : describe(r, fill ? 'gaps' : s.fill));
    hotkeyService.focusActiveViewport();
  };
  const changing = () => { if (useMaskPreviewStore.getState().active) discardPreview(); clearStaleNotice(); };

  return {
    open,
    target,
    settings: s,
    methods: Object.entries(INTERPOLATION_LABELS).map(([id, v]) => ({ id, ...v })),
    labels: sheet.scope.labels,
    gaps,
    currentSlice,
    message: sheet.message ?? (discardedStale ? STALE_PREVIEW_MESSAGE : target?.locked ? `${target.name} is locked — preview only` : null),
    summary: previewActive ? 'Preview pending' : `${gaps.length} gap${gaps.length === 1 ? '' : 's'}`,
    previewActive,
    previewReadOnly,
    confirmingLeave: sheet.confirmingLeave,
    advancedOpen: !!sheet.advancedOpen.interpolate,
    toggleAdvanced: () => sheet.toggleAdvanced('interpolate'),
    set: (patch: Partial<InterpolateSettings>) => { changing(); sheet.setInterp(patch); hotkeyService.focusActiveViewport(); },
    setLabels: (labels: 'active' | 'all') => { changing(); sheet.setScope({ labels }); },
    setAnchorHere: (which: 'A' | 'B') => { changing(); sheet.setInterp(which === 'A' ? { anchorA: currentSlice, fill: 'anchors' } : { anchorB: currentSlice, fill: 'anchors' }); },
    previewGap: (from: number, to: number, segmentIndex: number) => run(false, { kind: 'gap', from: from - 1, to: to - 1 }, segmentIndex),
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

export type InterpolateSheetModel = ReturnType<typeof useInterpolateSheet>;
