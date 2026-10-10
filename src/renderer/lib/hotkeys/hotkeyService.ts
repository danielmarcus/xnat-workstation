/**
 * Hotkey Service — global keyboard shortcut listener and action dispatcher.
 *
 * Singleton module that:
 * 1. Maintains a configurable hotkey map
 * 2. Installs a single global keydown listener (capture phase)
 * 3. Matches key events to actions via normalized string lookup
 * 4. Dispatches actions to the appropriate Zustand stores / services
 *
 * Does NOT create any Zustand store of its own. All state mutations go
 * through existing stores (viewerStore, segmentationStore, annotationStore).
 */
import type { HotkeyAction, HotkeyBinding, HotkeyMap } from '@shared/types/hotkeys';
import { ToolName, WL_PRESETS, panelId as makePanelId } from '@shared/types/viewer';
import type { LayoutType } from '@shared/types/viewer';
import { DEFAULT_HOTKEY_MAP } from './defaultHotkeyMap';
import { useViewerStore } from '../../stores/viewerStore';
import { usePreferencesStore } from '../../stores/preferencesStore';
import { useHudStore } from '../../stores/hudStore';
import { useSegmentationManagerStore } from '../../stores/segmentationManagerStore';
import { segmentationManager } from '../segmentation/segmentationManagerSingleton';
import { useOperationSheetStore } from '../../stores/operationSheetStore';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { viewportService } from '../cornerstone/viewportService';
import { segmentationService } from '../cornerstone/segmentationService';
import { unifiedSegService } from '../cornerstone/unifiedSegService';
import { unifiedToolService } from '../cornerstone/unifiedToolService';

// ─── Reverse Lookup Table ─────────────────────────────────────────

/**
 * Normalized key string for fast lookup.
 * Format: "ctrl+shift+alt+meta+key" (modifiers in fixed order, lowercase key).
 * Only present modifiers are included (e.g., "shift+r", "escape", "ctrl+1").
 */
function normalizeBinding(binding: HotkeyBinding): string {
  const parts: string[] = [];
  if (binding.modifiers?.ctrl) parts.push('ctrl');
  if (binding.modifiers?.shift) parts.push('shift');
  if (binding.modifiers?.alt) parts.push('alt');
  if (binding.modifiers?.meta) parts.push('meta');
  parts.push(binding.key.toLowerCase());
  return parts.join('+');
}

/**
 * Build a reverse lookup from normalized key string to action.
 * Last-write-wins for conflicts (later map entries take precedence).
 */
function buildLookup(map: HotkeyMap): Map<string, HotkeyAction> {
  const lookup = new Map<string, HotkeyAction>();
  for (const [action, bindings] of Object.entries(map) as [HotkeyAction, HotkeyBinding[]][]) {
    if (!bindings) continue;
    for (const binding of bindings) {
      lookup.set(normalizeBinding(binding), action);
    }
  }
  return lookup;
}

// ─── Action → ToolName Mapping ────────────────────────────────────

const TOOL_ACTION_MAP: Partial<Record<HotkeyAction, ToolName>> = {
  'tool.windowLevel':      ToolName.WindowLevel,
  'tool.pan':              ToolName.Pan,
  'tool.zoom':             ToolName.Zoom,
  'tool.length':           ToolName.Length,
  'tool.angle':            ToolName.Angle,
  'tool.bidirectional':    ToolName.Bidirectional,
  'tool.ellipticalROI':    ToolName.EllipticalROI,
  'tool.rectangleROI':     ToolName.RectangleROI,
  'tool.circleROI':        ToolName.CircleROI,
  'tool.probe':            ToolName.Probe,
  'tool.arrowAnnotate':    ToolName.ArrowAnnotate,
  'tool.freehandROI':      ToolName.PlanarFreehandROI,
  'tool.crosshairs':       ToolName.Crosshairs,
  'tool.brush':            ToolName.Brush,
  'tool.thresholdBrush':   ToolName.ThresholdBrush,
  'tool.freehandContour':  ToolName.FreehandContour,
  'tool.splineContour':    ToolName.SplineContour,
  'tool.livewireContour':  ToolName.LivewireContour,
  'tool.circleScissors':   ToolName.CircleScissors,
  'tool.rectangleScissors': ToolName.RectangleScissors,
  'tool.paintFill':        ToolName.PaintFill,
  'tool.sculptor':         ToolName.Sculptor,
  'tool.stackScroll':      ToolName.StackScroll,
};

const LAYOUT_ACTION_MAP: Partial<Record<HotkeyAction, LayoutType>> = {
  'layout.1x1': '1x1',
  'layout.1x2': '1x2',
  'layout.2x1': '2x1',
  'layout.2x2': '2x2',
};

