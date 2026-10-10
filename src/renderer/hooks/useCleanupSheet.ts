/**
 * The Cleanup operation sheet's state and actions (SegWorks parity branch 1 S5). The only
 * route from the sheet's components to the mask-ops service and the preview.
 *
 * Sheet rules (docs/mockup/segworks-wireframes.html §5): the target is the panel's active
 * member; status is shown in the sheet, never as a toast; a locked target previews
 * read-only and cannot be committed; leaving the sheet with a preview pending asks first,
 * inline.
 */
import { useEffect } from 'react';
import { maskOpsService, type RunResult, type ServiceScope } from '../lib/cornerstone/maskOpsService';
import { commitPreview, discardPreview } from '../lib/cornerstone/maskPreview';
import { hotkeyService } from '../lib/hotkeys/hotkeyService';
import { CLEANUP_OPS, cleanupOp, defaultParams, type CleanupOp, type ParamValues } from '../lib/segmentation/maskOps/catalog';
import { useMaskPreviewStore } from '../stores/maskPreviewStore';
import { useOperationSheetStore, type SheetScope } from '../stores/operationSheetStore';
import { useSegmentationStore } from '../stores/segmentationStore';
import { useViewerStore } from '../stores/viewerStore';

export type { ParamSpec } from '../lib/segmentation/maskOps/catalog';

export interface CleanupSheetModel {
  open: boolean;
  ops: CleanupOp[];
  op: CleanupOp;
  params: ParamValues;
  advancedOpen: boolean;
  scope: SheetScope;
  /** The slice the active viewport shows, 1-based, and how many it has. */
  currentSlice: number;
  sliceTotal: number;
  target: { name: string; color: string; locked: boolean } | null;
  message: string | null;
  previewActive: boolean;
  previewReadOnly: boolean;
  confirmingLeave: boolean;
  selectOp(id: string): void;
  setParam(key: string, value: number | string): void;
  toggleAdvanced(): void;
  setScope(patch: Partial<SheetScope>): void;
  preview(): void;
  commit(): void;
  discard(): void;
  back(): void;
  confirmLeave(): void;
  cancelLeave(): void;
  /** Give the keyboard back to the viewport after a control was used. */
  releaseFocus(): void;
}

const LOCK_MSG = (name: string) => `${name} is locked — preview only`;

function describeFailure(r: Extract<RunResult, { ok: false }>): string {
  switch (r.reason) {
    case 'no-change': return 'Nothing to change in this scope';
    case 'no-target': return 'Select a segment to clean up';
    case 'no-viewport': return 'Open the segment’s scan in a viewport first';
    case 'no-labelmap': return 'This segment has no voxels to work on yet';
    case 'locked': return 'This segment is locked';
    default: return 'Operation unavailable';
  }
}

export function useCleanupSheet(): CleanupSheetModel {
  const sheet = useOperationSheetStore();
  const previewActive = useMaskPreviewStore((s) => s.active);
  const previewReadOnly = useMaskPreviewStore((s) => s.readOnly);
  const activeSegmentationId = useSegmentationStore((s) => s.activeSegmentationId);
  const activeSegmentIndex = useSegmentationStore((s) => s.activeSegmentIndex);
  const segmentations = useSegmentationStore((s) => s.segmentations);
  const activeViewportId = useViewerStore((s) => s.activeViewportId);
  const vpState = useViewerStore((s) => s.viewports[activeViewportId]);

  const op = cleanupOp(sheet.cleanupOpId) ?? CLEANUP_OPS[0];
  const params = { ...defaultParams(op), ...sheet.params[op.id] };
  const seg = segmentations.find((s) => s.segmentationId === activeSegmentationId)?.segments.find((m) => m.segmentIndex === activeSegmentIndex);
  const target = seg
    ? { name: seg.label, color: `rgb(${seg.color[0]}, ${seg.color[1]}, ${seg.color[2]})`, locked: seg.locked }
    : null;
  const currentSlice = (vpState?.imageIndex ?? 0) + 1;
  const sliceTotal = vpState?.totalImages ?? 0;

  // Closing the sheet (or switching away from it) never leaves a preview behind.
  useEffect(() => {
    if (!sheet.openSheet && useMaskPreviewStore.getState().active) discardPreview();
  }, [sheet.openSheet]);

  const toServiceScope = (): ServiceScope => {
    const s = sheet.scope;
    const slices: ServiceScope['slices'] = s.slices === 'range'
      ? { kind: 'range', from: s.from - 1, to: s.to - 1 }
      : { kind: s.slices };
    return { slices, labels: { kind: s.labels } };
  };

  const run = (commit: boolean) => {
    const r = maskOpsService.previewCleanup(op.id, params, toServiceScope(), { commit });
    if (!r.ok) {
      sheet.setMessage(describeFailure(r));
      return;
    }
    if (r.readOnly) sheet.setMessage(LOCK_MSG(target?.name ?? 'This segment'));
    else if (r.committed) sheet.setMessage(null);
    else sheet.setMessage(null);
    hotkeyService.focusActiveViewport();
  };

  return {
    open: sheet.openSheet === 'cleanup',
    ops: CLEANUP_OPS,
    op,
    params,
    advancedOpen: !!sheet.advancedOpen[op.id],
    scope: sheet.scope,
    currentSlice,
    sliceTotal,
    target,
    message: sheet.message ?? (target?.locked ? LOCK_MSG(target.name) : null),
    previewActive,
    previewReadOnly,
    confirmingLeave: sheet.confirmingLeave,
    selectOp: (id) => {
      if (useMaskPreviewStore.getState().active) discardPreview();
      sheet.setCleanupOp(id);
      hotkeyService.focusActiveViewport();
    },
    setParam: (key, value) => {
      if (useMaskPreviewStore.getState().active) discardPreview();
      sheet.setParam(op.id, key, value);
    },
    toggleAdvanced: () => sheet.toggleAdvanced(op.id),
    setScope: (patch) => {
      if (useMaskPreviewStore.getState().active) discardPreview();
      const next = { ...patch };
      // Entering Range starts it at the slice on screen.
      if (patch.slices === 'range' && sheet.scope.slices !== 'range') {
        next.from = currentSlice;
        next.to = currentSlice;
      }
      sheet.setScope(next);
    },
    preview: () => run(false),
    commit: () => {
      if (useMaskPreviewStore.getState().active) {
        if (commitPreview()) sheet.setMessage(null);
        hotkeyService.focusActiveViewport();
        return;
      }
      run(true);
    },
    discard: () => {
      discardPreview();
      hotkeyService.focusActiveViewport();
    },
    back: () => {
      if (useMaskPreviewStore.getState().active && !useMaskPreviewStore.getState().readOnly) {
        sheet.setConfirmingLeave(true);
        return;
      }
      discardPreview();
      sheet.closeSheet();
    },
    confirmLeave: () => {
      discardPreview();
      sheet.closeSheet();
    },
    cancelLeave: () => sheet.setConfirmingLeave(false),
    releaseFocus: () => hotkeyService.focusActiveViewport(),
  };
}
