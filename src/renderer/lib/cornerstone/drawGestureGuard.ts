/**
 * Draw-gesture guard (Phase 2 unblock, R3.8b — B3 / D10 / signal 12).
 *
 * Pure decision for whether a drawing gesture should be BLOCKED at mouse-down: a
 * draw always targets the ACTIVE container and is only valid on a viewport native
 * to it; drawing into a non-native (cross-series / different-FoR) viewport is
 * blocked with a hint, so no partial geometry is created. The useViewport
 * capture-phase listener applies the side effect (stopImmediatePropagation); this
 * module owns only the logic.
 *
 * Critical: with NO active container the guard fails OPEN (never blocks) — the
 * legacy/Phase-1 brush flow draws without the list-panel active-container model,
 * and must keep working. (canDrawOnViewport reports "no active container" as
 * not-allowed, which is right for the panel but wrong as a draw-block trigger.)
 */
import { ToolName, SEGMENTATION_TOOLS } from '@shared/types/viewer';

/** Tools that write into a container — a gesture with one of these can be blocked. */
export const DRAWING_TOOL_NAMES: ReadonlySet<ToolName> = SEGMENTATION_TOOLS;

export interface DrawBlockResult {
  block: boolean;
  reason?: string;
}

export function evaluateDrawBlock(params: {
  activeTool: ToolName | null;
  activeContainerId: string | null;
  /** The FoR decision (unifiedSegService.canDrawOnViewport). */
  decide: (activeContainerId: string, viewportId: string) => { allowed: boolean; reason?: string };
  viewportId: string;
}): DrawBlockResult {
  const { activeTool, activeContainerId, decide, viewportId } = params;
  if (!activeTool || !DRAWING_TOOL_NAMES.has(activeTool)) return { block: false };
  if (!activeContainerId) return { block: false }; // fail open — legacy flow must draw
  const d = decide(activeContainerId, viewportId);
  return d.allowed ? { block: false } : { block: true, reason: d.reason };
}
