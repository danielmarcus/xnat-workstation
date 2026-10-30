import { describe, expect, it } from 'vitest';
import { ToolName } from '@shared/types/viewer';
import { CATALOG_TO_TOOLNAME, SEG_FAMILIES, TOOLNAME_TO_CATALOG, familyOf, resolveMode, toolsForKind } from '../toolCatalog';
import { DEFAULT_HOTKEY_MAP } from '../../../lib/hotkeys/defaultHotkeyMap';

/** Rebuild Phase 3, R3.8b — toolbox → Cornerstone tool mapping. */
/** The single-letter hotkey bound to a ToolName, or null. Mirrors defaultHotkeyMap's
 *  `tool.<name>` convention so the catalog cannot advertise a key that does not exist. */
function hotkeyFor(toolName: string): string | null {
  const action = `tool.${toolName.charAt(0).toLowerCase()}${toolName.slice(1)}`;
  const bindings = (DEFAULT_HOTKEY_MAP as Record<string, Array<{ key: string }> | undefined>)[action];
  const key = bindings?.[0]?.key;
  return key && key.length === 1 ? key.toLowerCase() : null;
}

describe('tool catalog mapping', () => {
  it('maps the primary editing tools to their ToolNames', () => {
    expect(CATALOG_TO_TOOLNAME.brush).toBe(ToolName.Brush);
    expect(CATALOG_TO_TOOLNAME.freehand).toBe(ToolName.FreehandContour);
    expect(CATALOG_TO_TOOLNAME.length).toBe(ToolName.Length);
  });

  it('round-trips ToolName → catalog id for the highlight', () => {
    expect(TOOLNAME_TO_CATALOG[ToolName.Brush]).toBe('brush');
    expect(TOOLNAME_TO_CATALOG[ToolName.FreehandContour]).toBe('freehand');
    expect(TOOLNAME_TO_CATALOG[ToolName.Length]).toBe('length');
  });

  it('every catalog tool across all kinds has a ToolName mapping', () => {
    for (const kind of ['SEG', 'RTSTRUCT', 'SR'] as const) {
      for (const t of toolsForKind(kind)) {
        expect(CATALOG_TO_TOOLNAME[t.id], `missing mapping for ${kind} tool "${t.id}"`).toBeDefined();
      }
    }
  });
});

/**
 * The catalog's presentation contract. Each of these failed on the catalog as it stood
 * before 2026-09-21, which is why they are pinned rather than assumed:
 *  - "Circle" was both a scissors and an ROI; "Bidir." was both a segment measurement and
 *    a plain one; "Freehand" was both a structure tool and an ROI.
 *  - Sphere Brush and Sphere Threshold shared a glyph, as did Circle and Circle ROI,
 *    and the two Bidir. tools.
 *  - Six tooltips simply repeated the label.
 *  - Three tools advertised a hotkey; four others had one and never said so.
 */
describe('catalog presentation contract', () => {
  // One entry per TOOL: a tool offered in more than one toolbox (Select) is one entry.
  const ALL = [...new Map((['SEG', 'RTSTRUCT', 'SR'] as const).flatMap((k) => toolsForKind(k)).map((t) => [t.id, t])).values()];

  it('every label is unique across the whole catalog', () => {
    const seen = new Map<string, string[]>();
    for (const t of ALL) seen.set(t.label, [...(seen.get(t.label) ?? []), t.id]);
    expect([...seen.entries()].filter(([, ids]) => ids.length > 1)).toEqual([]);
  });

  it('every icon is unique across the whole catalog', () => {
    const seen = new Map<string, string[]>();
    for (const t of ALL) {
      const key = JSON.stringify(t.icon);
      seen.set(key, [...(seen.get(key) ?? []), t.id]);
    }
    expect([...seen.values()].filter((ids) => ids.length > 1)).toEqual([]);
  });

  it('no tooltip merely repeats its label', () => {
    expect(ALL.filter((t) => t.title.trim().toLowerCase() === t.label.trim().toLowerCase()).map((t) => t.id))
      .toEqual([]);
  });

  it('a tooltip advertises a hotkey if and only if the hotkey map defines one', () => {
    const mismatches: string[] = [];
    for (const t of ALL) {
      const toolName = CATALOG_TO_TOOLNAME[t.id];
      const advertised = /\(([A-Z])\)\s*$/.exec(t.title)?.[1]?.toLowerCase() ?? null;
      const bound = toolName ? hotkeyFor(toolName) : null;
      if (advertised !== bound) mismatches.push(`${t.id}: tooltip says ${advertised ?? 'none'}, map says ${bound ?? 'none'}`);
    }
    expect(mismatches).toEqual([]);
  });

  it('every control a tool declares is one the toolbox knows how to render', () => {
    const known = new Set(['brushSize', 'intensityWindow', 'samplingRadius', 'editMode', 'semiAuto', 'contourDraw']);
    for (const t of ALL) for (const c of t.needs ?? []) expect(known.has(c), `${t.id} needs "${c}"`).toBe(true);
  });
});

