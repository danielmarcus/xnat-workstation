/**
 * The Cleanup operation's state and actions (SegWorks parity branch 1 S5; shown in the
 * Operations section since the 2026-10-12 D1 amendment). The only route from its
 * components to the mask-ops service and the preview.
 *
 * Sheet rules (docs/mockup/segworks-wireframes.html §5): the target is the panel's active
 * member; status is shown in the operation, never as a toast; a locked target previews
 * read-only and cannot be committed; closing the operation with a preview pending asks
 * first, inline. A preview discarded because its segment changed (the user painted with the
 * operation open) is reported in the status line.
 */
import { useEffect, useState } from 'react';
import { maskOpsService, type RunResult, type ServiceScope } from '../lib/cornerstone/maskOpsService';
import { clearStaleNotice, commitPreview, discardPreview } from '../lib/cornerstone/maskPreview';
import { onLabelmapModified } from '../lib/cornerstone/sliceTrack';
import type { PlanEntry } from '../lib/segmentation/maskOps/smartPlan';
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
  /** Two-segment operation: the other members it can go "Into", and the chosen one. */
  isPair: boolean;
  intoOptions: Array<{ segmentIndex: number; name: string }>;
  into: number | null;
  setInto(segmentIndex: number): void;
  message: string | null;
  previewActive: boolean;
  previewReadOnly: boolean;
  confirmingLeave: boolean;
  /** The one-line summary a collapsed operation shows. */
  summary: string;
  selectOp(id: string): void;
  setParam(key: string, value: number | string): void;
  toggleAdvanced(): void;
  setScope(patch: Partial<SheetScope>): void;
  preview(): void;
  commit(): void;
  discard(): void;
  /** Close the operation (asks first, inline, if a preview is pending). */
  close(): void;
  confirmLeave(): void;
  cancelLeave(): void;
  /** Give the keyboard back to the viewport after a control was used. */
  releaseFocus(): void;
  /** Smart Cleanup — shown when a cleanup op runs over All segments. */
  smart: {
    visible: boolean;
    protect: boolean;
    setProtect(v: boolean): void;
    safeAction: string;
    setSafeAction(v: string): void;
    entries: PlanEntry[];
    actionOptions: Array<{ value: string; label: string }>;
    setAction(segmentIndex: number, action: string): void;
  };
}

