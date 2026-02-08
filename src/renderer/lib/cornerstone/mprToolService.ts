/**
 * MPR Tool Service — manages a separate Cornerstone3D tool group for
 * MPR (volume) viewports.
 *
 * Uses CrosshairsTool as the primary left-click tool (the defining MPR
 * interaction for synchronized navigation). W/L, Pan, and Zoom are
 * available on fixed mouse button bindings.
 *
 * This is intentionally separate from the main toolService to avoid
 * conflicts between stack and volume viewport tool requirements
 * (e.g. StackScrollTool doesn't apply to volume viewports).
 */
import {
  ToolGroupManager,
  CrosshairsTool,
  WindowLevelTool,
  PanTool,
  ZoomTool,
  Enums as ToolEnums,
} from '@cornerstonejs/tools';
import type { Types as ToolTypes } from '@cornerstonejs/tools';
import { viewportService } from './viewportService';

const MPR_TOOL_GROUP_ID = 'xnatToolGroup_mpr';

const { Primary, Auxiliary, Secondary } = ToolEnums.MouseBindings;

function getToolGroup(): ToolTypes.IToolGroup | undefined {
  return ToolGroupManager.getToolGroup(MPR_TOOL_GROUP_ID);
}

export const mprToolService = {
  MPR_TOOL_GROUP_ID,

  /**
   * Create the MPR tool group with CrosshairsTool as primary.
   * Call once when entering MPR mode, before adding viewports.
   */
  initialize(): void {
    // Destroy existing tool group if any (shouldn't happen, but be safe)
    try { ToolGroupManager.destroyToolGroup(MPR_TOOL_GROUP_ID); } catch { /* ok */ }

    const toolGroup = ToolGroupManager.createToolGroup(MPR_TOOL_GROUP_ID);
    if (!toolGroup) {
      console.error('[mprToolService] Failed to create tool group');
      return;
    }

    // Add tools to the group
    toolGroup.addTool(CrosshairsTool.toolName);
    toolGroup.addTool(WindowLevelTool.toolName);
    toolGroup.addTool(PanTool.toolName);
    toolGroup.addTool(ZoomTool.toolName);

    // CrosshairsTool: primary left-click (defines MPR interaction)
    toolGroup.setToolActive(CrosshairsTool.toolName, {
      bindings: [{ mouseButton: Primary }],
    });

    // Pan: middle-click
    toolGroup.setToolActive(PanTool.toolName, {
      bindings: [{ mouseButton: Auxiliary }],
    });

    // Zoom: right-click
    toolGroup.setToolActive(ZoomTool.toolName, {
      bindings: [{ mouseButton: Secondary }],
    });

    // W/L: enabled but no binding (available for manual activation)
    toolGroup.setToolEnabled(WindowLevelTool.toolName);

    console.log('[mprToolService] MPR tool group initialized');
  },

  /**
   * Add an MPR viewport to the tool group.
   * Call after mprService.createViewport().
   */
  addViewport(viewportId: string): void {
    const toolGroup = getToolGroup();
    if (!toolGroup) {
      console.warn('[mprToolService] No tool group — call initialize() first');
      return;
    }
    toolGroup.addViewport(viewportId, viewportService.ENGINE_ID);
    console.log('[mprToolService] Viewport added:', viewportId);
  },

  /**
   * Remove an MPR viewport from the tool group.
   * Call before mprService.destroyViewport().
   */
  removeViewport(viewportId: string): void {
    const toolGroup = getToolGroup();
    if (!toolGroup) return;
    try {
      toolGroup.removeViewports(viewportService.ENGINE_ID, viewportId);
    } catch { /* ok — may already be removed */ }
    console.log('[mprToolService] Viewport removed:', viewportId);
  },

  /**
   * Destroy the MPR tool group. Call when exiting MPR mode.
   */
  destroy(): void {
    try { ToolGroupManager.destroyToolGroup(MPR_TOOL_GROUP_ID); } catch { /* ok */ }
    console.log('[mprToolService] Tool group destroyed');
  },
};
