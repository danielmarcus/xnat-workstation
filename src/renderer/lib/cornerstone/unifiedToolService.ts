/**
 * Unified Tool Service (Phase 1) — the single Cornerstone3D tool group for the
 * new unified-viewport path (the only viewport path).
 *
 * Replaces the old two-group split (toolService's `xnatToolGroup_primary` for
 * stack + mprToolService's `xnatToolGroup_mpr` for volume). One group serves
 * every unified Viewport — stack or volume — and uses Cornerstone's real
 * CrosshairsTool for MPR synchronization (no custom crosshair geometry, no
 * mprToolService). When the panels of an MPR layout share one volume (P1.1),
 * the CrosshairsTool draws reference lines + jumps slices across them natively.
 *
 * A/B-safe: this is a NEW, dedicated group; the old groups are left intact until
 * P1.8 flips the flag and deletes the legacy path. Self-contained singleton-
 * module following the mprToolService pattern.
 *
 * CROSSHAIRS: Cornerstone's native CrosshairsTool is registered but DISABLED and
 * is NOT the default Primary tool. It computes its center as a 3-plane
 * intersection, so it requires ≥2 NON-parallel planes — it crashes on mouse-move
 * in a single viewport and cannot sync same-plane viewports. The default Primary
 * is Window/Level; the plane-agnostic world-point crosshair (reticle + same-plane
 * nearest-slice sync + volume jumpToWorld) replaces it. This matches the prior
 * design, where ToolName.Crosshairs mapped to Window/Level for the Cornerstone
 * slot and a custom service drove the actual crosshair.
 */
import {
  ToolGroupManager,
  CrosshairsTool,
  WindowLevelTool,
  PanTool,
  ZoomTool,
  StackScrollTool,
  LengthTool,
  BrushTool,
  PlanarFreehandContourSegmentationTool,
  // R3.8b — full toolbox tool set (all already addTool'd globally in init.ts).
  AngleTool,
  BidirectionalTool,
  EllipticalROITool,
  RectangleROITool,
  CircleROITool,
  ProbeTool,
  ArrowAnnotateTool,
  PlanarFreehandROITool,
  SplineContourSegmentationTool,
  LivewireContourSegmentationTool,
  CircleScissorsTool,
  RectangleScissorsTool,
  SphereScissorsTool,
  SculptorTool,
  SegmentSelectTool,
  RegionSegmentTool,
  RegionSegmentPlusTool,
  SegmentBidirectionalTool,
  RectangleROIThresholdTool,
  CircleROIStartEndThresholdTool,
  LabelMapEditWithContourTool,
  Enums as ToolEnums,
  utilities as csToolUtilities,
} from '@cornerstonejs/tools';
import type { Types as ToolTypes } from '@cornerstonejs/tools';
import SafePaintFillTool from './tools/SafePaintFillTool';
import { ToolName } from '@shared/types/viewer';
import { viewportService } from './viewportService';
import { ensureContourEditPrereq } from './contourEditPrereq';
import { usePreferencesStore } from '../../stores/preferencesStore';
import { useSegmentationStore } from '../../stores/segmentationStore';

const UNIFIED_TOOL_GROUP_ID = 'xnatToolGroup_unified';

const { Primary, Auxiliary, Secondary, Wheel } = ToolEnums.MouseBindings;

/**
 * ToolName → Cornerstone tool class name, for the subset of tools the unified
 * path supports in Phase 1: navigation + crosshairs + the editing tools needed
 * for signals 1/3/6/7 (Length, freehand contour segmentation, brush).
 */
