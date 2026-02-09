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
import { ToolName, WL_PRESETS } from '@shared/types/viewer';
import type { LayoutType } from '@shared/types/viewer';
import { DEFAULT_HOTKEY_MAP } from './defaultHotkeyMap';
import { useViewerStore } from '../../stores/viewerStore';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { useAnnotationStore } from '../../stores/annotationStore';
import { viewportService } from '../cornerstone/viewportService';
import { mprService } from '../cornerstone/mprService';
import { segmentationService } from '../cornerstone/segmentationService';

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
  'tool.eraser':           ToolName.Eraser,
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

// ─── Action Dispatch ──────────────────────────────────────────────

/**
 * Execute a hotkey action by calling the appropriate store methods.
 * Returns true if the action was handled (caller should preventDefault).
 */
function dispatchAction(action: HotkeyAction): boolean {
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
    if (viewerState.mprActive) return false; // Layout locked in MPR
    viewerState.setLayout(layoutType);
    return true;
  }

  // ─── Everything else ────────────────────────────────────────
  switch (action) {
    // Viewport actions
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
      if (viewerState.mprActive) return false;
      viewerState.toggleCine();
      return true;

    // Panel toggles
    case 'panel.toggleAnnotations':
      useAnnotationStore.getState().togglePanel();
      return true;
    case 'panel.toggleSegmentation':
      useSegmentationStore.getState().togglePanel();
      return true;

    // Brush size
    case 'brush.decrease': {
      const segStore = useSegmentationStore.getState();
      const newSize = Math.max(1, segStore.brushSize - 2);
      segStore.setBrushSize(newSize);
      segmentationService.setBrushSize(newSize);
      return true;
    }
    case 'brush.increase': {
      const segStore = useSegmentationStore.getState();
      const newSize = Math.min(100, segStore.brushSize + 2);
      segStore.setBrushSize(newSize);
      segmentationService.setBrushSize(newSize);
      return true;
    }

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

  // MPR panel (volume viewport)
  if (pid.startsWith('mpr_panel_')) {
    const mprState = viewerState.mprViewports[pid];
    if (!mprState || mprState.totalSlices <= 1) return false;

    let delta = 0;
    let jumpTo: number | null = null;

    switch (action) {
      case 'slice.prev':     delta = -1;  break;
      case 'slice.next':     delta = 1;   break;
      case 'slice.prevPage': delta = -10; break;
      case 'slice.nextPage': delta = 10;  break;
      case 'slice.first':    jumpTo = 0;  break;
      case 'slice.last':     jumpTo = mprState.totalSlices - 1; break;
    }

    if (jumpTo !== null) {
      mprService.scrollToIndex(pid, jumpTo);
    } else if (delta !== 0) {
      mprService.scroll(pid, delta);
    }
    return true;
  }

  // Stack viewport
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

  if (jumpTo !== null) {
    viewportService.scrollToIndex(pid, jumpTo);
  } else if (delta !== 0) {
    viewportService.scroll(pid, delta);
  }
  return true;
}

// ─── Module State ─────────────────────────────────────────────────

let currentMap: HotkeyMap = { ...DEFAULT_HOTKEY_MAP };
let lookup = buildLookup(currentMap);
let listenerInstalled = false;

// ─── Keydown Handler ──────────────────────────────────────────────

function handleKeyDown(e: KeyboardEvent): void {
  // Input guard: don't intercept when focus is in a form element
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

  // Also guard for contentEditable elements
  if ((e.target as HTMLElement)?.isContentEditable) return;

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
    listenerInstalled = true;
    console.log('[hotkeyService] Global keyboard listener installed');
  },

  /**
   * Remove the global keydown listener.
   */
  uninstall(): void {
    if (!listenerInstalled) return;
    window.removeEventListener('keydown', handleKeyDown, { capture: true });
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
  getHotkeyMap(): HotkeyMap {
    return { ...currentMap };
  },
};
