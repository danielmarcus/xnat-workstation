/**
 * The Seeded segmentation operation (SegWorks parity branch 5, #101–135): paint seeds of the
 * segments and of the Background, pick a method and a domain, run, preview, commit.
 *
 * The seed painter is a pointer mode the operation owns (wireframe rule): turning it on makes
 * it the active tool (the toolbox highlight clears); picking any tool ends it.
 */
import { useMemo } from 'react';
import { describeSeeded, isSeeded3d, seededDomain, solverService } from '../lib/cornerstone/solverService';
import { describeSemiAuto, semiAutoService } from '../lib/cornerstone/semiAutoService';
import { clearStaleNotice, commitPreview, discardPreview, showPreviewMember } from '../lib/cornerstone/maskPreview';
import { closeOperation, confirmCloseOperation, STALE_PREVIEW_MESSAGE } from './operationLifecycle';
import { hotkeyService } from '../lib/hotkeys/hotkeyService';
import { useComputeStore } from '../stores/computeStore';
import { useMaskPreviewStore } from '../stores/maskPreviewStore';
import { useOperationSheetStore, type SeededSettings } from '../stores/operationSheetStore';
import { BACKGROUND, useSeedStore } from '../stores/seedStore';
import { useSegmentationStore } from '../stores/segmentationStore';
import { useSemiAutoStore } from '../stores/semiAutoStore';
import { useViewerStore } from '../stores/viewerStore';
import { ToolName } from '@shared/types/viewer';

const rgb = (c: ArrayLike<number>) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
const RUNNING_LABELS = new Set(['Fast GrowCut', 'Graph Cut', 'Multi-label graph cut', 'Random Walker']);

/** The tool that was active before seeding began, restored when it ends from the operation. */
let toolBeforeSeeding: ToolName | null = null;