const UNIFIED_TOOL_MAP: Partial<Record<ToolName, string>> = {
  // ToolName.Crosshairs routes to Window/Level on the Cornerstone Primary slot
  // (NOT the native CrosshairsTool, which crashes in single-viewport / same-plane
  // layouts). The world-point crosshair (unifiedCrosshair) reads activeTool ===
  // Crosshairs to enable click-to-set, so a left CLICK sets the crosshair while a
  // left DRAG still does W/L — exactly the deleted design.
  [ToolName.Crosshairs]: WindowLevelTool.toolName,
  [ToolName.WindowLevel]: WindowLevelTool.toolName,
  [ToolName.Pan]: PanTool.toolName,
  [ToolName.Zoom]: ZoomTool.toolName,
  [ToolName.StackScroll]: StackScrollTool.toolName,
  [ToolName.Length]: LengthTool.toolName,
  [ToolName.FreehandContour]: PlanarFreehandContourSegmentationTool.toolName,
  [ToolName.Brush]: BrushTool.toolName,
  // ── R3.8b: full toolbox set ──
  // Brush family share BrushTool; the strategy (fill/erase/threshold) is selected
  // in setActiveTool via BRUSH_STRATEGY below.
  [ToolName.Eraser]: BrushTool.toolName,
  [ToolName.ThresholdBrush]: BrushTool.toolName,
  // Structure (contour) tools
  [ToolName.SplineContour]: SplineContourSegmentationTool.toolName,
  [ToolName.LivewireContour]: LivewireContourSegmentationTool.toolName,
  [ToolName.Sculptor]: SculptorTool.toolName,
  // Segmentation editing tools
  [ToolName.CircleScissors]: CircleScissorsTool.toolName,
  [ToolName.RectangleScissors]: RectangleScissorsTool.toolName,
  [ToolName.SphereScissors]: SphereScissorsTool.toolName,
  [ToolName.PaintFill]: SafePaintFillTool.toolName,
  [ToolName.RegionSegment]: RegionSegmentTool.toolName,
  [ToolName.RegionSegmentPlus]: RegionSegmentPlusTool.toolName,
  [ToolName.SegmentSelect]: SegmentSelectTool.toolName,
  // SegmentBidirectional is intentionally NOT activatable on the unified path: its
  // renderAnnotation crashes for our multi-layer-group SEGs (the group id has no
  // colour LUT, so Cornerstone's getSegmentIndexColor returns null and the tool reads
  // `.slice` of it). That throw aborts the whole annotation render pass, which also
  // drops the brush cursor. It stays in FULL_SET (registered) but can't be selected
  // until it's made group-aware. (Toolbox shows it disabled — see toolCatalog.)
  [ToolName.CircleROIThreshold]: CircleROIStartEndThresholdTool.toolName,
  [ToolName.LabelmapEditWithContour]: LabelMapEditWithContourTool.toolName,
  // Measurement (annotation) tools
  [ToolName.Angle]: AngleTool.toolName,
  [ToolName.Bidirectional]: BidirectionalTool.toolName,
  [ToolName.EllipticalROI]: EllipticalROITool.toolName,
  [ToolName.RectangleROI]: RectangleROITool.toolName,
  [ToolName.CircleROI]: CircleROITool.toolName,
  [ToolName.Probe]: ProbeTool.toolName,
  [ToolName.ArrowAnnotate]: ArrowAnnotateTool.toolName,
  [ToolName.PlanarFreehandROI]: PlanarFreehandROITool.toolName,
  [ToolName.RectangleROIThreshold]: RectangleROIThresholdTool.toolName,
};

/** Brush-family strategy per ToolName (all share BrushTool). */
const BRUSH_STRATEGY: Partial<Record<ToolName, string>> = {
  [ToolName.Brush]: 'FILL_INSIDE_CIRCLE',
  [ToolName.Eraser]: 'ERASE_INSIDE_CIRCLE',
  [ToolName.ThresholdBrush]: 'THRESHOLD_INSIDE_CIRCLE',
};

/**
 * Contour-segmentation tools that support inter-slice interpolation (signal 13). When
 * `interpolation.enabled` is set on these, drawing contours on non-adjacent slices of
 * the same segment makes Cornerstone auto-generate the in-between contours. The legacy
 * tool group configured this; the unified group must too, or interpolation is silently
 * off on the active path.
 */
const CONTOUR_INTERPOLATION_TOOL_NAMES = [
  PlanarFreehandContourSegmentationTool.toolName,
  SplineContourSegmentationTool.toolName,
  LivewireContourSegmentationTool.toolName,
  LabelMapEditWithContourTool.toolName,
] as const;

