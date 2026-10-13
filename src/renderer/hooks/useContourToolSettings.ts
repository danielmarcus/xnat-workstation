/**
 * The contour drawing tools' settings and actions (Live Wire, Spline — branch 6) for the
 * toolbox's controls. The settings live in lib/cornerstone/tools/contourToolSettings, where
 * the Cornerstone tool classes read them; this is the components' only route to them and to
 * contourToolService.
 */
import { useSyncExternalStore } from 'react';
import {
  getContourToolSettings,
  setContourFillMode,
  setLivewireSettings,
  setSplineSettings,
  subscribeContourToolSettings,
  PROPAGATE_TRACKS,
  type LivewireSettings,
  type PropagateTrack,
  type SplineSettings,
} from '../lib/cornerstone/tools/contourToolSettings';
import { contourToolService } from '../lib/cornerstone/contourToolService';
import { splineSliceService } from '../lib/cornerstone/splineSliceService';
import { useSplineSliceStore } from '../stores/splineSliceStore';
import { SPLINE_ALGORITHMS } from '../lib/segmentation/contours/splines';
import { hotkeyService } from '../lib/hotkeys/hotkeyService';
import { useSemiAutoStore } from '../stores/semiAutoStore';
import { useViewerStore } from '../stores/viewerStore';
import { CONTOUR_FILL_MODES, CONTOUR_FILL_MODE_LABEL, CONTOUR_FILL_TOOLNAME, contourFillModeOf, type ContourFillMode } from '@shared/types/viewer';

export interface ContourToolSettingsModel {
  livewire: LivewireSettings;
  setLivewire(patch: Partial<LivewireSettings>): void;
  spline: SplineSettings;
  setSpline(patch: Partial<SplineSettings>): void;
  /** Contour Fill's boundary (D3) and the modes on offer. */
  contourFillMode: ContourFillMode;
  contourFillModes: ReadonlyArray<{ id: ContourFillMode; label: string }>;
  setContourFillMode(mode: ContourFillMode): void;
  /** The spline families on offer, for the Algorithm picker. */
  splineAlgorithms: ReadonlyArray<{ id: string; label: string }>;
  /** An ROI limit is drawn (local editing, Fit to ROI and the ROI active spline use it). */
  roiPresent: boolean;
  undoSplinePoint(): void;
  clearSpline(): void;
  fitToRoi(): void;
  /** The spline slice workflow (F5): a spline is in hand (⏎ commits, ⎋ discards). */
  splineInHand: boolean;
  commitSpline(): void;
  canUndoEdit: boolean;
  undoAndEdit(): void;
  copyNearby(): void;
  propagating: boolean;
  propagate(direction: -1 | 1): void;
  propagateTracks: ReadonlyArray<{ id: PropagateTrack; label: string }>;
}

export function useContourToolSettings(): ContourToolSettingsModel {
  const settings = useSyncExternalStore(subscribeContourToolSettings, getContourToolSettings);
  const roiPresent = useSemiAutoStore((s) => !!s.roi);
  const slice = useSplineSliceStore();
  const thenViewport = (f: () => unknown) => () => { f(); hotkeyService.focusActiveViewport(); };
  return {
    livewire: settings.livewire,
    setLivewire: setLivewireSettings,
    spline: settings.spline,
    setSpline: setSplineSettings,
    contourFillMode: settings.contourFillMode,
    contourFillModes: CONTOUR_FILL_MODES.map((id) => ({ id, label: CONTOUR_FILL_MODE_LABEL[id] })),
    setContourFillMode: (mode) => {
      setContourFillMode(mode);
      // Switching boundary while Contour Fill is in use switches the tool that draws it.
      const viewer = useViewerStore.getState();
      if (contourFillModeOf(viewer.activeTool)) viewer.setActiveTool(CONTOUR_FILL_TOOLNAME[mode]);
      hotkeyService.focusActiveViewport();
    },
    splineAlgorithms: SPLINE_ALGORITHMS,
    roiPresent,
    undoSplinePoint: thenViewport(() => contourToolService.undoLastSplinePoint()),
    // Clear drops a spline in hand as well as one being drawn.
    clearSpline: thenViewport(() => splineSliceService.discardInHand() || contourToolService.clearSpline()),
    fitToRoi: thenViewport(() => contourToolService.fitToRoi()),
    splineInHand: slice.inHand,
    commitSpline: thenViewport(() => splineSliceService.commitInHand()),
    canUndoEdit: slice.canUndoEdit,
    undoAndEdit: thenViewport(() => void splineSliceService.undoAndEdit()),
    copyNearby: thenViewport(() => splineSliceService.copyNearby()),
    propagating: slice.busy,
    propagate: (direction) => thenViewport(() => void splineSliceService.propagate(direction))(),
    propagateTracks: PROPAGATE_TRACKS,
  };
}
