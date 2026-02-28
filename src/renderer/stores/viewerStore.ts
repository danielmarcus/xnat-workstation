/**
 * Viewer Store — central Zustand store for viewer state.
 *
 * Supports multiple viewports keyed by panelId (e.g. 'panel_0').
 * Holds the active tool, per-panel viewport display state, per-panel cine
 * playback state, layout selection, and active viewport tracking.
 *
 * Actions delegate to the service layer for Cornerstone3D operations.
 * Toolbar actions target the active (selected) viewport.
 * Internal _update* methods are called by event handlers in CornerstoneViewport.
 */
import { create } from 'zustand';
import type {
  ViewportState,
  CineState,
  WLPreset,
  LayoutType,
  PanelConfig,
  MPRViewportState,
  VolumeLoadProgress,
  ViewportOrientation,
} from '@shared/types/viewer';
import type { Types as CsTypes } from '@cornerstonejs/core';
import { ToolName, LAYOUT_CONFIGS, panelId } from '@shared/types/viewer';
import type { HangingProtocol } from '@shared/types/hangingProtocol';
import type { XnatScan, XnatUploadContext } from '@shared/types/xnat';
import { viewportService } from '../lib/cornerstone/viewportService';
import { toolService } from '../lib/cornerstone/toolService';
import { volumeService, generateVolumeId } from '../lib/cornerstone/volumeService';
import { mprToolService } from '../lib/cornerstone/mprToolService';

/** Module-scope cine interval IDs keyed by panelId (not serializable, kept outside store) */
const cineIntervals = new Map<string, ReturnType<typeof setInterval>>();

const INITIAL_VIEWPORT: ViewportState = {
  viewportId: null,
  imageIndex: 0,
  requestedImageIndex: null,
  totalImages: 0,
  windowWidth: 0,
  windowCenter: 0,
  zoomPercent: 100,
  rotation: 0,
  flipH: false,
  flipV: false,
  invert: false,
  imageWidth: 0,
  imageHeight: 0,
};

const INITIAL_CINE: CineState = { isPlaying: false, fps: 15 };

interface ViewerStore {
  // ─── Layout State ─────────────────────────────────────────────
  layout: LayoutType | 'custom';
  layoutConfig: PanelConfig;
  activeViewportId: string;

  // ─── Per-panel State ──────────────────────────────────────────
  viewports: Record<string, ViewportState>;
  cineStates: Record<string, CineState>;

  // ─── Global State ─────────────────────────────────────────────
  activeTool: ToolName;

  // ─── Hanging Protocol State ─────────────────────────────────────
  currentProtocol: HangingProtocol | null;
  sessionScans: XnatScan[] | null;
  sessionId: string | null;

  // ─── XNAT Upload Context ────────────────────────────────────────
  xnatContext: XnatUploadContext | null;
  /** Full XNAT upload context per panel (project/subject/session/scan). */
  panelXnatContextMap: Record<string, XnatUploadContext>;

  /** Maps panel IDs to their loaded XNAT scan IDs (e.g., panel-0 → "6") */
  panelScanMap: Record<string, string>;
  /** Maps panel IDs to their loaded session label (for per-viewport overlay context). */
  panelSessionLabelMap: Record<string, string>;
  /** Maps panel IDs to subject labels (e.g., panel-0 → "SUBJ001"). */
  panelSubjectLabelMap: Record<string, string>;
  /** Maps panel IDs to their loaded imageId arrays. */
  panelImageIdsMap: Record<string, string[]>;

  // ─── Per-Panel Orientation State ───────────────────────────────
  /** Current viewing orientation per panel (STACK = original, or AXIAL/SAGITTAL/CORONAL). */
  panelOrientationMap: Record<string, ViewportOrientation>;
  /** Native acquisition orientation per panel (detected from DICOM metadata). */
  panelNativeOrientationMap: Record<string, ViewportOrientation>;

  // ─── Crosshair State ──────────────────────────────────────────
  /** World-space crosshair coordinate synced across viewports. */
  crosshairWorldPoint: CsTypes.Point3 | null;
  /** Panel that originated the crosshair position. */
  crosshairSourcePanelId: string | null;

