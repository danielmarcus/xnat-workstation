/**
 * The Smart tools' controls (SegWorks parity branch 4): settings for Level Trace and Smart
 * Brush, and the ROI limit. (Random Walker is a Seeded segmentation method.)
 */
import { semiAutoService } from '../lib/cornerstone/semiAutoService';
import { useSemiAutoStore } from '../stores/semiAutoStore';
import { useViewerStore } from '../stores/viewerStore';

export type { LevelTraceSettings, SmartBrushSettings } from '../stores/semiAutoStore';

export function useSemiAutoControls() {
  const s = useSemiAutoStore();
  const activeViewportId = useViewerStore((st) => st.activeViewportId);
  return {
    levelTrace: s.levelTrace,
    setLevelTrace: s.setLevelTrace,
    smartBrush: s.smartBrush,
    setSmartBrush: s.setSmartBrush,
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