// ─── Clockwise Panel Ordering ─────────────────────────────────────

/**
 * Build a clockwise traversal order for a rows×cols grid layout.
 * For a 2×2 grid: TL → TR → BR → BL (i.e., panel_0 → panel_1 → panel_3 → panel_2).
 */
function buildClockwisePanelOrder(rows: number, cols: number): string[] {
  const order: string[] = [];
  if (rows <= 0 || cols <= 0) return order;

  // Simple cases: 1 row or 1 col → normal L-to-R / T-to-B order
  if (rows === 1 || cols === 1) {
    for (let i = 0; i < rows * cols; i++) {
      order.push(makePanelId(i));
    }
    return order;
  }

  // Multi-row, multi-col: clockwise spiral (simplified for 2×2)
  // Top row L→R, right col T→B, bottom row R→L, left col B→T
  const visited = new Set<number>();
  let top = 0, bottom = rows - 1, left = 0, right = cols - 1;
  while (top <= bottom && left <= right) {
    for (let c = left; c <= right; c++) { const idx = top * cols + c; if (!visited.has(idx)) { visited.add(idx); order.push(makePanelId(idx)); } }
    top++;
    for (let r = top; r <= bottom; r++) { const idx = r * cols + right; if (!visited.has(idx)) { visited.add(idx); order.push(makePanelId(idx)); } }
    right--;
    for (let c = right; c >= left; c--) { const idx = bottom * cols + c; if (!visited.has(idx)) { visited.add(idx); order.push(makePanelId(idx)); } }
    bottom--;
    for (let r = bottom; r >= top; r--) { const idx = r * cols + left; if (!visited.has(idx)) { visited.add(idx); order.push(makePanelId(idx)); } }
    left++;
  }
  return order;
}

// ─── Action Dispatch ──────────────────────────────────────────────

/**
 * Execute a hotkey action by calling the appropriate store methods.
 * Returns true if the action was handled (caller should preventDefault).
 */
/** How a hotkey-chosen tool is named in the viewport readout. */
const TOOL_HUD_LABEL: Partial<Record<string, string>> = {
  [ToolName.WindowLevel]: 'Window/Level', [ToolName.Pan]: 'Pan', [ToolName.Zoom]: 'Zoom',
  [ToolName.Length]: 'Length', [ToolName.Angle]: 'Angle', [ToolName.Bidirectional]: 'Bidirectional',
  [ToolName.Probe]: 'Probe', [ToolName.ArrowAnnotate]: 'Arrow', [ToolName.Crosshairs]: 'Crosshairs',
  [ToolName.Brush]: 'Brush', [ToolName.ThresholdBrush]: 'Threshold', [ToolName.CircleScissors]: 'Circle',
  [ToolName.RectangleScissors]: 'Rect', [ToolName.StackScroll]: 'Scroll',
};

/** The readout a handled hotkey leaves on the active viewport (null = none). */
function hudTextFor(action: HotkeyAction): string | null {
  const tool = TOOL_ACTION_MAP[action];
  if (tool) return TOOL_HUD_LABEL[tool] ?? null;
  const seg = useSegmentationStore.getState();
  switch (action) {
    case 'annotation.toggleEditMode': return `Mode: ${seg.editMode === 'erase' ? 'Erase' : 'Fill'}`;
    case 'brush.decrease':
    case 'brush.increase': return `Brush ${seg.brushSize} mm`;
    case 'view.toggleHidePhi': return usePreferencesStore.getState().preferences.hidePhi ? 'PHI hidden' : 'PHI shown';
    default: return null;
  }
}

/**
 * A readout an action states itself, from its INTENT — for actions whose effect reaches
 * the stores asynchronously (mask visibility syncs from Cornerstone events), so reading
 * the store right after would report the old state.
 */
let actionHud: string | null = null;

function dispatchAction(action: HotkeyAction): boolean {
  actionHud = null;
  const handled = dispatchActionInner(action);
  if (handled) {
    const text = actionHud ?? hudTextFor(action);
    if (text) useHudStore.getState().show(text);
  }
  return handled;
}