  // ─── MPR State ─────────────────────────────────────────────────
  mprActive: boolean;
  mprVolumeId: string | null;
  mprSourcePanelId: string | null;
  mprPriorState: {
    layout: LayoutType | 'custom';
    layoutConfig: PanelConfig;
    activeViewportId: string;
    activeTool: ToolName;
  } | null;
  mprViewports: Record<string, MPRViewportState>;
  mprVolumeProgress: VolumeLoadProgress | null;

  // ─── Layout Actions ───────────────────────────────────────────
  setLayout: (layout: LayoutType) => void;
  setCustomLayout: (rows: number, cols: number) => void;
  setActiveViewport: (panelId: string) => void;

  // ─── Hanging Protocol Actions ─────────────────────────────────
  setCurrentProtocol: (protocol: HangingProtocol | null) => void;
  setSessionData: (sessionId: string | null, scans: XnatScan[] | null) => void;
  setXnatContext: (ctx: XnatUploadContext | null) => void;
  /** Record full XNAT upload context for a given panel. */
  setPanelXnatContext: (panelId: string, ctx: XnatUploadContext) => void;
  /** Record which XNAT scan is loaded in a given panel */
  setPanelScan: (panelId: string, scanId: string) => void;
  /** Record which XNAT session label is associated with a given panel */
  setPanelSessionLabel: (panelId: string, sessionLabel: string) => void;
  /** Record subject label for a panel. */
  setPanelSubjectLabel: (panelId: string, subjectLabel: string) => void;
  /** Record imageIds loaded in a panel. */
  setPanelImageIds: (panelId: string, imageIds: string[]) => void;
  /** Set viewing orientation for a panel. */
  setPanelOrientation: (panelId: string, orientation: ViewportOrientation) => void;
  /** Set native acquisition orientation for a panel. */
  setPanelNativeOrientation: (panelId: string, orientation: ViewportOrientation) => void;
  /** Set crosshair world point and source panel. */
  setCrosshairWorldPoint: (point: CsTypes.Point3 | null, sourcePanelId: string | null) => void;

  // ─── Tool / Viewport Actions (target active viewport) ────────
  setActiveTool: (tool: ToolName) => void;
  applyWLPreset: (preset: WLPreset) => void;
  resetViewport: () => void;
  toggleInvert: () => void;
  rotate90: () => void;
  flipH: () => void;
  flipV: () => void;

  // ─── Cine Actions (target active viewport) ───────────────────
  toggleCine: () => void;
  setCineFps: (fps: number) => void;
  stopCine: (panelId?: string) => void;
  stopAllCine: () => void;

  // ─── MPR Actions ────────────────────────────────────────────────
  enterMPR: (sourcePanelId: string, volumeId?: string) => void;
  exitMPR: () => void;
  _updateMPRSlice: (panelId: string, sliceIndex: number, totalSlices: number) => void;
  _updateMPRVolumeProgress: (progress: VolumeLoadProgress | null) => void;

  // ─── Internal (called by CornerstoneViewport event handlers) ──
  _initPanel: (panelId: string) => void;
  _destroyPanel: (panelId: string) => void;
  _updateVOI: (panelId: string, ww: number, wc: number) => void;
  _updateImageIndex: (panelId: string, index: number, total: number) => void;
  _requestImageIndex: (panelId: string, index: number, total?: number) => void;
  _updateZoom: (panelId: string, percent: number) => void;
  _updateImageDimensions: (panelId: string, w: number, h: number) => void;
}

/** Helper: stop cine for a specific panel (clears interval) */
function stopCineForPanel(pid: string): void {
  const id = cineIntervals.get(pid);
  if (id !== undefined) {
    clearInterval(id);
    cineIntervals.delete(pid);
  }
}

