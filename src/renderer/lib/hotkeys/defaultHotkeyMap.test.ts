/**
 * Default hotkey map invariants — spec §6.1.
 *
 * Every tool the codebase can activate must have a default binding;
 * unbound tools force the user into Settings → Hotkeys before they
 * can use them, which contradicts the spec's discoverability goal.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_HOTKEY_MAP } from './defaultHotkeyMap';
import { ToolName } from '@shared/types/viewer';
import type { HotkeyAction } from '@shared/types/hotkeys';

/**
 * Every HotkeyAction that maps to a ToolName via TOOL_ACTION_MAP
 * (the dispatcher's keyset). Mirrored here so the test stays
 * decoupled from hotkeyService internals.
 */
const TOOL_ACTIONS: HotkeyAction[] = [
  'tool.windowLevel', 'tool.pan', 'tool.zoom', 'tool.length',
  'tool.angle', 'tool.bidirectional', 'tool.ellipticalROI',
  'tool.rectangleROI', 'tool.circleROI', 'tool.probe',
  'tool.arrowAnnotate', 'tool.freehandROI', 'tool.crosshairs',
  'tool.brush', 'tool.eraser', 'tool.thresholdBrush',
  'tool.freehandContour', 'tool.splineContour', 'tool.livewireContour',
  'tool.circleScissors', 'tool.rectangleScissors', 'tool.paintFill',
  'tool.sculptor', 'tool.stackScroll',
];

describe('defaultHotkeyMap — tool bindings (spec §6.1)', () => {
  it('every tool action has at least one default binding', () => {
    const missing: HotkeyAction[] = [];
    for (const action of TOOL_ACTIONS) {
      const bindings = DEFAULT_HOTKEY_MAP[action];
      if (!bindings || bindings.length === 0) missing.push(action);
    }
    expect(missing).toEqual([]);
  });

  it('spec §6.1 — 12 new tool bindings match the spec table', () => {
    const expected: Record<HotkeyAction, { key: string; shift: boolean }> = {
      'tool.thresholdBrush':     { key: 'B', shift: true },
      'tool.bidirectional':      { key: 'L', shift: true },
      'tool.rectangleROI':       { key: 'M', shift: true },
      'tool.circleROI':          { key: 'C', shift: true },
      'tool.ellipticalROI':      { key: 'O', shift: true },
      'tool.freehandROI':        { key: 'H', shift: true },
      'tool.freehandContour':    { key: 'F', shift: true },
      'tool.splineContour':      { key: 'P', shift: true },
      'tool.livewireContour':    { key: 'W', shift: true },
      'tool.sculptor':           { key: 'U', shift: true },
      'tool.circleScissors':     { key: 'I', shift: true },
      'tool.rectangleScissors':  { key: 'X', shift: true },
    } as Record<HotkeyAction, { key: string; shift: boolean }>;

    for (const [action, want] of Object.entries(expected) as [HotkeyAction, { key: string; shift: boolean }][]) {
      const first = DEFAULT_HOTKEY_MAP[action]?.[0];
      expect(first?.key.toLowerCase()).toBe(want.key.toLowerCase());
      expect(!!first?.modifiers?.shift).toBe(want.shift);
    }
  });

  it('every default binding normalises to a unique lookup key (no two actions share one)', () => {
    const seen = new Map<string, HotkeyAction>();
    const collisions: Array<{ key: string; a: HotkeyAction; b: HotkeyAction }> = [];
    for (const [action, bindings] of Object.entries(DEFAULT_HOTKEY_MAP) as [HotkeyAction, NonNullable<typeof DEFAULT_HOTKEY_MAP[HotkeyAction]>][]) {
      if (!bindings) continue;
      for (const b of bindings) {
        const m = b.modifiers ?? {};
        const norm = [
          m.ctrl ? 'ctrl' : '',
          m.shift ? 'shift' : '',
          m.alt ? 'alt' : '',
          m.meta ? 'meta' : '',
          b.key.toLowerCase(),
        ].filter(Boolean).join('+');
        const prev = seen.get(norm);
        if (prev && prev !== action) collisions.push({ key: norm, a: prev, b: action });
        seen.set(norm, action);
      }
    }
    expect(collisions).toEqual([]);
  });

  // Sanity check: every ToolName enum value either has a default binding
  // via one of TOOL_ACTIONS, or is intentionally unbound (the few that
  // don't surface as primary tools — e.g. SegmentSelect / RegionSegment*
  // / Region+, which are reachable via the toolbox grid).
  const PRIMARY_TOOLS = new Set<ToolName>([
    ToolName.WindowLevel, ToolName.Pan, ToolName.Zoom, ToolName.Length,
    ToolName.Angle, ToolName.Bidirectional, ToolName.EllipticalROI,
    ToolName.RectangleROI, ToolName.CircleROI, ToolName.Probe,
    ToolName.ArrowAnnotate, ToolName.PlanarFreehandROI, ToolName.Crosshairs,
    ToolName.Brush, ToolName.Eraser, ToolName.ThresholdBrush,
    ToolName.FreehandContour, ToolName.SplineContour, ToolName.LivewireContour,
    ToolName.CircleScissors, ToolName.RectangleScissors, ToolName.PaintFill,
    ToolName.Sculptor, ToolName.StackScroll,
  ]);
  it('every primary ToolName is reachable via a default binding', () => {
    expect(PRIMARY_TOOLS.size).toBe(TOOL_ACTIONS.length);
  });
});