function dispatchActionInner(action: HotkeyAction): boolean {
  const viewerState = useViewerStore.getState();

  // ─── Tool switching ─────────────────────────────────────────
  const toolName = TOOL_ACTION_MAP[action];
  if (toolName) {
    viewerState.setActiveTool(toolName);
    return true;
  }

  // ─── Layout switching ───────────────────────────────────────
  const layoutType = LAYOUT_ACTION_MAP[action];
  if (layoutType) {
    viewerState.setLayout(layoutType);
    return true;
  }

  // ─── Everything else ────────────────────────────────────────
  switch (action) {
    // Viewport actions
    case 'annotation.toggleEditMode':
      unifiedToolService.toggleEditMode();
      return true;
    case 'segmentation.toggleMasks': {
      const seg = useSegmentationStore.getState();
      const c = seg.segmentations.find((s) => s.segmentationId === seg.activeSegmentationId);
      if (!c) return false;
      // Visibility as the panel shows it: the manager's presentation override wins over
      // the summary's flag (which does not follow a hide), exactly as the member rows read it.
      const pres = useSegmentationManagerStore.getState().presentation[c.segmentationId];
      const show = !c.segments.some((m) => pres?.visibility?.[m.segmentIndex] ?? m.visible);
      segmentationManager.setAllMembersVisible(c.segmentationId, show);
      actionHud = show ? 'Masks shown' : 'Masks hidden';
      return true;
    }
    case 'view.toggleHidePhi': {
      const prefs = usePreferencesStore.getState();
      prefs.setHidePhi(prefs.preferences.hidePhi !== true);
      return true;
    }
    case 'operation.cleanup': {
      // Only meaningful with a Segmentation active and the panel showing it.
      const seg = useSegmentationStore.getState();
      if (!seg.activeSegmentationId || !seg.showPanel) return false;
      useOperationSheetStore.getState().openOperation('cleanup');
      return true;
    }
    case 'viewport.reset':
      viewerState.resetViewport();
      return true;
    case 'viewport.toggleInvert':
      viewerState.toggleInvert();
      return true;
    case 'viewport.rotate90':
      viewerState.rotate90();
      return true;
    case 'viewport.flipH':
      viewerState.flipH();
      return true;
    case 'viewport.flipV':
      viewerState.flipV();
      return true;
    case 'viewport.zoomIn':
      viewportService.zoomBy(viewerState.activeViewportId, 1.2);
      return true;
    case 'viewport.zoomOut':
      viewportService.zoomBy(viewerState.activeViewportId, 1 / 1.2);
      return true;
    case 'viewport.toggleCine':
      viewerState.toggleCine();
      return true;

    // Panel toggles
    case 'panel.toggleSegmentation':
      useSegmentationStore.getState().togglePanel();
      return true;
    case 'panel.nextViewport': {
      // Cycle active viewport clockwise through visible panels
      const panelCount = viewerState.layoutConfig.panelCount;
      if (panelCount <= 1) return true;
      const order = buildClockwisePanelOrder(viewerState.layoutConfig.rows, viewerState.layoutConfig.cols);
      const currentIdx = order.indexOf(viewerState.activeViewportId);
      const nextIdx = (currentIdx + 1) % order.length;
      viewerState.setActiveViewport(order[nextIdx]);
      focusViewportElement(order[nextIdx]);
      return true;
    }

    // Brush size
    case 'brush.decrease':
      // Single entry point: clamps, writes the unified tool group (the group the
      // brush actually runs on) and the store the panel slider reads.
      unifiedToolService.setBrushSize(useSegmentationStore.getState().brushSize - 2);
      return true;
    case 'brush.increase':
      unifiedToolService.setBrushSize(useSegmentationStore.getState().brushSize + 2);
      return true;

    // Edit actions
    case 'edit.undo':
      segmentationService.undo();
      return true;
    case 'edit.redo':
      segmentationService.redo();
      return true;
    case 'edit.copy':
      // Copy the selection — contours, else mask islands (else the active segment's islands
      // on this slice). The last copy wins: each clears the other clipboard.
      if (segmentationService.copySelectedContourAnnotation()) {
        unifiedSegService.clearVoxelClipboard();
        return true;
      }
      if (unifiedSegService.copySegmentVoxels()) {
        segmentationService.clearContourClipboard();
        return true;
      }
      return false;
    case 'edit.paste':
      // Prefer a voxel clipboard (NN-resampled, translated to the current slice);
      // otherwise paste a copied contour.
      return unifiedSegService.hasVoxelClipboard()
        ? unifiedSegService.pasteActiveSegmentVoxels()
        : segmentationService.pasteCopiedContourAnnotationToActiveSlice();
    case 'edit.delete':
      // Delete the selection — contours, else mask islands (never a fallback).
      if (!segmentationService.deleteSelectedContourComponents()) unifiedSegService.deleteSelectedIslands();
      return true;

    // Slice navigation
    case 'slice.prev':
    case 'slice.next':
    case 'slice.prevPage':
    case 'slice.nextPage':
    case 'slice.first':
    case 'slice.last':
      return handleSliceNavigation(action, viewerState);

    // W/L presets
    case 'preset.wl.0':
    case 'preset.wl.1':
    case 'preset.wl.2':
    case 'preset.wl.3':
    case 'preset.wl.4': {
      const index = parseInt(action.split('.')[2], 10);
      const preset = WL_PRESETS[index];
      if (preset) {
        viewerState.applyWLPreset(preset);
        viewerState.setActiveTool(ToolName.WindowLevel);
      }
      return true;
    }

    default:
      return false;
  }
}