/** annotation-panel-modes slice 1: Segmentation families and their modes. */
describe('Segmentation families', () => {
  // Random Walker becomes a Seeded method (slice 5); the ROI limit is the header's toggle.
  const MOVED_OUT = new Set(['randomWalker', 'roiLimit']);

  it('every Segmentation tool except the moved-out ones belongs to exactly one family', () => {
    const counts = new Map<string, number>();
    for (const f of SEG_FAMILIES) for (const id of f.members) counts.set(id, (counts.get(id) ?? 0) + 1);
    const tools = toolsForKind('SEG').map((t) => t.id).filter((id) => !MOVED_OUT.has(id));
    expect(tools.filter((id) => counts.get(id) !== 1)).toEqual([]);
    expect([...counts.keys()].filter((id) => !tools.includes(id))).toEqual([]);
  });

  it('within a family, no two members share a mode, and every mode value is on its axis', () => {
    for (const f of SEG_FAMILIES) {
      if (!f.axes) continue;
      const keys = Object.values(f.modes ?? {}).map((m) => JSON.stringify(f.axes!.map((a) => m[a.id])));
      expect(new Set(keys).size, f.id).toBe(keys.length);
      for (const m of Object.values(f.modes ?? {})) {
        for (const a of f.axes) expect(a.options.map((o) => o.value), `${f.id}.${a.id}`).toContain(m[a.id]);
      }
    }
  });

  it('every axis option reaches some member', () => {
    for (const f of SEG_FAMILIES) for (const a of f.axes ?? []) for (const o of a.options) {
      expect(resolveMode(f, f.members[0], a.id, o.value), `${f.id}.${a.id}=${o.value}`).toBeDefined();
    }
  });

  it('family labels are unique and familyOf finds a member’s family', () => {
    expect(new Set(SEG_FAMILIES.map((f) => f.label)).size).toBe(SEG_FAMILIES.length);
    expect(familyOf('sphereThreshold')?.id).toBe('brush');
    expect(familyOf('rectThreshold')?.id).toBe('shape');
    expect(familyOf('length')).toBeUndefined();
  });

  const brush = () => SEG_FAMILIES.find((f) => f.id === 'brush')!;
  const shape = () => SEG_FAMILIES.find((f) => f.id === 'shape')!;

  it('changing one axis keeps the others when the combination exists', () => {
    expect(resolveMode(brush(), 'brush', 'kernel', '3d')).toBe('sphereBrush');
    expect(resolveMode(brush(), 'sphereBrush', 'limit', 'window')).toBe('sphereThreshold');
    expect(resolveMode(brush(), 'sphereThreshold', 'kernel', '2d')).toBe('threshold');
    expect(resolveMode(shape(), 'circleScissors', 'shape', 'sphere')).toBe('sphereScissors');
    expect(resolveMode(shape(), 'circleScissors', 'limit', 'window')).toBe('circleThreshold');
    expect(resolveMode(shape(), 'rectThreshold', 'shape', 'circle')).toBe('circleThreshold');
    expect(resolveMode(shape(), 'circleThreshold', 'shape', 'rect')).toBe('rectThreshold');
    expect(resolveMode(shape(), 'circleThreshold', 'limit', 'none')).toBe('circleScissors');
  });

  it('falls back to a member that has the value when the combination does not exist', () => {
    expect(resolveMode(brush(), 'sphereBrush', 'limit', 'edges')).toBe('smartBrush');
    expect(resolveMode(brush(), 'sphereThreshold', 'limit', 'click')).toBe('dynamicThreshold');
    // A sphere has no window limit: each side gives way to a tool that has the value picked.
    expect(resolveMode(shape(), 'sphereScissors', 'limit', 'window')).toBe('rectThreshold');
    expect(resolveMode(shape(), 'circleThreshold', 'shape', 'sphere')).toBe('sphereScissors');
  });
});
