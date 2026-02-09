/**
 * Tool Service — manages Cornerstone3D tool groups, tool activation,
 * and mouse/keyboard bindings.
 *
 * Left-click cycles between tools (WindowLevel, Pan, Zoom, Length).
 * Right-click is always Zoom. Middle-click is always Pan.
 * Mouse wheel is always StackScroll.
 *
 * Supports multiple viewports via a single shared ToolGroup.
 * All panels share the same active tool (standard DICOM viewer UX).
 *
 * IMPORTANT: Cornerstone3D v4's setToolActive() MERGES bindings with
 * any existing bindings on the tool. This means we can't just call
 * setToolActive(newTool, Primary) — if that tool already has a fixed
 * binding (like Pan=Auxiliary), it'll accumulate both. We must fully
 * rebuild all bindings on each switch by disabling everything first,
 * then re-activating with the complete binding set.
 */
import {
  ToolGroupManager,
  StackScrollTool,
  ZoomTool,
  PanTool,
  WindowLevelTool,
  LengthTool,
  AngleTool,
  BidirectionalTool,
  EllipticalROITool,
  RectangleROITool,
  CircleROITool,
  ProbeTool,
  ArrowAnnotateTool,
  PlanarFreehandROITool,
  CrosshairsTool,
  BrushTool,
  PlanarFreehandContourSegmentationTool,
  SplineContourSegmentationTool,
  LivewireContourSegmentationTool,
  CircleScissorsTool,
  RectangleScissorsTool,
  PaintFillTool,
  SculptorTool,
  Enums as ToolEnums,
  segmentation as csSegmentation,
} from '@cornerstonejs/tools';
import type { Types as ToolTypes } from '@cornerstonejs/tools';
import { getRenderingEngine } from '@cornerstonejs/core';
import {
  ToolName,
  ANNOTATION_TOOLS,
  SEGMENTATION_TOOLS,
  CONTOUR_SEG_TOOLS,
  LABELMAP_SEG_TOOLS,
} from '@shared/types/viewer';
import { viewportService } from './viewportService';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { segmentationService } from './segmentationService';
import { useViewerStore } from '../../stores/viewerStore';

const TOOL_GROUP_ID = 'xnatToolGroup_primary';

/** Map ToolName enum to Cornerstone tool class name */
const TOOL_NAME_MAP: Record<ToolName, string> = {
  [ToolName.WindowLevel]: WindowLevelTool.toolName,
  [ToolName.Pan]: PanTool.toolName,
  [ToolName.Zoom]: ZoomTool.toolName,
  [ToolName.StackScroll]: StackScrollTool.toolName,
  [ToolName.Length]: LengthTool.toolName,
  [ToolName.Angle]: AngleTool.toolName,
  [ToolName.Bidirectional]: BidirectionalTool.toolName,
  [ToolName.EllipticalROI]: EllipticalROITool.toolName,
  [ToolName.RectangleROI]: RectangleROITool.toolName,
  [ToolName.CircleROI]: CircleROITool.toolName,
  [ToolName.Probe]: ProbeTool.toolName,
  [ToolName.ArrowAnnotate]: ArrowAnnotateTool.toolName,
  [ToolName.PlanarFreehandROI]: PlanarFreehandROITool.toolName,
  [ToolName.Crosshairs]: CrosshairsTool.toolName,
  // Labelmap segmentation tools — Brush/Eraser/ThresholdBrush all map to BrushTool
  [ToolName.Brush]: BrushTool.toolName,
  [ToolName.Eraser]: BrushTool.toolName,
  [ToolName.ThresholdBrush]: BrushTool.toolName,
  [ToolName.CircleScissors]: CircleScissorsTool.toolName,
  [ToolName.RectangleScissors]: RectangleScissorsTool.toolName,
  [ToolName.PaintFill]: PaintFillTool.toolName,
  // Contour segmentation tools
  [ToolName.FreehandContour]: PlanarFreehandContourSegmentationTool.toolName,
  [ToolName.SplineContour]: SplineContourSegmentationTool.toolName,
  [ToolName.LivewireContour]: LivewireContourSegmentationTool.toolName,
  [ToolName.Sculptor]: SculptorTool.toolName,
};