/**
 * Handle slice navigation for both stack and MPR viewports.
 * Replicates the logic from ViewportGrid.tsx and MPRViewportGrid.tsx.
 */
function handleSliceNavigation(
  action: HotkeyAction,
  viewerState: ReturnType<typeof useViewerStore.getState>,
): boolean {
  const pid = viewerState.activeViewportId;

  // Slice nav (the unified path also uses wheel/StackScroll for scrolling).
  const vp = viewerState.viewports[pid];
  if (!vp || vp.totalImages <= 1) return false;

  let delta = 0;
  let jumpTo: number | null = null;

  switch (action) {
    case 'slice.prev':     delta = -1;  break;
    case 'slice.next':     delta = 1;   break;
    case 'slice.prevPage': delta = -10; break;
    case 'slice.nextPage': delta = 10;  break;
    case 'slice.first':    jumpTo = 0;  break;
    case 'slice.last':     jumpTo = vp.totalImages - 1; break;
  }

  const baseIndex = vp.requestedImageIndex ?? vp.imageIndex;
  let targetIndex = baseIndex;
  if (jumpTo !== null) {
    targetIndex = jumpTo;
  } else if (delta !== 0) {
    targetIndex = baseIndex + delta;
  }
  targetIndex = Math.max(0, Math.min(vp.totalImages - 1, targetIndex));

  if (targetIndex !== baseIndex) {
    viewerState._requestImageIndex(pid, targetIndex, vp.totalImages);
    viewportService.scrollToIndex(pid, targetIndex);
  }
  return true;
}

// ─── Module State ─────────────────────────────────────────────────

let currentMap: HotkeyMap = { ...DEFAULT_HOTKEY_MAP };
let lookup = buildLookup(currentMap);
let listenerInstalled = false;

// ─── Keydown Handler ──────────────────────────────────────────────

/**
 * Move DOM focus onto a viewport, so a keyboard action that takes the user there takes
 * their focus with it.
 *
 * Tab is bound to viewport cycling and the default focus move is prevented, so without
 * this, focus stays wherever it last landed — typically the XNAT browser row the user
 * clicked to load the scan. That row keeps DOM focus silently (a mouse click does not
 * grant :focus-visible, so nothing is drawn), and the moment Tab flips Chrome into
 * keyboard modality it starts matching :focus-visible and sprouts a focus ring, on an
 * element the user stopped thinking about several actions ago. Reported as an outline
 * appearing in the browser "very sporadically, typically when I tab viewports".
 *
 * Keeping focus with the active viewport is also the invariant the outline scheme rests
 * on: the focused element and the active viewport should be the same place.
 */
function focusViewportElement(panelId: string): void {
  const el = document.querySelector(`[data-testid="unified-viewport:${panelId}"]`);
  (el as HTMLElement | null)?.focus?.();
}

/**
 * Move DOM focus onto the currently-active viewport, whichever it is.
 *
 * Used to return the keyboard to the image after a side-panel text edit ends — e.g.
 * once the create-in-edit-mode naming sequence (container label → member label) is
 * accepted, focus belongs back on the viewport so shortcuts reach the image again and
 * the outline invariant (focused element === active viewport) holds. No-op if no
 * viewport is active (nothing loaded yet).
 */
function focusActiveViewport(): void {
  const el = document.querySelector('[data-testid^="unified-viewport:"][data-active="true"]');
  (el as HTMLElement | null)?.focus?.();
}

/**
 * While an annotation is being named, keystrokes are CAPTURED into the label instead of
 * acting as shortcuts — without the label ever taking DOM focus.
 *
 * Focus stays on the viewport throughout, so the wheel and the navigation shortcuts keep
 * working while the user types a name, and no browser focus ring is ever drawn on a
 * panel label. The handler returns true for the keys it consumed; everything it declines
 * (arrows, page keys, anything with a modifier) falls through to the normal shortcuts,
 * which is what lets the user scroll mid-name.
 */
let nameCaptureHandler: ((e: KeyboardEvent) => boolean) | null = null;