/** Apply the interpolation flag to every contour-interpolation tool in the group. */
function applyInterpolation(toolGroup: ToolTypes.IToolGroup, enabled: boolean): void {
  for (const toolName of CONTOUR_INTERPOLATION_TOOL_NAMES) {
    try {
      toolGroup.setToolConfiguration(toolName, { interpolation: { enabled } });
    } catch (err) {
      console.debug(`[unifiedToolService] interpolation config for ${toolName} failed:`, err);
    }
  }
}

/**
 * Fixed, non-Primary mouse binding for the nav tools — always preserved so
 * middle/right/wheel navigation survives Primary-tool swaps. Tools NOT listed
 * (W/L, Length, Freehand, Brush) live only on the Primary slot, so they demote
 * cleanly to passive. The previous PRIMARY_CAPABLE approach left Pan/Zoom's
 * Primary binding stuck (it never demoted them), so a later Zoom collided with a
 * still-Primary Pan and never took the left button.
 */
const NAV_BASE_BINDING: Record<string, number> = {
  [PanTool.toolName]: Auxiliary,
  [ZoomTool.toolName]: Secondary,
  [StackScrollTool.toolName]: Wheel,
};

/**
 * Handle-based annotation tools (measurement + contour-segmentation) whose existing
 * annotations can be GRABBED and dragged whenever the tool is merely Passive. We keep
 * them ENABLED (rendered, view-only) when they're not the active tool, so an existing
 * structure contour / measurement can only be edited when its own tool is active — a
 * measurement tool active no longer lets you drag a structure contour. Brush/scissors/
 * labelmap tools aren't handle-based (no draggable handles), so they demote to Passive
 * as before; nav tools keep their fixed bindings.
 */
const HANDLE_EDITABLE_TOOL_NAMES: ReadonlySet<string> = new Set([
  LengthTool.toolName, AngleTool.toolName, BidirectionalTool.toolName,
  EllipticalROITool.toolName, RectangleROITool.toolName, CircleROITool.toolName,
  ProbeTool.toolName, ArrowAnnotateTool.toolName, PlanarFreehandROITool.toolName,
  PlanarFreehandContourSegmentationTool.toolName, SplineContourSegmentationTool.toolName,
  LivewireContourSegmentationTool.toolName, SculptorTool.toolName,
]);

/** Idle (not-the-active-tool) mode: handle-based annotation tools go view-only
 *  (Enabled) so their annotations can't be grabbed; everything else stays Passive. */
function setIdleToolMode(toolGroup: ToolTypes.IToolGroup, toolName: string): void {
  try {
    if (HANDLE_EDITABLE_TOOL_NAMES.has(toolName)) toolGroup.setToolEnabled(toolName);
    else toolGroup.setToolPassive(toolName);
  } catch {
    /* not all tools support every mode; safe to ignore */
  }
}

// The tool currently bound to Primary; tracked so we demote it (rather than
// re-`setToolActive` everything, which MERGES bindings in CS3D v4) on a switch.
// Default = Window/Level (the native CrosshairsTool is disabled — see header).
let currentPrimary: string = WindowLevelTool.toolName;
// The active ToolName (UI-level), null until an explicit selection.
let activeToolName: ToolName | null = null;

function getToolGroup(): ToolTypes.IToolGroup | undefined {
  return ToolGroupManager.getToolGroup(UNIFIED_TOOL_GROUP_ID);
}

/**
 * Create + configure the unified tool group if it does not already exist.
 * Idempotent: the group is long-lived; viewports come and go via add/remove.
 */