const { Primary, Auxiliary, Secondary } = ToolEnums.MouseBindings;

let currentActiveTool: ToolName = ToolName.WindowLevel;

function getToolGroup(): ToolTypes.IToolGroup | undefined {
  return ToolGroupManager.getToolGroup(TOOL_GROUP_ID);
}

/** Configuration for ArrowAnnotateTool (passed during addTool) */
const ARROW_ANNOTATE_CONFIG = {
  getTextCallback: arrowAnnotateTextCallback,
  changeTextCallback: arrowAnnotateTextCallback,
};

/**
 * Rebuild all tool bindings from scratch by destroying and recreating the
 * tool group. This is the only safe way to fully clear Cornerstone3D's
 * internal binding state — the public API (setToolActive/setToolDisabled)
 * merges bindings rather than replacing them.
 *
 * On recreation we:
 * 1. Collect the list of viewportIds currently in the group
 * 2. Destroy the tool group
 * 3. Recreate it with all tools
 * 4. Re-add the viewports
 * 5. Set the desired Active/Enabled/Disabled modes via public APIs only
 */
function rebuildToolGroup(primaryTool: ToolName): ToolTypes.IToolGroup | undefined {
  const oldGroup = getToolGroup();

  // Collect viewport IDs before destroying the group
  const viewportIds: string[] = [];
  if (oldGroup) {
    try {
      const vpEntries = oldGroup.getViewportIds();
      for (const entry of vpEntries) {
        // getViewportIds() returns string[] in CS3D v4 typings but may
        // return { viewportId, renderingEngineId }[] at runtime.
        const vpId = typeof entry === 'string' ? entry : (entry as any).viewportId;
        if (vpId) viewportIds.push(vpId);
      }
    } catch { /* ok */ }
  }

  // Destroy existing group
  try { ToolGroupManager.destroyToolGroup(TOOL_GROUP_ID); } catch { /* ok */ }

  // Recreate
  const toolGroup = ToolGroupManager.createToolGroup(TOOL_GROUP_ID);
  if (!toolGroup) {
    console.error('[toolService] Failed to recreate tool group');
    return undefined;
  }

  // Add all tools
  addAllTools(toolGroup);

  // Re-add viewports
  for (const vpId of viewportIds) {
    toolGroup.addViewport(vpId, viewportService.ENGINE_ID);
  }

  // Restore the brush size from the store — addAllTools creates fresh tool
  // instances with Cornerstone's default (25), so we must re-apply the
  // user's chosen size.
  const brushSize = useSegmentationStore.getState().brushSize;
  segmentationService.setBrushSize(brushSize);

  // Apply bindings using public APIs only
  applyBindings(toolGroup, primaryTool);

  return toolGroup;
}

/**
 * Add all tools to a tool group (used during initial creation and recreation).
 */
function addAllTools(toolGroup: ToolTypes.IToolGroup): void {
  toolGroup.addTool(WindowLevelTool.toolName);
  toolGroup.addTool(PanTool.toolName);
  toolGroup.addTool(ZoomTool.toolName);
  toolGroup.addTool(StackScrollTool.toolName);
  toolGroup.addTool(LengthTool.toolName);
  toolGroup.addTool(AngleTool.toolName);
  toolGroup.addTool(BidirectionalTool.toolName);
  toolGroup.addTool(EllipticalROITool.toolName);
  toolGroup.addTool(RectangleROITool.toolName);
  toolGroup.addTool(CircleROITool.toolName);
  toolGroup.addTool(ProbeTool.toolName);
  toolGroup.addTool(ArrowAnnotateTool.toolName, ARROW_ANNOTATE_CONFIG);
  toolGroup.addTool(PlanarFreehandROITool.toolName);
  toolGroup.addTool(BrushTool.toolName);
  toolGroup.addTool(CircleScissorsTool.toolName);
  toolGroup.addTool(RectangleScissorsTool.toolName);
  toolGroup.addTool(PaintFillTool.toolName);
  toolGroup.addTool(PlanarFreehandContourSegmentationTool.toolName);
  toolGroup.addTool(SplineContourSegmentationTool.toolName);
  toolGroup.addTool(LivewireContourSegmentationTool.toolName);
  toolGroup.addTool(SculptorTool.toolName);
}

