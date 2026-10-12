/** The flythrough player's state and controls (SegWorks parity D6) — the components' seam to the engine. */
import { startFlythrough, stopFlythrough, togglePause } from '../lib/cornerstone/flythroughService';
import { useFlythroughStore } from '../stores/flythroughStore';
import { useSegmentationStore } from '../stores/segmentationStore';
import { useViewerStore } from '../stores/viewerStore';

export function useFlythrough(panelId: string) {
  const st = useFlythroughStore();
  // Select the stable store array and derive outside the selector: a selector returning a
  // fresh [] each call makes zustand re-render forever (React #185).
  const segmentations = useSegmentationStore((s) => s.segmentations);
  const segments = segmentations.find((c) => c.segmentationId === st.containerId)?.segments ?? [];
  const shownSlice = useViewerStore((s) => (s.viewports[panelId]?.imageIndex ?? 0) + 1);
  return {
    visible: st.running && st.viewportId === panelId,
    paused: st.paused,
    step: st.step,
    steps: st.steps,
    range: [st.lo + 1, st.hi + 1] as const,
    shownSlice,
    anatomyPhase: st.anatomyPhase,
    settingsOpen: st.settingsOpen,
    settings: {
      segmentIndices: st.segmentIndices, direction: st.direction, startFrom: st.startFrom,
      flicker: st.flicker, anatomyMs: st.anatomyMs, maskMs: st.maskMs,
    },
    segments: segments.map((m) => ({ segmentIndex: m.segmentIndex, name: m.label })),
    togglePause,
    stop: stopFlythrough,
    restart: () => startFlythrough(st.containerId, st.viewportId),
    setSettings: st.setSettings,
    toggleSettings: () => st.setSettingsOpen(!st.settingsOpen),
  };
}