const LOCK_MSG = (name: string) => `${name} is locked — preview only`;
const STALE_MSG = 'Preview discarded: the segment changed';

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
  const discardedStale = useMaskPreviewStore((s) => s.discardedStale);
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
  const container = segmentations.find((s) => s.segmentationId === activeSegmentationId);
  const intoOptions = (container?.segments ?? [])
    .filter((m) => m.segmentIndex !== activeSegmentIndex)
    .map((m) => ({ segmentIndex: m.segmentIndex, name: m.label }));
  const isPair = !!op.runPair;
  // The chosen "Into" member, if it still exists; otherwise the first other member.
  const into = intoOptions.some((o) => o.segmentIndex === sheet.intoSegmentIndex)
    ? sheet.intoSegmentIndex
    : intoOptions[0]?.segmentIndex ?? null;
  const currentSlice = (vpState?.imageIndex ?? 0) + 1;
  const sliceTotal = vpState?.totalImages ?? 0;

  // Closing the sheet (or switching away from it) never leaves a preview behind.
  useEffect(() => {
    if (!sheet.openSheet && useMaskPreviewStore.getState().active) discardPreview();
  }, [sheet.openSheet]);

  // Smart Cleanup plan: proposed for every segment when a cleanup op runs over All
  // segments with protection on; recomputed when the op, scope or labelmap changes.
  const smartVisible = sheet.openSheet === 'cleanup' && !op.runPair && sheet.scope.labels === 'all' && op.group === 'clean';
  const [proposal, setProposal] = useState<PlanEntry[]>([]);
  const [labelmapVersion, setLabelmapVersion] = useState(0);
  useEffect(() => {
    if (!smartVisible) return;
    return onLabelmapModified(() => setLabelmapVersion((v) => v + 1));
  }, [smartVisible]);
  const scopeKey = JSON.stringify(sheet.scope);
  useEffect(() => {
    if (!smartVisible || !sheet.smartProtect) {
      setProposal([]);
      return;
    }
    setProposal(maskOpsService.smartPlan(op.id, toServiceScope(), sheet.smartSafeAction) ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smartVisible, sheet.smartProtect, sheet.smartSafeAction, op.id, scopeKey, labelmapVersion, activeSegmentationId, segmentations]);
  const entries = proposal.map((e) => ({ ...e, action: sheet.planOverrides[e.segmentIndex] ?? e.action }));
  const plan = smartVisible && sheet.smartProtect && entries.length
    ? Object.fromEntries(entries.map((e) => [e.segmentIndex, e.action]))
    : undefined;

  const toServiceScope = (): ServiceScope => {
    const s = sheet.scope;
    const slices: ServiceScope['slices'] = s.slices === 'range'
      ? { kind: 'range', from: s.from - 1, to: s.to - 1 }
      : { kind: s.slices };
    return { slices, labels: { kind: isPair ? 'active' : s.labels } };
  };

  const run = (commit: boolean) => {
    clearStaleNotice();
    if (isPair && into === null) {
      sheet.setMessage('Add another segment to this segmentation first');
      return;
    }
    const r = maskOpsService.previewCleanup(op.id, params, toServiceScope(), {
      commit,
      targetSegmentIndex: into ?? undefined,
      plan,
      planParams: sheet.params,
    });
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
    isPair,
    intoOptions,
    into,
    setInto: (i) => {
      if (useMaskPreviewStore.getState().active) discardPreview();
      sheet.setInto(i);
      hotkeyService.focusActiveViewport();
    },
    message: sheet.message ?? (discardedStale ? STALE_MSG : target?.locked ? LOCK_MSG(target.name) : null),
    previewActive,
    previewReadOnly,
    confirmingLeave: sheet.confirmingLeave,
    summary: previewActive ? 'Preview pending' : op.label,
    selectOp: (id) => {
      if (useMaskPreviewStore.getState().active) discardPreview();
      clearStaleNotice();
      sheet.setCleanupOp(id);
      hotkeyService.focusActiveViewport();
    },
    setParam: (key, value) => {
      if (useMaskPreviewStore.getState().active) discardPreview();
      clearStaleNotice();
      sheet.setParam(op.id, key, value);
    },
    toggleAdvanced: () => sheet.toggleAdvanced(op.id),
    setScope: (patch) => {
      if (useMaskPreviewStore.getState().active) discardPreview();
      clearStaleNotice();
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
    close: () => {
      if (useMaskPreviewStore.getState().active && !useMaskPreviewStore.getState().readOnly) {
        // The confirmation is inline in the operation, so it must be on screen.
        sheet.setCollapsed(false);
        sheet.setConfirmingLeave(true);
        return;
      }
      discardPreview();
      clearStaleNotice();
      sheet.closeSheet();
    },
    confirmLeave: () => {
      discardPreview();
      clearStaleNotice();
      sheet.closeSheet();
    },
    cancelLeave: () => sheet.setConfirmingLeave(false),
    releaseFocus: () => hotkeyService.focusActiveViewport(),
    smart: {
      visible: smartVisible,
      protect: sheet.smartProtect,
      setProtect: (v) => {
        if (useMaskPreviewStore.getState().active) discardPreview();
        sheet.setSmartProtect(v);
      },
      safeAction: sheet.smartSafeAction,
      setSafeAction: (v) => {
        if (useMaskPreviewStore.getState().active) discardPreview();
        sheet.setSmartSafeAction(v);
        hotkeyService.focusActiveViewport();
      },
      entries,
      actionOptions: [
        { value: op.id, label: op.label },
        ...(op.id === 'median' ? [] : [{ value: 'median', label: 'Median smooth' }]),
        { value: 'skip', label: 'Skip' },
      ],
      setAction: (i, a) => {
        if (useMaskPreviewStore.getState().active) discardPreview();
        sheet.setPlanOverride(i, a);
        hotkeyService.focusActiveViewport();
      },
    },
  };
}
