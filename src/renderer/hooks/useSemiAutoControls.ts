/**
 * The Smart-tab tools' controls (SegWorks parity branch 4): settings for Level Trace and
 * Smart Brush, Random Walker's seeds and Run, and the ROI limit.
 */
import { describeSemiAuto, semiAutoService } from '../lib/cornerstone/semiAutoService';
import { useSemiAutoStore } from '../stores/semiAutoStore';
import { useViewerStore } from '../stores/viewerStore';

export type { LevelTraceSettings, SmartBrushSettings, RandomWalkerSettings } from '../stores/semiAutoStore';

export function useSemiAutoControls() {
  const s = useSemiAutoStore();
  const activeViewportId = useViewerStore((st) => st.activeViewportId);
  const seeds = s.seeds?.viewportId === activeViewportId ? s.seeds.strokes : [];
  return {
    levelTrace: s.levelTrace,
    setLevelTrace: s.setLevelTrace,
    smartBrush: s.smartBrush,
    setSmartBrush: s.setSmartBrush,
    randomWalker: s.randomWalker,
    setRandomWalker: s.setRandomWalker,
    seedCounts: { fg: seeds.filter((x) => x.kind === 'fg').length, bg: seeds.filter((x) => x.kind === 'bg').length },
    runRandomWalker: () => s.setMessage(describeSemiAuto(semiAutoService.randomWalkerRun(activeViewportId), 'Random Walker')),
    clearSeeds: () => { s.clearSeeds(); s.setMessage(null); },
    roiDrawn: !!s.roi,
    roiHere: s.roi?.viewportId === activeViewportId,
    clearRoi: () => s.setRoi(null),
    message: s.message,
  };
}

export type SemiAutoControlsModel = ReturnType<typeof useSemiAutoControls>;