/**
 * Set tool modes and bindings using only public APIs.
 * Called on a freshly created tool group where all tools start in their
 * default (added but not active) state — no stale bindings to worry about.
 */
function applyBindings(toolGroup: ToolTypes.IToolGroup, primaryTool: ToolName): void {
  // 1. Activate the primary tool with Left-click (+ fixed binding if Pan/Zoom)
  const primaryCsName = TOOL_NAME_MAP[primaryTool];
  const primaryBindings: any[] = [{ mouseButton: Primary }];
  if (primaryTool === ToolName.Pan) {
    primaryBindings.push({ mouseButton: Auxiliary });
  } else if (primaryTool === ToolName.Zoom) {
    primaryBindings.push({ mouseButton: Secondary });
  }
  toolGroup.setToolActive(primaryCsName, { bindings: primaryBindings });

  // 2. Activate fixed-binding tools (if not already the primary)
  if (primaryTool !== ToolName.Pan) {
    toolGroup.setToolActive(PanTool.toolName, {
      bindings: [{ mouseButton: Auxiliary }],
    });
  }
  if (primaryTool !== ToolName.Zoom) {
    toolGroup.setToolActive(ZoomTool.toolName, {
      bindings: [{ mouseButton: Secondary }],
    });
  }

  // StackScroll — keep Disabled because we handle wheel/trackpad scrolling
  // ourselves in CornerstoneViewport's custom wheel handler. StackScrollTool
  // has no visual annotations, so Enabled mode provides no benefit and risks
  // consuming wheel events on some Cornerstone3D versions.
  if (primaryTool !== ToolName.StackScroll) {
    toolGroup.setToolDisabled(StackScrollTool.toolName);
  }

  // 3. All annotation tools stay Enabled (annotations visible/hoverable)
  //    unless they are the active primary tool.
  for (const annTool of ANNOTATION_TOOLS) {
    if (annTool !== primaryTool) {
      toolGroup.setToolEnabled(TOOL_NAME_MAP[annTool]);
    }
  }

  // 4. Contour seg tools stay Enabled when not active (persistent annotations).
  //    Labelmap seg tools stay in their default state (not activated = passive/disabled).
  for (const contourTool of CONTOUR_SEG_TOOLS) {
    const csName = TOOL_NAME_MAP[contourTool];
    if (csName && contourTool !== primaryTool) {
      toolGroup.setToolEnabled(csName);
    }
  }

  console.log(`[toolService] applyBindings(${primaryTool})`);
}

/**
 * Custom text callback for ArrowAnnotateTool.
 * Electron blocks window.prompt(), so we use a floating <input> element
 * positioned at the center of the viewport to capture the label text.
 */
