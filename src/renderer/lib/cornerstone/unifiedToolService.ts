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
 * NOTE (Phase 2): CrosshairsTool is bound to Primary here, which is correct for
 * volume viewports. Per-modality tool routing for stack viewports (where the
 * real CrosshairsTool has known rendering quirks) is Phase-2 drawing/tool-policy
 * work; Phase-1 acceptance is volume MPR.
 */
import {
  ToolGroupManager,
  CrosshairsTool,
  WindowLevelTool,
  PanTool,
  ZoomTool,
  StackScrollTool,
  Enums as ToolEnums,
} from '@cornerstonejs/tools';
import type { Types as ToolTypes } from '@cornerstonejs/tools';
import { viewportService } from './viewportService';

const UNIFIED_TOOL_GROUP_ID = 'xnatToolGroup_unified';

const { Primary, Auxiliary, Secondary, Wheel } = ToolEnums.MouseBindings;

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

  toolGroup.addTool(CrosshairsTool.toolName);
  toolGroup.addTool(WindowLevelTool.toolName);
  toolGroup.addTool(PanTool.toolName);
  toolGroup.addTool(ZoomTool.toolName);
  toolGroup.addTool(StackScrollTool.toolName);

  // CrosshairsTool: primary left-click — the real-tool MPR sync (reference
  // lines + slice jump across the shared-volume panels).
  toolGroup.setToolActive(CrosshairsTool.toolName, { bindings: [{ mouseButton: Primary }] });
  // Pan: middle-click · Zoom: right-click · StackScroll: wheel (slice nav).
  toolGroup.setToolActive(PanTool.toolName, { bindings: [{ mouseButton: Auxiliary }] });
  toolGroup.setToolActive(ZoomTool.toolName, { bindings: [{ mouseButton: Secondary }] });
  toolGroup.setToolActive(StackScrollTool.toolName, { bindings: [{ mouseButton: Wheel }] });
  // W/L: enabled but no binding (manual activation later).
  toolGroup.setToolEnabled(WindowLevelTool.toolName);

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