export const useViewerStore = create<ViewerStore>((set, get) => ({
  layout: '1x1',
  layoutConfig: { ...LAYOUT_CONFIGS['1x1'] },
  activeViewportId: panelId(0),
  viewports: {},
  cineStates: {},
  activeTool: ToolName.WindowLevel,
  currentProtocol: null,
  sessionScans: null,
  sessionId: null,
  xnatContext: null,
  panelXnatContextMap: {},
  panelScanMap: {},
  panelSessionLabelMap: {},
  panelSubjectLabelMap: {},
  panelImageIdsMap: {},
  panelOrientationMap: {},
  panelNativeOrientationMap: {},
  crosshairWorldPoint: null,
  crosshairSourcePanelId: null,
  mprActive: false,
  mprVolumeId: null,
  mprSourcePanelId: null,
  mprPriorState: null,
  mprViewports: {},
  mprVolumeProgress: null,

  // ─── Hanging Protocol Actions ──────────────────────────────────

  setCurrentProtocol: (protocol) => set({ currentProtocol: protocol }),

  setSessionData: (sessionId, scans) => set({ sessionId, sessionScans: scans }),

  setXnatContext: (ctx) => set({ xnatContext: ctx }),

  setPanelXnatContext: (pid, ctx) => {
    const state = get();
    const nextMap = { ...state.panelXnatContextMap, [pid]: ctx };
    const updates: Partial<ViewerStore> = { panelXnatContextMap: nextMap };
    // Keep global context in sync with the active panel.
    if (pid === state.activeViewportId) {
      updates.xnatContext = ctx;
    }
    set(updates);
  },

  setPanelScan: (pid, scanId) => {
    const state = get();
    const nextPanelScanMap = { ...state.panelScanMap, [pid]: scanId };
    const nextPanelXnatContextMap = { ...state.panelXnatContextMap };
    const panelCtx = nextPanelXnatContextMap[pid];
    if (panelCtx) {
      nextPanelXnatContextMap[pid] = { ...panelCtx, scanId };
    }
    const updates: Partial<ViewerStore> = {
      panelScanMap: nextPanelScanMap,
      panelXnatContextMap: nextPanelXnatContextMap,
    };
    // If this panel is the active viewport, update xnatContext.scanId
    if (state.xnatContext && pid === state.activeViewportId) {
      updates.xnatContext = { ...state.xnatContext, scanId };
    }
    set(updates);
  },

  setPanelSessionLabel: (pid, sessionLabel) => {
    const state = get();
    const nextPanelSessionLabelMap = { ...state.panelSessionLabelMap, [pid]: sessionLabel };
    const nextPanelXnatContextMap = { ...state.panelXnatContextMap };
    const panelCtx = nextPanelXnatContextMap[pid];
    if (panelCtx) {
      nextPanelXnatContextMap[pid] = { ...panelCtx, sessionLabel };
    }
    const updates: Partial<ViewerStore> = {
      panelSessionLabelMap: nextPanelSessionLabelMap,
      panelXnatContextMap: nextPanelXnatContextMap,
    };
    if (state.xnatContext && pid === state.activeViewportId) {
      updates.xnatContext = { ...state.xnatContext, sessionLabel };
    }
    set(updates);
  },

  setPanelSubjectLabel: (pid, subjectLabel) =>
    set((s) => ({
      panelSubjectLabelMap: { ...s.panelSubjectLabelMap, [pid]: subjectLabel },
    })),

  setPanelImageIds: (pid, imageIds) =>
    set((s) => ({
      panelImageIdsMap: { ...s.panelImageIdsMap, [pid]: imageIds },
    })),

  setPanelOrientation: (pid, orientation) =>
    set((s) => ({
      panelOrientationMap: { ...s.panelOrientationMap, [pid]: orientation },
    })),

  setPanelNativeOrientation: (pid, orientation) =>
    set((s) => ({
      panelNativeOrientationMap: { ...s.panelNativeOrientationMap, [pid]: orientation },
    })),

  setCrosshairWorldPoint: (point, sourcePanelId) =>
    set({ crosshairWorldPoint: point, crosshairSourcePanelId: sourcePanelId }),

  // ─── Layout Actions ────────────────────────────────────────────

  setLayout: (layout) => {
    const config = { ...LAYOUT_CONFIGS[layout] };
    const state = get();

    // Stop cine for panels that will be removed
    const newPanelIds = new Set(Array.from({ length: config.panelCount }, (_, i) => panelId(i)));
    for (const [pid] of cineIntervals) {
      if (!newPanelIds.has(pid)) {
        stopCineForPanel(pid);
      }
    }

    // Clean up viewport/cine state for removed panels
    const newViewports: Record<string, ViewportState> = {};
    const newCineStates: Record<string, CineState> = {};
    const newPanelScanMap: Record<string, string> = {};
    const newPanelSessionLabelMap: Record<string, string> = {};
    const newPanelXnatContextMap: Record<string, XnatUploadContext> = {};
    const newPanelSubjectLabelMap: Record<string, string> = {};
    const newPanelImageIdsMap: Record<string, string[]> = {};
    const newPanelOrientationMap: Record<string, ViewportOrientation> = {};
    const newPanelNativeOrientationMap: Record<string, ViewportOrientation> = {};
    for (const pid of newPanelIds) {
      newViewports[pid] = state.viewports[pid] ?? { ...INITIAL_VIEWPORT };
      newCineStates[pid] = state.cineStates[pid] ?? { ...INITIAL_CINE };
      if (state.panelScanMap[pid]) {
        newPanelScanMap[pid] = state.panelScanMap[pid];
      }
      if (state.panelSessionLabelMap[pid]) {
        newPanelSessionLabelMap[pid] = state.panelSessionLabelMap[pid];
      }
      if (state.panelXnatContextMap[pid]) {
        newPanelXnatContextMap[pid] = state.panelXnatContextMap[pid];
      }
      if (state.panelSubjectLabelMap[pid]) {
        newPanelSubjectLabelMap[pid] = state.panelSubjectLabelMap[pid];
      }
      if (state.panelImageIdsMap[pid]) {
        newPanelImageIdsMap[pid] = state.panelImageIdsMap[pid];
      }
      if (state.panelOrientationMap[pid]) {
        newPanelOrientationMap[pid] = state.panelOrientationMap[pid];
      }
      if (state.panelNativeOrientationMap[pid]) {
        newPanelNativeOrientationMap[pid] = state.panelNativeOrientationMap[pid];
      }
      // Mark cine as not playing for removed panels that got stopped
      if (!newPanelIds.has(pid) && newCineStates[pid]) {
        newCineStates[pid] = { ...newCineStates[pid], isPlaying: false };
      }
    }

    // Clamp activeViewportId if it's beyond the new panel count
    let activeId = state.activeViewportId;
    if (!newPanelIds.has(activeId)) {
      activeId = panelId(0);
    }

    let nextXnatContext = state.xnatContext;
    const activePanelCtx = newPanelXnatContextMap[activeId];
    if (activePanelCtx) {
      nextXnatContext = activePanelCtx;
    } else {
      const mappedScanId = newPanelScanMap[activeId];
      if (nextXnatContext && mappedScanId) {
        nextXnatContext = {
          ...nextXnatContext,
          scanId: mappedScanId,
          sessionLabel: newPanelSessionLabelMap[activeId] ?? nextXnatContext.sessionLabel,
        };
      }
    }

    set({
      layout,
      layoutConfig: config,
      activeViewportId: activeId,
      xnatContext: nextXnatContext,
      viewports: newViewports,
      cineStates: newCineStates,
      panelScanMap: newPanelScanMap,
      panelSessionLabelMap: newPanelSessionLabelMap,
      panelXnatContextMap: newPanelXnatContextMap,
      panelSubjectLabelMap: newPanelSubjectLabelMap,
      panelImageIdsMap: newPanelImageIdsMap,
      panelOrientationMap: newPanelOrientationMap,
      panelNativeOrientationMap: newPanelNativeOrientationMap,
    });
  },

  setCustomLayout: (rows, cols) => {
    const safeRows = Math.max(1, Math.min(8, Math.floor(rows) || 1));
    const safeCols = Math.max(1, Math.min(8, Math.floor(cols) || 1));
    const config: PanelConfig = {
      rows: safeRows,
      cols: safeCols,
      panelCount: safeRows * safeCols,
    };
    const state = get();

    const newPanelIds = new Set(Array.from({ length: config.panelCount }, (_, i) => panelId(i)));
    for (const [pid] of cineIntervals) {
      if (!newPanelIds.has(pid)) {
        stopCineForPanel(pid);
      }
    }

    const newViewports: Record<string, ViewportState> = {};
    const newCineStates: Record<string, CineState> = {};
    const newPanelScanMap: Record<string, string> = {};
    const newPanelSessionLabelMap: Record<string, string> = {};
    const newPanelXnatContextMap: Record<string, XnatUploadContext> = {};
    const newPanelSubjectLabelMap: Record<string, string> = {};
    const newPanelImageIdsMap: Record<string, string[]> = {};
    const newPanelOrientationMap: Record<string, ViewportOrientation> = {};
    const newPanelNativeOrientationMap: Record<string, ViewportOrientation> = {};
    for (const pid of newPanelIds) {
      newViewports[pid] = state.viewports[pid] ?? { ...INITIAL_VIEWPORT };
      newCineStates[pid] = state.cineStates[pid] ?? { ...INITIAL_CINE };
      if (state.panelScanMap[pid]) {
        newPanelScanMap[pid] = state.panelScanMap[pid];
      }
      if (state.panelSessionLabelMap[pid]) {
        newPanelSessionLabelMap[pid] = state.panelSessionLabelMap[pid];
      }
      if (state.panelXnatContextMap[pid]) {
        newPanelXnatContextMap[pid] = state.panelXnatContextMap[pid];
      }
      if (state.panelSubjectLabelMap[pid]) {
        newPanelSubjectLabelMap[pid] = state.panelSubjectLabelMap[pid];
      }
      if (state.panelImageIdsMap[pid]) {
        newPanelImageIdsMap[pid] = state.panelImageIdsMap[pid];
      }
      if (state.panelOrientationMap[pid]) {
        newPanelOrientationMap[pid] = state.panelOrientationMap[pid];
      }
      if (state.panelNativeOrientationMap[pid]) {
        newPanelNativeOrientationMap[pid] = state.panelNativeOrientationMap[pid];
      }
    }

    let activeId = state.activeViewportId;
    if (!newPanelIds.has(activeId)) {
      activeId = panelId(0);
    }

    let nextXnatContext = state.xnatContext;
    const activePanelCtx = newPanelXnatContextMap[activeId];
    if (activePanelCtx) {
      nextXnatContext = activePanelCtx;
    } else {
      const mappedScanId = newPanelScanMap[activeId];
      if (nextXnatContext && mappedScanId) {
        nextXnatContext = {
          ...nextXnatContext,
          scanId: mappedScanId,
          sessionLabel: newPanelSessionLabelMap[activeId] ?? nextXnatContext.sessionLabel,
        };
      }
    }

    set({
      layout: 'custom',
      layoutConfig: config,
      activeViewportId: activeId,
      xnatContext: nextXnatContext,
      viewports: newViewports,
      cineStates: newCineStates,
      panelScanMap: newPanelScanMap,
      panelSessionLabelMap: newPanelSessionLabelMap,
      panelXnatContextMap: newPanelXnatContextMap,
      panelSubjectLabelMap: newPanelSubjectLabelMap,
      panelImageIdsMap: newPanelImageIdsMap,
      panelOrientationMap: newPanelOrientationMap,
      panelNativeOrientationMap: newPanelNativeOrientationMap,
    });
  },

  setActiveViewport: (pid) => {
    const state = get();
    const updates: Partial<ViewerStore> = { activeViewportId: pid };
    const mappedPanelCtx = state.panelXnatContextMap[pid];
    if (mappedPanelCtx) {
      updates.xnatContext = mappedPanelCtx;
      set(updates);
      return;
    }
    // Auto-sync xnatContext.scanId when switching panels
    const mappedScanId = state.panelScanMap[pid];
    if (state.xnatContext && mappedScanId) {
      updates.xnatContext = {
        ...state.xnatContext,
        scanId: mappedScanId,
        sessionLabel: state.panelSessionLabelMap[pid] ?? state.xnatContext.sessionLabel,
      };
    }
    set(updates);
  },

  // ─── Tool / Viewport Actions ──────────────────────────────────

  setActiveTool: (tool) => {
    toolService.setActiveTool(tool);
    set({ activeTool: tool });
  },

  applyWLPreset: (preset) => {
    const { activeViewportId } = get();
    viewportService.setVOI(activeViewportId, preset.window, preset.level);
    // VOI_MODIFIED event will call _updateVOI to sync the store
  },

  resetViewport: () => {
    const { activeViewportId } = get();
    viewportService.resetCamera(activeViewportId);
    set((s) => ({
      viewports: {
        ...s.viewports,
        [activeViewportId]: {
          ...(s.viewports[activeViewportId] ?? { ...INITIAL_VIEWPORT }),
          rotation: 0,
          flipH: false,
          flipV: false,
          invert: false,
        },
      },
    }));
  },

  toggleInvert: () => {
    const { activeViewportId, viewports } = get();
    const current = viewports[activeViewportId]?.invert ?? false;
    viewportService.setInvert(activeViewportId, !current);
    set((s) => ({
      viewports: {
        ...s.viewports,
        [activeViewportId]: {
          ...(s.viewports[activeViewportId] ?? { ...INITIAL_VIEWPORT }),
          invert: !current,
        },
      },
    }));
  },

  rotate90: () => {
    const { activeViewportId } = get();
    viewportService.rotate90(activeViewportId);
    const newRotation = viewportService.getRotation(activeViewportId);
    set((s) => ({
      viewports: {
        ...s.viewports,
        [activeViewportId]: {
          ...(s.viewports[activeViewportId] ?? { ...INITIAL_VIEWPORT }),
          rotation: newRotation,
        },
      },
    }));
  },

  flipH: () => {
    const { activeViewportId } = get();
    viewportService.flipH(activeViewportId);
    const { flipH } = viewportService.getFlipState(activeViewportId);
    set((s) => ({
      viewports: {
        ...s.viewports,
        [activeViewportId]: {
          ...(s.viewports[activeViewportId] ?? { ...INITIAL_VIEWPORT }),
          flipH,
        },
      },
    }));
  },

  flipV: () => {
    const { activeViewportId } = get();
    viewportService.flipV(activeViewportId);
    const { flipV } = viewportService.getFlipState(activeViewportId);
    set((s) => ({
      viewports: {
        ...s.viewports,
        [activeViewportId]: {
          ...(s.viewports[activeViewportId] ?? { ...INITIAL_VIEWPORT }),
          flipV,
        },
      },
    }));
  },

  // ─── Cine Actions ─────────────────────────────────────────────

  toggleCine: () => {
    const { activeViewportId, cineStates } = get();
    const cine = cineStates[activeViewportId] ?? { ...INITIAL_CINE };

    if (cine.isPlaying) {
      stopCineForPanel(activeViewportId);
      set((s) => ({
        cineStates: {
          ...s.cineStates,
          [activeViewportId]: { ...cine, isPlaying: false },
        },
      }));
    } else {
      const intervalId = setInterval(() => {
        viewportService.scroll(activeViewportId, 1, true); // loop=true
      }, 1000 / cine.fps);
      cineIntervals.set(activeViewportId, intervalId);
      set((s) => ({
        cineStates: {
          ...s.cineStates,
          [activeViewportId]: { ...cine, isPlaying: true },
        },
      }));
    }
  },

  setCineFps: (fps) => {
    const { activeViewportId, cineStates } = get();
    const cine = cineStates[activeViewportId] ?? { ...INITIAL_CINE };

    set((s) => ({
      cineStates: {
        ...s.cineStates,
        [activeViewportId]: { ...cine, fps },
      },
    }));

    // If currently playing, restart the interval with new FPS
    if (cine.isPlaying) {
      stopCineForPanel(activeViewportId);
      const intervalId = setInterval(() => {
        viewportService.scroll(activeViewportId, 1, true);
      }, 1000 / fps);
      cineIntervals.set(activeViewportId, intervalId);
    }
  },

  stopCine: (pid) => {
    const targetId = pid ?? get().activeViewportId;
    stopCineForPanel(targetId);
    set((s) => ({
      cineStates: {
        ...s.cineStates,
        [targetId]: { ...(s.cineStates[targetId] ?? { ...INITIAL_CINE }), isPlaying: false },
      },
    }));
  },

  stopAllCine: () => {
    for (const [pid] of cineIntervals) {
      stopCineForPanel(pid);
    }
    set((s) => {
      const newCineStates: Record<string, CineState> = {};
      for (const [pid, cine] of Object.entries(s.cineStates)) {
        newCineStates[pid] = { ...cine, isPlaying: false };
      }
      return { cineStates: newCineStates };
    });
  },

  // ─── MPR Actions ─────────────────────────────────────────────

  enterMPR: (sourcePanelId, preCreatedVolumeId) => {
    const state = get();
    // Use pre-created volumeId if provided (volume already in cache),
    // otherwise generate one (caller must create volume separately).
    const volumeId = preCreatedVolumeId ?? generateVolumeId();

    // Initialize MPR tool group BEFORE setting mprActive (which triggers viewport render)
    mprToolService.initialize();

    set({
      mprActive: true,
      mprVolumeId: volumeId,
      mprSourcePanelId: sourcePanelId,
      mprPriorState: {
        layout: state.layout,
        layoutConfig: { ...state.layoutConfig },
        activeViewportId: state.activeViewportId,
        activeTool: state.activeTool,
      },
      mprViewports: {},
      mprVolumeProgress: { loaded: 0, total: 0, percent: 0 },
    });

    console.log('[viewerStore] Entered MPR mode, volumeId:', volumeId);
  },

  exitMPR: () => {
    const state = get();
    const volumeIdToDestroy = state.mprVolumeId;

    // Restore prior state FIRST (toggle off mprActive so viewports unmount)
    const prior = state.mprPriorState;

    set({
      mprActive: false,
      mprVolumeId: null,
      mprSourcePanelId: null,
      mprPriorState: null,
      mprViewports: {},
      mprVolumeProgress: null,
      ...(prior ? {
        layout: prior.layout,
        layoutConfig: { ...prior.layoutConfig },
        activeViewportId: prior.activeViewportId,
        activeTool: prior.activeTool,
      } : {}),
    });

    // Destroy MPR tool group AFTER toggling off mprActive
    mprToolService.destroy();

    // Restore tool activation in the stack tool group
    if (prior) {
      toolService.setActiveTool(prior.activeTool);
    }

    // Defer volume destruction so viewports can unmount cleanly first
    if (volumeIdToDestroy) {
      setTimeout(() => volumeService.destroy(volumeIdToDestroy), 100);
    }

    console.log('[viewerStore] Exited MPR mode');
  },

  _updateMPRSlice: (pid, sliceIndex, totalSlices) =>
    set((s) => ({
      mprViewports: {
        ...s.mprViewports,
        [pid]: {
          ...(s.mprViewports[pid] ?? { sliceIndex: 0, totalSlices: 0, plane: 'AXIAL' as const }),
          sliceIndex,
          totalSlices,
        },
      },
    })),

  _updateMPRVolumeProgress: (progress) =>
    set({ mprVolumeProgress: progress }),

  // ─── Internal State Setters ───────────────────────────────────

  _initPanel: (pid) =>
    set((s) => ({
      viewports: {
        ...s.viewports,
        [pid]: { ...INITIAL_VIEWPORT, viewportId: pid },
      },
      cineStates: {
        ...s.cineStates,
        [pid]: { ...INITIAL_CINE },
      },
    })),

  _destroyPanel: (pid) => {
    stopCineForPanel(pid);
    set((s) => {
      const { [pid]: _vp, ...restViewports } = s.viewports;
      const { [pid]: _cs, ...restCine } = s.cineStates;
      return {
        viewports: restViewports,
        cineStates: restCine,
      };
    });
  },

  _updateVOI: (pid, ww, wc) =>
    set((s) => ({
      viewports: {
        ...s.viewports,
        [pid]: {
          ...(s.viewports[pid] ?? { ...INITIAL_VIEWPORT }),
          windowWidth: Math.round(ww),
          windowCenter: Math.round(wc),
        },
      },
    })),

  _updateImageIndex: (pid, index, total) =>
    set((s) => ({
      viewports: {
        ...s.viewports,
        [pid]: {
          ...(s.viewports[pid] ?? { ...INITIAL_VIEWPORT }),
          imageIndex: index,
          requestedImageIndex: (() => {
            const requested = s.viewports[pid]?.requestedImageIndex ?? null;
            if (requested === null) return null;
            if (requested < 0 || requested >= total) return null;
            return requested === index ? null : requested;
          })(),
          totalImages: total,
        },
      },
    })),

  _requestImageIndex: (pid, index, totalOverride) =>
    set((s) => {
      const current = s.viewports[pid] ?? { ...INITIAL_VIEWPORT };
      const total = totalOverride ?? current.totalImages;
      if (!Number.isFinite(index) || !Number.isInteger(index) || total <= 0) {
        return s;
      }
      const clamped = Math.max(0, Math.min(total - 1, index));
      const nextRequested = clamped === current.imageIndex ? null : clamped;
      if (current.requestedImageIndex === nextRequested) {
        return s;
      }
      return {
        viewports: {
          ...s.viewports,
          [pid]: {
            ...current,
            requestedImageIndex: nextRequested,
          },
        },
      };
    }),

  _updateZoom: (pid, percent) =>
    set((s) => ({
      viewports: {
        ...s.viewports,
        [pid]: {
          ...(s.viewports[pid] ?? { ...INITIAL_VIEWPORT }),
          zoomPercent: percent,
        },
      },
    })),

  _updateImageDimensions: (pid, w, h) =>
    set((s) => ({
      viewports: {
        ...s.viewports,
        [pid]: {
          ...(s.viewports[pid] ?? { ...INITIAL_VIEWPORT }),
          imageWidth: w,
          imageHeight: h,
        },
      },
    })),
}));