function arrowAnnotateTextCallback(
  doneChangingTextCallback: (label: string) => void,
): void {
  // Create overlay + input
  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5)';

  const container = document.createElement('div');
  container.style.cssText =
    'background:#18181b;border:1px solid #3f3f46;border-radius:8px;padding:16px;min-width:280px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5)';

  const label = document.createElement('div');
  label.textContent = 'Enter annotation label:';
  label.style.cssText = 'color:#d4d4d8;font-size:13px;margin-bottom:8px';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Annotation';
  input.style.cssText =
    'width:100%;padding:6px 10px;background:#27272a;border:1px solid #3f3f46;border-radius:4px;color:#fafafa;font-size:13px;outline:none;box-sizing:border-box';

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;margin-top:12px;justify-content:flex-end';

  const btnCancel = document.createElement('button');
  btnCancel.textContent = 'Cancel';
  btnCancel.style.cssText =
    'padding:4px 14px;border-radius:4px;font-size:12px;background:#3f3f46;color:#d4d4d8;border:none;cursor:pointer';

  const btnOk = document.createElement('button');
  btnOk.textContent = 'OK';
  btnOk.style.cssText =
    'padding:4px 14px;border-radius:4px;font-size:12px;background:#2563eb;color:white;border:none;cursor:pointer';

  container.appendChild(label);
  container.appendChild(input);
  btnRow.appendChild(btnCancel);
  btnRow.appendChild(btnOk);
  container.appendChild(btnRow);
  overlay.appendChild(container);
  document.body.appendChild(overlay);

  function finish(value: string) {
    document.body.removeChild(overlay);
    doneChangingTextCallback(value);
  }

  btnOk.addEventListener('click', () => finish(input.value || 'Arrow'));
  btnCancel.addEventListener('click', () => finish(''));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(input.value || 'Arrow');
    if (e.key === 'Escape') finish('');
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) finish('');
  });

  // Focus input after a tick (DOM needs to settle)
  requestAnimationFrame(() => input.focus());
}

