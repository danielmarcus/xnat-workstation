/**
 * Scissors strategy on the UNIFIED tool path — the one the app actually runs.
 *
 * `toolService.test.ts` already covers scissors fill/erase, the Shift-invert and the
 * cursor sync — but it covers the LEGACY `toolService`, whose `initialize()` is never
 * called outside tests (`ViewerPage` only ever calls `unifiedToolService.initialize()`
 * and the legacy `destroy()`). Every one of those assertions therefore passed against a
 * tool group the application never creates, while on the live path the three scissors
 * tools were permanently stuck on Cornerstone's default FILL_INSIDE and the Settings
 * modal's scissor preference did nothing.
 *
 * These tests pin the behaviour on the unified service instead. Cornerstone 4.16.1
 * registers exactly two strategies per scissors tool — FILL_INSIDE and ERASE_INSIDE;
 * the "outside" variants either throw ('Not yet implemented') or, for the rectangle,
 * ignore their own `inside` flag — so erase-inside is the whole of what is on offer.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolName } from '@shared/types/viewer';
import { usePreferencesStore } from '../../../stores/preferencesStore';
import { useSegmentationStore } from '../../../stores/segmentationStore';
import {
  createCornerstoneMockState,
  createCoreModuleMock,
  createToolsModuleMock,
} from '../../../test/cornerstone/cornerstoneMocks';
import { resetCornerstoneMocks } from '../../../test/cornerstone/resetCornerstoneMocks';

const cs = createCornerstoneMockState();

let unifiedToolService: (typeof import('../unifiedToolService'))['unifiedToolService'];
const originalWindow = (globalThis as any).window;

function dispatchWindowKey(type: 'keydown' | 'keyup', key: string): void {
  const evt = new Event(type);
  Object.defineProperty(evt, 'key', { value: key });
  (globalThis as any).window.dispatchEvent(evt);
}

/** Most recent strategy pushed for a tool, or undefined if none was. */
function lastStrategyFor(match: RegExp): string | undefined {
  const all = strategiesFor(match);
  return all.length > 0 ? all[all.length - 1] : undefined;
}

/** Strategy names passed to setActiveStrategy for a given Cornerstone tool. */
function strategiesFor(match: RegExp): string[] {
  const group = cs.getLastToolGroup();
  return (group?.setActiveStrategy.mock.calls ?? [])
    .filter((c: unknown[]) => match.test(String(c[0])))
    .map((c: unknown[]) => String(c[1]));
}

beforeAll(async () => {
  vi.doMock('@cornerstonejs/core', () => createCoreModuleMock(cs));
  vi.doMock('@cornerstonejs/tools', () => createToolsModuleMock(cs));
  // Without this the real SafePaintFillTool module is evaluated against the mock and
  // throws at import time — which vitest reports as SKIPPED tests, not failing ones.
  vi.doMock('../tools/SafePaintFillTool', () => ({ default: { toolName: 'SafePaintFill' } }));
  ({ unifiedToolService } = await import('../unifiedToolService'));
});

beforeEach(() => {
  const eventTarget = new EventTarget();
  (globalThis as any).window = {
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
    dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
  };
  // applyToolCursor defers via a double rAF; the stub window above shadows jsdom's.
  (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  };
  resetCornerstoneMocks(cs);
  usePreferencesStore.setState(usePreferencesStore.getInitialState(), true);
  useSegmentationStore.setState(useSegmentationStore.getInitialState(), true);
  unifiedToolService.destroy();
  unifiedToolService.initialize();
});

afterEach(() => {
  unifiedToolService.destroy();
  if (typeof originalWindow === 'undefined') delete (globalThis as any).window;
  else (globalThis as any).window = originalWindow;
});

describe('unified scissors strategy', () => {
  it.each([
    [ToolName.CircleScissors, /CircleScissor/],
    [ToolName.RectangleScissors, /RectangleScissor/],
    [ToolName.SphereScissors, /SphereScissor/],
  ])('%s applies the erase strategy when the scissor mode is erase', (tool, match) => {
    usePreferencesStore.getState().setScissorDefaultStrategy('erase');

    unifiedToolService.setActiveTool(tool as ToolName);

    expect(strategiesFor(match as RegExp)).toContain('ERASE_INSIDE');
  });

  it.each([
    [ToolName.CircleScissors, /CircleScissor/],
    [ToolName.RectangleScissors, /RectangleScissor/],
    [ToolName.SphereScissors, /SphereScissor/],
  ])('%s applies the fill strategy when the scissor mode is fill', (tool, match) => {
    usePreferencesStore.getState().setScissorDefaultStrategy('fill');

    unifiedToolService.setActiveTool(tool as ToolName);

    expect(strategiesFor(match as RegExp)).toContain('FILL_INSIDE');
  });

  it('re-applies the strategy when the same scissors tool is selected again', () => {
    // Strategy is sticky on the Cornerstone tool instance and re-selecting the active
    // tool hits the `csName === currentPrimary` early return, so a mode change made
    // while the tool is already active must still reach setActiveStrategy — the exact
    // bug the brush family needed its pre-early-return block for.
    usePreferencesStore.getState().setScissorDefaultStrategy('fill');
    unifiedToolService.setActiveTool(ToolName.CircleScissors);

    usePreferencesStore.getState().setScissorDefaultStrategy('erase');
    unifiedToolService.setActiveTool(ToolName.CircleScissors);

    expect(lastStrategyFor(/CircleScissor/)).toBe('ERASE_INSIDE');
  });

  it('inverts the strategy while Shift is held and restores it on release', () => {
    usePreferencesStore.getState().setScissorDefaultStrategy('fill');
    unifiedToolService.setActiveTool(ToolName.CircleScissors);

    dispatchWindowKey('keydown', 'Shift');
    expect(lastStrategyFor(/CircleScissor/)).toBe('ERASE_INSIDE');

    dispatchWindowKey('keyup', 'Shift');
    expect(lastStrategyFor(/CircleScissor/)).toBe('FILL_INSIDE');
  });

  it('keeps the cursor in step with the active scissor strategy', () => {
    usePreferencesStore.getState().setScissorDefaultStrategy('erase');
    unifiedToolService.setActiveTool(ToolName.CircleScissors);

    // The cursor argument names a Cornerstone SVG asset, not a strategy, and the two
    // do not line up: Cornerstone ships CircleScissor.ERASE_OUTSIDE but no
    // ERASE_INSIDE cursor, so erasing correctly asks for the ERASE_OUTSIDE glyph.
    expect(cs.getLastToolGroup()?.setViewportsCursorByToolName).toHaveBeenCalledWith(
      'CircleScissor',
      'ERASE_OUTSIDE',
    );
  });

  it('does not touch the scissor strategy when a brush tool is selected', () => {
    unifiedToolService.setActiveTool(ToolName.Brush);

    expect(strategiesFor(/Scissor/)).toEqual([]);
  });
});
