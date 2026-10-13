/**
 * The Smart-tab tools' controls (SegWorks parity branch 4): settings for Level Trace and
 * Smart Brush, Random Walker's seeds and Run, and the ROI limit.
 */
import { describeSemiAuto, semiAutoService } from '../lib/cornerstone/semiAutoService';
import { useSemiAutoStore } from '../stores/semiAutoStore';
import { useSeedStore } from '../stores/seedStore';
import { useSegmentationStore } from '../stores/segmentationStore';
import { useViewerStore } from '../stores/viewerStore';
import { useComputeStore } from '../stores/computeStore';

export type { LevelTraceSettings, SmartBrushSettings, RandomWalkerSettings } from '../stores/semiAutoStore';

export function useSemiAutoControls() {
  const s = useSemiAutoStore();
  const activeViewportId = useViewerStore((st) => st.activeViewportId);
  const computeJob = useComputeStore((st) => st.job);
  const strokes = useSeedStore((st) => st.strokes);
  const containerId = useSegmentationStore((st) => st.activeSegmentationId);
  const active = useSegmentationStore((st) => st.activeSegmentIndex);
  // Random Walker's seeds: the active segment's (foreground) and everything else (background).
  const seeds = strokes.filter((x) => x.containerId === containerId && x.viewportId === activeViewportId);
  return {
    levelTrace: s.levelTrace,
    setLevelTrace: s.setLevelTrace,
    smartBrush: s.smartBrush,
    setSmartBrush: s.setSmartBrush,
    randomWalker: s.randomWalker,
    setRandomWalker: s.setRandomWalker,
    seedCounts: { fg: seeds.filter((x) => x.cls === active).length, bg: seeds.filter((x) => x.cls !== active).length },
    runRandomWalker: () => {
      s.setMessage(null);
      void semiAutoService.randomWalkerRun(activeViewportId).then((r) => useSemiAutoStore.getState().setMessage(describeSemiAuto(r, 'Random Walker')));
    },
    running: !!computeJob,
    clearSeeds: () => { useSeedStore.getState().clear(containerId ?? undefined); s.setMessage(null); },
    roiDrawn: !!s.roi,
    roiHere: s.roi?.viewportId === activeViewportId,
    clearRoi: () => s.setRoi(null),
    readGuardFromRoi: () => {
      const g = semiAutoService.readGuardFromRoi(activeViewportId);
      s.setMessage(g ? null : 'Draw an ROI limit on this viewport first');
    },
    message: s.message,
  };
}

export type SemiAutoControlsModel = ReturnType<typeof useSemiAutoControls>;