export const toolService = {
  TOOL_GROUP_ID,

  /**
   * Create the tool group with tools and default bindings.
   * Does NOT add any viewports — call addViewport() separately.
   */
  initialize(): void {
    // Destroy existing tool group if any
    try { ToolGroupManager.destroyToolGroup(TOOL_GROUP_ID); } catch { /* ok */ }

    const toolGroup = ToolGroupManager.createToolGroup(TOOL_GROUP_ID);
    if (!toolGroup) {
      console.error('[toolService] Failed to create tool group');
      return;
    }

    addAllTools(toolGroup);

    // Restore the brush size from the store — addAllTools creates fresh tool
    // instances with Cornerstone's default (25), so we must re-apply the
    // user's chosen size.
    const brushSize = useSegmentationStore.getState().brushSize;
    segmentationService.setBrushSize(brushSize);

    // Apply initial bindings with W/L as primary
    currentActiveTool = ToolName.WindowLevel;
    applyBindings(toolGroup, currentActiveTool);

    console.log('[toolService] Tool group initialized (no viewports yet)');
  },

  /**
   * Add a viewport to the shared tool group.
   * Call after viewportService.createViewport().
   */
  addViewport(viewportId: string): void {
    const toolGroup = getToolGroup();
    if (!toolGroup) {
      console.warn('[toolService] No tool group — call initialize() first');
      return;
    }
    toolGroup.addViewport(viewportId, viewportService.ENGINE_ID);

    // Sync the store's brush size to Cornerstone3D now that the tool group
    // has at least one viewport — setBrushSizeForToolGroup is a no-op when
    // the tool group has no viewports.
    const brushSize = useSegmentationStore.getState().brushSize;
    segmentationService.setBrushSize(brushSize);

    console.log('[toolService] Viewport added to tool group:', viewportId);
  },

  /**
   * Remove a viewport from the shared tool group.
   * Call before viewportService.destroyViewport().
   */
  removeViewport(viewportId: string): void {
    const toolGroup = getToolGroup();
    if (!toolGroup) return;
    try {
      toolGroup.removeViewports(viewportService.ENGINE_ID, viewportId);
    } catch { /* ok — may already be removed */ }
    console.log('[toolService] Viewport removed from tool group:', viewportId);
  },

  /**
   * Switch the active left-click tool by destroying and recreating the
   * tool group with clean bindings (no stale merged state).
   *
   * For segmentation tools, also handles:
   * - Auto-creating a segmentation if none exists (seamless UX)
   * - Auto-opening the segmentation panel
   * - Setting segment index: Eraser→0, Brush/ThresholdBrush→activeSegmentIndex
   */
  setActiveTool(toolName: ToolName): void {
    if (toolName === currentActiveTool) return;

    if (!getToolGroup()) return;

    // Handle segmentation tool activation
    if (SEGMENTATION_TOOLS.has(toolName)) {
      const segStore = useSegmentationStore.getState();
      segStore.setActiveSegTool(toolName);

      // Auto-open the segmentation panel
      if (!segStore.showPanel) {
        segStore.togglePanel();
      }

      // If no segmentation exists yet, auto-create one BEFORE activating the tool.
      // Segmentation tools crash if they receive mouse events without a segmentation
      // on the viewport, so we must NOT rebuild until the segmentation is ready.
      if (!segStore.activeSegmentationId) {
        const viewportId = useViewerStore.getState().activeViewportId;
        try {
          const engine = getRenderingEngine(viewportService.ENGINE_ID);
          const viewport = engine?.getViewport(viewportId);
          if (viewport && 'getImageIds' in viewport) {
            const imageIds = (viewport as any).getImageIds() as string[];
            if (imageIds && imageIds.length > 0) {
              // Create segmentation first, then activate the tool
              segmentationService.createStackSegmentation(imageIds).then((segId) => {
                return segmentationService.addToViewport(viewportId, segId);
              }).then(async () => {
                const updatedStore = useSegmentationStore.getState();
                const segId = updatedStore.activeSegmentationId;
                if (segId) {
                  // Set the active segment index
                  if (toolName === ToolName.Eraser) {
                    csSegmentation.segmentIndex.setActiveSegmentIndex(segId, 0);
                  } else {
                    csSegmentation.segmentIndex.setActiveSegmentIndex(segId, updatedStore.activeSegmentIndex);
                  }

                  // Ensure contour representation for contour tools
                  if (CONTOUR_SEG_TOOLS.has(toolName)) {
                    const vpId = useViewerStore.getState().activeViewportId;
                    await segmentationService.ensureContourRepresentation(vpId, segId);
                  }
                }

                // NOW activate the tool — segmentation is fully registered
                currentActiveTool = toolName;
                rebuildToolGroup(toolName);
                console.log('[toolService] Active tool:', toolName, '(after auto-creating segmentation)');
              }).catch((err) => {
                console.error('[toolService] Failed to auto-create segmentation:', err);
              });
            } else {
              console.warn('[toolService] Cannot auto-create segmentation — no images in viewport');
            }
          }
        } catch (err) {
          console.warn('[toolService] Cannot auto-create segmentation:', err);
        }
        // Return early — don't activate the tool yet. It will be activated
        // in the .then() callback above once the segmentation is ready.
        return;
      }

      // Segmentation already exists
      const segId = segStore.activeSegmentationId;
      if (segId) {
        if (toolName === ToolName.Eraser) {
          csSegmentation.segmentIndex.setActiveSegmentIndex(segId, 0);
        } else {
          csSegmentation.segmentIndex.setActiveSegmentIndex(segId, segStore.activeSegmentIndex);
        }

        // Ensure contour representation for contour tools
        if (CONTOUR_SEG_TOOLS.has(toolName)) {
          const viewportId = useViewerStore.getState().activeViewportId;
          segmentationService.ensureContourRepresentation(viewportId, segId).then(() => {
            currentActiveTool = toolName;
            rebuildToolGroup(toolName);
            console.log('[toolService] Active tool:', toolName);
          });
          return;
        }
      }

      // Non-contour seg tool — activate immediately
      currentActiveTool = toolName;
      rebuildToolGroup(toolName);
    } else {
      // Non-segmentation tool — activate immediately
      currentActiveTool = toolName;
      rebuildToolGroup(toolName);
      // When switching away from seg tools, clear activeSegTool
      useSegmentationStore.getState().setActiveSegTool(null);
    }

    console.log('[toolService] Active tool:', toolName);
  },

  /**
   * Get the currently active left-click tool name.
   */
  getActiveTool(): ToolName {
    return currentActiveTool;
  },

  /**
   * Destroy the tool group. Call on full viewer unmount.
   */
  destroy(): void {
    try { ToolGroupManager.destroyToolGroup(TOOL_GROUP_ID); } catch { /* ok */ }
    currentActiveTool = ToolName.WindowLevel;
    console.log('[toolService] Tool group destroyed');
  },
};