function ensureToolGroup(): ToolTypes.IToolGroup | undefined {
  const existing = getToolGroup();
  if (existing) return existing;

  const toolGroup = ToolGroupManager.createToolGroup(UNIFIED_TOOL_GROUP_ID);
  if (!toolGroup) {
    console.error('[unifiedToolService] Failed to create tool group');
    return undefined;
  }

  // Navigation + crosshairs.
  toolGroup.addTool(CrosshairsTool.toolName);
  toolGroup.addTool(WindowLevelTool.toolName);
  toolGroup.addTool(PanTool.toolName);
  toolGroup.addTool(ZoomTool.toolName);
  toolGroup.addTool(StackScrollTool.toolName);
  // Editing tools (P1.7): measurement, freehand contour segmentation, brush.
  toolGroup.addTool(LengthTool.toolName);
  toolGroup.addTool(PlanarFreehandContourSegmentationTool.toolName);
  toolGroup.addTool(BrushTool.toolName);
  // R3.8b — full toolbox set (each globally addTool'd in init.ts). Added passive;
  // setActiveTool promotes one to Primary on demand.
  const FULL_SET = [
    AngleTool, BidirectionalTool, EllipticalROITool, RectangleROITool, CircleROITool,
    ProbeTool, ArrowAnnotateTool, PlanarFreehandROITool, SplineContourSegmentationTool,
    LivewireContourSegmentationTool, CircleScissorsTool, RectangleScissorsTool,
    SphereScissorsTool, SafePaintFillTool, SculptorTool, SegmentSelectTool,
    RegionSegmentTool, RegionSegmentPlusTool, SegmentBidirectionalTool,
    RectangleROIThresholdTool, CircleROIStartEndThresholdTool, LabelMapEditWithContourTool,
  ];
  for (const Tool of FULL_SET) {
    try {
      toolGroup.addTool(Tool.toolName);
    } catch (err) {
      console.warn(`[unifiedToolService] addTool ${Tool.toolName} failed:`, err);
    }
  }

  // Default Primary (left-click) = Window/Level. The native CrosshairsTool is
  // DISABLED: it needs ≥2 non-parallel planes, so it crashes on mouse-move in a
  // single viewport (see header). It stays registered (for hasCrosshairs / future
  // routing) but inert; the world-point crosshair replaces it.
  toolGroup.setToolActive(WindowLevelTool.toolName, { bindings: [{ mouseButton: Primary }] });
  toolGroup.setToolDisabled(CrosshairsTool.toolName);
  // Pan: middle-click · Zoom: right-click · StackScroll: wheel (slice nav).
  // These fixed bindings are set ONCE here and never re-set (CS3D v4
  // setToolActive merges bindings), so setActiveTool only swaps the Primary slot.
  toolGroup.setToolActive(PanTool.toolName, { bindings: [{ mouseButton: Auxiliary }] });
  toolGroup.setToolActive(ZoomTool.toolName, { bindings: [{ mouseButton: Secondary }] });
  toolGroup.setToolActive(StackScrollTool.toolName, { bindings: [{ mouseButton: Wheel }] });
  // Editing tools start idle (visible, not the active primary). Handle-based
  // annotation tools idle as ENABLED (view-only) so existing structure contours /
  // measurements aren't grabbable until their own tool is active; the rest go Passive.
  setIdleToolMode(toolGroup, LengthTool.toolName);
  setIdleToolMode(toolGroup, PlanarFreehandContourSegmentationTool.toolName);
  for (const Tool of FULL_SET) {
    setIdleToolMode(toolGroup, Tool.toolName);
  }

  // Inter-slice contour interpolation (signal 13): enable per the user's preference so
  // drawing contours on non-adjacent slices auto-generates the in-between contours.
  applyInterpolation(toolGroup, usePreferencesStore.getState().preferences.interpolation.enabled);

  currentPrimary = WindowLevelTool.toolName;
  console.log('[unifiedToolService] Unified tool group initialized');
  return toolGroup;
}