/**
 * Key layers (SegWorks parity D12 — sheet-scoped keys): while a mode is open (an
 * operation sheet, a pending preview) it may claim keys AHEAD of the global map, and
 * gives them back when it closes. Newest layer first; a layer returns true for the keys
 * it consumed and declines everything else, which falls through to the global shortcuts.
 * Layers never see keystrokes typed into a form field.
 */
export interface KeyLayer {
  onKeyDown(e: KeyboardEvent): boolean;
  onKeyUp?(e: KeyboardEvent): boolean;
}
const keyLayers: KeyLayer[] = [];

function inFormField(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  const tag = t?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!t?.isContentEditable;
}

function handleKeyUp(e: KeyboardEvent): void {
  if (inFormField(e)) return;
  for (let i = keyLayers.length - 1; i >= 0; i--) {
    if (keyLayers[i].onKeyUp?.(e)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
  }
}

function handleKeyDown(e: KeyboardEvent): void {
  // Naming capture runs BEFORE the form-control guard and before any shortcut: it is
  // active precisely when focus is NOT in a field, which is the whole point.
  if (nameCaptureHandler && nameCaptureHandler(e)) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  // Input guard: don't intercept when focus is in a form element,
  // UNLESS it's Tab which we want for viewport cycling even from controls.
  const tag = (e.target as HTMLElement)?.tagName;
  const isTextInput = tag === 'INPUT' || tag === 'TEXTAREA';
  const isFormControl = isTextInput || tag === 'SELECT';
  if (isFormControl) {
    // Allow Tab through even in form controls (for viewport cycling)
    if (e.key !== 'Tab') return;
  }

  // Also guard for contentEditable elements (except Tab)
  if ((e.target as HTMLElement)?.isContentEditable && e.key !== 'Tab') return;

  if (!inFormField(e)) {
    for (let i = keyLayers.length - 1; i >= 0; i--) {
      if (keyLayers[i].onKeyDown(e)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }
  }

  // Build normalized key from the event
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('ctrl');
  if (e.shiftKey) parts.push('shift');
  if (e.altKey) parts.push('alt');
  if (e.metaKey) parts.push('meta');
  parts.push(e.key.toLowerCase());
  const normalized = parts.join('+');

  const action = lookup.get(normalized);
  if (!action) return;

  const handled = dispatchAction(action);
  if (handled) {
    e.preventDefault();
    e.stopPropagation();
  }
}

// ─── Public API ───────────────────────────────────────────────────

export const hotkeyService = {
  /**
   * Install the global keydown listener.
   * Idempotent — calling multiple times is safe.
   */
  install(): void {
    if (listenerInstalled) return;
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.addEventListener('keyup', handleKeyUp, { capture: true });
    listenerInstalled = true;
    console.log('[hotkeyService] Global keyboard listener installed');
  },

  /**
   * Remove the global keydown listener.
   */
  uninstall(): void {
    if (!listenerInstalled) return;
    window.removeEventListener('keydown', handleKeyDown, { capture: true });
    window.removeEventListener('keyup', handleKeyUp, { capture: true });
    listenerInstalled = false;
    console.log('[hotkeyService] Global keyboard listener removed');
  },

  /**
   * Replace the entire hotkey map. Rebuilds the lookup table.
   */
  setHotkeyMap(map: HotkeyMap): void {
    currentMap = map;
    lookup = buildLookup(currentMap);
  },

  /**
   * Merge overrides into the current hotkey map.
   * Allows partial overrides without replacing the entire map.
   */
  mergeOverrides(overrides: HotkeyMap): void {
    currentMap = { ...currentMap, ...overrides };
    lookup = buildLookup(currentMap);
  },

  /**
   * Get the current hotkey map (for display in a settings UI).
   */
  /**
   * Register (or clear, with null) the handler that receives keystrokes while an
   * annotation name is being typed. Exactly one may be active; the panel sets it when a
   * naming sequence starts and clears it when the sequence ends.
   */
  setNameCaptureHandler(handler: ((e: KeyboardEvent) => boolean) | null): void {
    nameCaptureHandler = handler;
  },

  /** Push a key layer (see KeyLayer); returns the function that removes it. */
  pushKeyLayer(layer: KeyLayer): () => void {
    keyLayers.push(layer);
    return () => {
      const i = keyLayers.lastIndexOf(layer);
      if (i >= 0) keyLayers.splice(i, 1);
    };
  },

  getHotkeyMap(): HotkeyMap {
    return { ...currentMap };
  },

  /**
   * Return DOM focus to the active viewport (see focusActiveViewport). Called by the
   * annotations panel when an inline label edit ends and the keyboard should go back
   * to the image.
   */
  focusActiveViewport(): void {
    focusActiveViewport();
  },
};
