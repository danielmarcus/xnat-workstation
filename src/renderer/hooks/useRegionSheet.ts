/**
 * Region competition — SegWorks' multiphase "Chan-Vese" (branch 5, G5; #136–151): the selected
 * members (and Background) compete for voxels by intensity and boundary smoothness, starting
 * from the segmentation as it is. No seeds; previewed, ⏎ commits.
 */
import { useMemo } from 'react';
import { describeRegion, regionDomain, REGION_LABEL, runRegionCompetition, solverService } from '../lib/cornerstone/solverService';
import { clearStaleNotice, commitPreview, discardPreview } from '../lib/cornerstone/maskPreview';
import { closeOperation, confirmCloseOperation, STALE_PREVIEW_MESSAGE } from './operationLifecycle';
import { hotkeyService } from '../lib/hotkeys/hotkeyService';
import { useComputeStore } from '../stores/computeStore';
import { useMaskPreviewStore } from '../stores/maskPreviewStore';
import { useOperationSheetStore, type RegionSettings } from '../stores/operationSheetStore';
import { useSegmentationStore } from '../stores/segmentationStore';
import { useSemiAutoStore } from '../stores/semiAutoStore';
import { useViewerStore } from '../stores/viewerStore';

const rgb = (c: ArrayLike<number>) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

export function useRegionSheet() {
  const sheet = useOperationSheetStore();
  const r = sheet.region;
  const open = sheet.openSheet === 'regionCompetition';
  const previewActive = useMaskPreviewStore((st) => st.active);
  const discardedStale = useMaskPreviewStore((st) => st.discardedStale);
  const job = useComputeStore((st) => st.job);
  const activeViewportId = useViewerStore((st) => st.activeViewportId);
  const roi = useSemiAutoStore((st) => st.roi);
  const containerId = useSegmentationStore((st) => st.activeSegmentationId);
  const activeIndex = useSegmentationStore((st) => st.activeSegmentIndex);
  const segmentations = useSegmentationStore((st) => st.segmentations);
  const container = segmentations.find((c) => c.segmentationId === containerId);
  const seg = container?.segments.find((m) => m.segmentIndex === activeIndex);
  const target = seg ? { name: seg.label, color: rgb(seg.color), locked: seg.locked } : null;
  const selected = r.labels ?? [activeIndex];
  const members = (container?.segments ?? []).map((m) => ({
    id: m.segmentIndex, name: m.label, color: rgb(m.color), locked: !!m.locked, selected: selected.includes(m.segmentIndex),
  }));
  const domain = useMemo(
    () => (open ? regionDomain(r, activeViewportId) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the box follows the settings, viewport, ROI and members
    [open, r, activeViewportId, roi, containerId, activeIndex, segmentations],
  );
  const running = job?.label === REGION_LABEL;
  const run = (commit: boolean) => {
    clearStaleNotice();
    sheet.setMessage(null);
    void runRegionCompetition(r, activeViewportId, { commit }).then((res) => useOperationSheetStore.getState().setMessage(describeRegion(res)));
    hotkeyService.focusActiveViewport();
  };
  const changing = () => { if (useMaskPreviewStore.getState().active) discardPreview(); clearStaleNotice(); };
  return {
    open,
    target,
    settings: r,
    members,
    estimate: domain?.ok ? domain.estimate : null,
    domainProblem: domain && !domain.ok ? describeRegion({ ok: false, reason: domain.reason }) : null,
    running,
    message: sheet.message ?? (discardedStale ? STALE_PREVIEW_MESSAGE : null),
    summary: running ? 'Running…' : previewActive ? 'Preview pending' : `${selected.length} label${selected.length === 1 ? '' : 's'}`,
    previewActive,
    confirmingLeave: sheet.confirmingLeave,
    advancedOpen: !!sheet.advancedOpen.regionCompetition,
    toggleAdvanced: () => sheet.toggleAdvanced('regionCompetition'),
    set: (patch: Partial<RegionSettings>) => { changing(); sheet.setRegion(patch); },
    toggleLabel: (id: number) => {
      changing();
      const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
      sheet.setRegion({ labels: next });
    },
    preview: () => run(false),
    commit: () => {
      if (useMaskPreviewStore.getState().active) { commitPreview(); hotkeyService.focusActiveViewport(); return; }
      run(true);
    },
    cancel: () => solverService.cancel(),
    discard: () => { discardPreview(); hotkeyService.focusActiveViewport(); },
    close: closeOperation,
    confirmLeave: confirmCloseOperation,
    cancelLeave: () => sheet.setConfirmingLeave(false),
  };
}

export type RegionSheetModel = ReturnType<typeof useRegionSheet>;