export const unifiedToolService = {
  UNIFIED_TOOL_GROUP_ID,

  /** Tool group id for the unified path. */
  getToolGroupId(): string {
    return UNIFIED_TOOL_GROUP_ID;
  },

  /** Ensure the group exists (configured). Safe to call repeatedly. */
  initialize(): void {
    ensureToolGroup();
  },

  /**
   * Set the active (Primary / left-click) tool. Swaps only the Primary slot: the
   * prior primary is demoted (its Primary binding removed; if it's a nav tool its
   * fixed middle/right/wheel binding is restored), then the new tool takes
   * Primary. Exactly one tool ever holds the Primary binding.
   */
  setActiveTool(toolName: ToolName): void {
    const toolGroup = ensureToolGroup();
    if (!toolGroup) return;
    const csName = UNIFIED_TOOL_MAP[toolName];
    if (!csName) {
      console.warn('[unifiedToolService] Unsupported tool for unified path:', toolName);
      return;
    }
    // Contour Fill (signal 30): the LabelmapEditWithContour tool draws a contour
    // segmentation that it rasterizes into the active labelmap — but it THROWS on
    // draw-start unless the active labelmap already carries a Contour representation.
    // Add it at activation time (the tool's own reactive setup doesn't fire when the
    // viewport + seg already exist). Runs before the early-return so re-selecting the
    // tool after switching the active segment re-establishes the prerequisite.
    if (toolName === ToolName.LabelmapEditWithContour) {
      ensureContourEditPrereq(toolGroup.getViewportIds());
    }
    // Brush family (Brush / Eraser / ThresholdBrush) all share BrushTool — only the
    // active STRATEGY differs (fill / erase / threshold). The strategy must be set on
    // EVERY selection, including switches WITHIN the family: Brush→Eraser keep the same
    // BrushTool primary binding, so they hit the `csName === currentPrimary` early
    // return below — selecting it after the binding swap would never run. Set it here,
    // before the early return, so the eraser actually erases.
    if (csName === BrushTool.toolName) {
      try {
        toolGroup.setActiveStrategy(BrushTool.toolName, BRUSH_STRATEGY[toolName] ?? 'FILL_INSIDE_CIRCLE');
      } catch {
        /* default strategy */
      }
    }
    if (csName === currentPrimary) {
      activeToolName = toolName;
      return;
    }

    // Demote the current primary: clear ALL its bindings (removing the stale
    // Primary binding), then restore its fixed nav binding if it has one
    // (Pan=middle, Zoom=right, StackScroll=wheel). Doing this for every tool —
    // not just a PRIMARY_CAPABLE subset — is what stops Pan/Zoom from getting
    // stuck on the left button and blocking subsequent tool switches. Handle-based
    // annotation tools demote to ENABLED (view-only) so they're not editable while idle.
    setIdleToolMode(toolGroup, currentPrimary);
    const oldBase = NAV_BASE_BINDING[currentPrimary];
    if (oldBase !== undefined) {
      toolGroup.setToolActive(currentPrimary, { bindings: [{ mouseButton: oldBase }] });
    }

    // Promote the new tool to Primary (merges with its own fixed nav binding,
    // which was set in ensureToolGroup and left intact above).
    toolGroup.setToolActive(csName, { bindings: [{ mouseButton: Primary }] });
    currentPrimary = csName;
    activeToolName = toolName;
    console.log('[unifiedToolService] Active tool:', toolName, '->', csName);
  },

  /** The active (Primary) ToolName, or null before any explicit selection. */
  getActiveToolName(): ToolName | null {
    return activeToolName;
  },

  /** Whether a tool is registered on the unified path (setActiveTool will activate it). */
  isToolSupported(toolName: ToolName): boolean {
    return UNIFIED_TOOL_MAP[toolName] !== undefined;
  },

  /** Cornerstone mode of a tool in the unified group ('Active'/'Passive'/…), or null. */
  getToolMode(csToolName: string): string | null {
    const opts = getToolGroup()?.getToolOptions(csToolName) as { mode?: string } | undefined;
    return opts?.mode ?? null;
  },

  /**
   * Cornerstone tool names that currently hold the Primary (left-click) binding.
   * Invariant: exactly one. More than one means a binding leaked (the Pan/Zoom
   * bug) — used by the tool-switching regression test.
   */
  getToolsWithPrimaryBinding(): string[] {
    const toolGroup = getToolGroup();
    if (!toolGroup) return [];
    const names = [
      WindowLevelTool.toolName,
      PanTool.toolName,
      ZoomTool.toolName,
      StackScrollTool.toolName,
      LengthTool.toolName,
      PlanarFreehandContourSegmentationTool.toolName,
      BrushTool.toolName,
      CrosshairsTool.toolName,
    ];
    return names.filter((name) => {
      const opts = toolGroup.getToolOptions(name) as
        | { bindings?: Array<{ mouseButton?: number }> }
        | undefined;
      return (opts?.bindings ?? []).some((b) => b.mouseButton === Primary);
    });
  },

  /**
   * Set the brush radius — the SINGLE entry point for brush size (Phase-6 cutover).
   * Clamps to [1,100], writes Cornerstone's unified tool group (the only group the
   * brush runs on) AND `segmentationStore.brushSize`, which is the one piece of
   * state the UI (panel slider) and the `[` / `]` hotkeys both read. Callers must
   * not write the store separately.
   */
  setBrushSize(size: number): void {
    const clamped = Math.max(1, Math.min(100, Math.round(size)));
    try {
      csToolUtilities.segmentation.setBrushSizeForToolGroup(UNIFIED_TOOL_GROUP_ID, clamped);
    } catch (err) {
      console.warn('[unifiedToolService] setBrushSize failed:', err);
    }
    useSegmentationStore.getState().setBrushSize(clamped);
  },

  /**
   * Set the intensity range for the threshold-brush family (writes only voxels whose
   * source intensity falls within `[min, max]`). Cornerstone applies this only to
   * tools whose ACTIVE strategy is a threshold strategy, so select the ThresholdBrush
   * (which sets THRESHOLD_INSIDE_CIRCLE) before calling.
   */
  setBrushThreshold(range: [number, number]): void {
    try {
      csToolUtilities.segmentation.setBrushThresholdForToolGroup(UNIFIED_TOOL_GROUP_ID, { range } as never);
    } catch (err) {
      console.warn('[unifiedToolService] setBrushThreshold failed:', err);
    }
  },

  /** Enable/disable inter-slice contour interpolation live (signal 13). Idempotent. */
  setInterpolationEnabled(enabled: boolean): void {
    const toolGroup = getToolGroup();
    if (toolGroup) applyInterpolation(toolGroup, enabled);
  },

  /**
   * Add a unified viewport to the tool group (creating the group on first use).
   * Call after viewportService.createUnifiedViewport().
   */
  addViewport(viewportId: string): void {
    const toolGroup = ensureToolGroup();
    if (!toolGroup) return;
    const wasEmpty = toolGroup.getViewportIds().length === 0;
    toolGroup.addViewport(viewportId, viewportService.ENGINE_ID);
    if (wasEmpty) {
      // Seed the configured default brush radius once the group has a viewport
      // (setBrushSizeForToolGroup is a no-op before one exists). Only on the FIRST
      // viewport so later additions (e.g. an MPR layout) keep the user's current size.
      try {
        csToolUtilities.segmentation.setBrushSizeForToolGroup(
          UNIFIED_TOOL_GROUP_ID,
          usePreferencesStore.getState().preferences.annotation.defaultBrushSize,
        );
      } catch {
        /* ignore */
      }
    }
    console.log('[unifiedToolService] Viewport added:', viewportId);
  },

  /** Current brush radius on the unified tool group (Cornerstone), or null. */
  getBrushSize(): number | null {
    try {
      return (csToolUtilities.segmentation as unknown as {
        getBrushSizeForToolGroup?: (id: string) => number;
      }).getBrushSizeForToolGroup?.(UNIFIED_TOOL_GROUP_ID) ?? null;
    } catch {
      return null;
    }
  },

  /**
   * Remove a unified viewport from the tool group.
   * Call before viewportService.destroyUnifiedViewport().
   */
  removeViewport(viewportId: string): void {
    const toolGroup = getToolGroup();
    if (!toolGroup) return;
    try {
      toolGroup.removeViewports(viewportService.ENGINE_ID, viewportId);
    } catch {
      /* ok — may already be removed */
    }
    console.log('[unifiedToolService] Viewport removed:', viewportId);
  },

  /** Viewport ids currently in the unified group. */
  getViewportIds(): string[] {
    return getToolGroup()?.getViewportIds() ?? [];
  },

  /** Whether CrosshairsTool is registered in the unified group. */
  hasCrosshairs(): boolean {
    return getToolGroup()?.hasTool(CrosshairsTool.toolName) ?? false;
  },

  /** The tool group id a given viewport belongs to (null if none). */
  getViewportToolGroupId(viewportId: string): string | null {
    return ToolGroupManager.getToolGroupForViewport(viewportId, viewportService.ENGINE_ID)?.id ?? null;
  },

  /** Destroy the unified tool group. */
  destroy(): void {
    try {
      ToolGroupManager.destroyToolGroup(UNIFIED_TOOL_GROUP_ID);
    } catch {
      /* ok */
    }
    console.log('[unifiedToolService] Tool group destroyed');
  },
};