export function useSeededSheet() {
  const sheet = useOperationSheetStore();
  const s = sheet.seeded;
  const open = sheet.openSheet === 'seeded';
  const previewActive = useMaskPreviewStore((st) => st.active);
  const previewReadOnly = useMaskPreviewStore((st) => st.readOnly);
  const discardedStale = useMaskPreviewStore((st) => st.discardedStale);
  const previewLabel = useMaskPreviewStore((st) => st.label);
  const showOnly = useMaskPreviewStore((st) => st.showOnly);
  const job = useComputeStore((st) => st.job);
  const activeViewportId = useViewerStore((st) => st.activeViewportId);
  const activeTool = useViewerStore((st) => st.activeTool);
  const roi = useSemiAutoStore((st) => st.roi);
  const rwBeta = useSemiAutoStore((st) => st.randomWalker.beta);
  const containerId = useSegmentationStore((st) => st.activeSegmentationId);
  const activeIndex = useSegmentationStore((st) => st.activeSegmentIndex);
  const segmentations = useSegmentationStore((st) => st.segmentations);
  const seeds = useSeedStore();
  const container = segmentations.find((c) => c.segmentationId === containerId);
  const seg = container?.segments.find((m) => m.segmentIndex === activeIndex);
  const target = seg ? { name: seg.label, color: rgb(seg.color), locked: seg.locked } : null;
  const mine = seeds.strokes.filter((x) => x.containerId === containerId);
  const painting = activeTool === ToolName.SolverSeeds;
  const paintClass = seeds.paintClass ?? activeIndex;

  // The classes on offer: every member, then Background.
  const classes = [
    ...(container?.segments ?? []).map((m) => ({ id: m.segmentIndex as number, name: m.label, color: rgb(m.color) })),
    { id: BACKGROUND, name: 'Background', color: 'rgb(161, 161, 170)' },
  ].map((c) => ({ ...c, strokes: mine.filter((x) => x.cls === c.id).length }));

  // α-expansion's preview label selector (#133): All, or one of the members it solved.
  const previewMembers = previewActive && previewLabel === 'Multi-label graph cut'
    ? classes.filter((c) => c.id !== BACKGROUND && c.strokes > 0).map((c) => ({ id: c.id, name: c.name }))
    : [];

  // Random Walker solves the slice on screen, inside the ROI limit or round the seeds: no 3D domain.
  const walker = !isSeeded3d(s);
  const domain = useMemo(
    () => (open && isSeeded3d(s) ? seededDomain(s, activeViewportId) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the box follows the seeds, settings, viewport and ROI
    [open, s, activeViewportId, seeds.strokes, roi, containerId, activeIndex],
  );
  const estimate = domain?.ok ? domain.estimate : null;
  const running = !!job && RUNNING_LABELS.has(job.label);

  const setPainting = (on: boolean) => {
    const viewer = useViewerStore.getState();
    if (on && viewer.activeTool !== ToolName.SolverSeeds) {
      toolBeforeSeeding = viewer.activeTool;
      viewer.setActiveTool(ToolName.SolverSeeds);
    } else if (!on && viewer.activeTool === ToolName.SolverSeeds) {
      viewer.setActiveTool(toolBeforeSeeding ?? ToolName.WindowLevel);
    }
    hotkeyService.focusActiveViewport();
  };
  const run = (commit: boolean) => {
    clearStaleNotice();
    sheet.setMessage(null);
    if (!isSeeded3d(s)) {
      // The active segment's seeds are foreground; Background's and the other segments' are background.
      void semiAutoService.randomWalkerRun(activeViewportId).then((r) => {
        useOperationSheetStore.getState().setMessage(describeSemiAuto(r, 'Random Walker'));
        if (commit && r.ok && !r.readOnly) commitPreview();
      });
      hotkeyService.focusActiveViewport();
      return;
    }
    void solverService.runSeeded(s, activeViewportId, { commit }).then((r) => useOperationSheetStore.getState().setMessage(describeSeeded(r)));
    hotkeyService.focusActiveViewport();
  };
  const changing = () => { if (useMaskPreviewStore.getState().active) discardPreview(); clearStaleNotice(); };

  return {
    open,
    target,
    settings: s,
    walker,
    walkerBeta: rwBeta,
    setWalkerBeta: (beta: number) => { changing(); useSemiAutoStore.getState().setRandomWalker({ beta }); },
    classes,
    paintClass: seeds.paintClass === 'erase' ? 'erase' as const : paintClass,
    painting,
    brushPx: seeds.brushPx,
    estimate,
    domainProblem: domain && !domain.ok ? describeSeeded({ ok: false, reason: domain.reason }) : null,
    running,
    canRestore: !!(containerId && seeds.lastRun[containerId]?.length),
    message: sheet.message ?? (discardedStale ? STALE_PREVIEW_MESSAGE : target?.locked ? `${target.name} is locked — preview only` : null),
    summary: running ? 'Running…' : previewActive ? 'Preview pending' : `${mine.length} seed stroke${mine.length === 1 ? '' : 's'}`,
    previewActive,
    previewReadOnly,
    previewMembers,
    showOnly,
    showMember: (segmentIndex: number | null) => showPreviewMember(segmentIndex),
    confirmingLeave: sheet.confirmingLeave,
    advancedOpen: !!sheet.advancedOpen.seeded,
    toggleAdvanced: () => sheet.toggleAdvanced('seeded'),
    set: (patch: Partial<SeededSettings>) => { changing(); sheet.setSeeded(patch); },
    /** Pick the class to paint (a member, Background, or erase) — and paint. */
    choose: (c: number | 'erase') => { seeds.setPaintClass(c); setPainting(true); },
    togglePainting: () => setPainting(!painting),
    setBrush: (px: number) => seeds.setBrushPx(px),
    restoreSeeds: () => { if (containerId) seeds.restore(containerId); hotkeyService.focusActiveViewport(); },
    clearSeeds: () => { seeds.clear(containerId ?? undefined); hotkeyService.focusActiveViewport(); },
    preview: () => run(false),
    commit: () => {
      if (useMaskPreviewStore.getState().active) { commitPreview(); hotkeyService.focusActiveViewport(); return; }
      run(true);
    },
    cancel: () => solverService.cancel(),
    discard: () => { discardPreview(); hotkeyService.focusActiveViewport(); },
    close: () => { setPainting(false); closeOperation(); },
    confirmLeave: () => { setPainting(false); confirmCloseOperation(); },
    cancelLeave: () => sheet.setConfirmingLeave(false),
  };
}

export type SeededSheetModel = ReturnType<typeof useSeededSheet>;
