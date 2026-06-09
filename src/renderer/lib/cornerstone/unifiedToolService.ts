/**
 * Unified Tool Service (Phase 1) — the single Cornerstone3D tool group for the
 * new unified-viewport path, gated behind `multiviewport.enabled`.
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
  Enums as ToolEnums,
  utilities as csToolUtilities,
} from '@cornerstonejs/tools';
import type { Types as ToolTypes } from '@cornerstonejs/tools';
import { ToolName } from '@shared/types/viewer';
import { viewportService } from './viewportService';

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
};

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
  // Editing tools start passive (visible, not the active primary).
  toolGroup.setToolPassive(LengthTool.toolName);
  toolGroup.setToolPassive(PlanarFreehandContourSegmentationTool.toolName);

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
    if (csName === currentPrimary) {
      activeToolName = toolName;
      return;
    }

    // Demote the current primary: clear ALL its bindings (removing the stale
    // Primary binding), then restore its fixed nav binding if it has one
    // (Pan=middle, Zoom=right, StackScroll=wheel). Doing this for every tool —
    // not just a PRIMARY_CAPABLE subset — is what stops Pan/Zoom from getting
    // stuck on the left button and blocking subsequent tool switches.
    toolGroup.setToolPassive(currentPrimary);
    const oldBase = NAV_BASE_BINDING[currentPrimary];
    if (oldBase !== undefined) {
      toolGroup.setToolActive(currentPrimary, { bindings: [{ mouseButton: oldBase }] });
    }

    // Brush needs an active labelmap strategy when it takes Primary.
    if (csName === BrushTool.toolName) {
      try {
        toolGroup.setActiveStrategy(BrushTool.toolName, 'FILL_INSIDE_CIRCLE');
      } catch {
        /* default strategy */
      }
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

  /** Set the brush radius for the unified tool group. */
  setBrushSize(size: number): void {
    try {
      csToolUtilities.segmentation.setBrushSizeForToolGroup(UNIFIED_TOOL_GROUP_ID, size);
    } catch (err) {
      console.warn('[unifiedToolService] setBrushSize failed:', err);
    }
  },

  /**
   * Add a unified viewport to the tool group (creating the group on first use).
   * Call after viewportService.createUnifiedViewport().
   */
  addViewport(viewportId: string): void {
    const toolGroup = ensureToolGroup();
    if (!toolGroup) return;
    toolGroup.addViewport(viewportId, viewportService.ENGINE_ID);
    console.log('[unifiedToolService] Viewport added:', viewportId);
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
