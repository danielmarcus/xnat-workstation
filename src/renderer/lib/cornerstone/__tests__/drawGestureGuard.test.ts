import { describe, expect, it } from 'vitest';
import { DRAWING_TOOL_NAMES, evaluateDrawBlock } from '../drawGestureGuard';
import { ToolName } from '@shared/types/viewer';

/**
 * Phase 2 unblock (R3.8b) — gesture-start block decision (B3 / D10 / signal 12).
 * Pure: given the active drawing tool + active container + the FoR decision, decide
 * whether to block the draw at mouse-down. The hook applies the side effect
 * (stopImmediatePropagation); this is the logic, verified in isolation.
 */
const allow = () => ({ allowed: true });
const deny = (reason: string) => () => ({ allowed: false, reason });

describe('evaluateDrawBlock', () => {
  it('does not block when the active tool is not a drawing tool', () => {
    expect(evaluateDrawBlock({ activeTool: ToolName.Pan, activeContainerId: 'c1', decide: deny('no'), viewportId: 'p0' })).toEqual({ block: false });
  });

  it('does NOT block when there is no active container (legacy/Phase-1 brush flow must still draw)', () => {
    // canDrawOnViewport would say "no active container" — but the interceptor must
    // never block the legacy flow, so a null active container fails OPEN here.
    expect(evaluateDrawBlock({ activeTool: ToolName.Brush, activeContainerId: null, decide: deny('no active container'), viewportId: 'p0' })).toEqual({ block: false });
  });

  it('does not block a drawing tool on a native viewport (decision allows)', () => {
    expect(evaluateDrawBlock({ activeTool: ToolName.Brush, activeContainerId: 'c1', decide: allow, viewportId: 'p0' })).toEqual({ block: false });
  });

  it('blocks a drawing tool when the active container is non-native here, surfacing the reason', () => {
    const r = evaluateDrawBlock({ activeTool: ToolName.FreehandContour, activeContainerId: 'c1', decide: deny('sibling series — read-only here'), viewportId: 'p1' });
    expect(r.block).toBe(true);
    expect(r.reason).toMatch(/sibling series/);
  });

  it('treats Brush and FreehandContour as drawing tools', () => {
    expect(DRAWING_TOOL_NAMES.has(ToolName.Brush)).toBe(true);
    expect(DRAWING_TOOL_NAMES.has(ToolName.FreehandContour)).toBe(true);
    expect(DRAWING_TOOL_NAMES.has(ToolName.Pan)).toBe(false);
  });
});
