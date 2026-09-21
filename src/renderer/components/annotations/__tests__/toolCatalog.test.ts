import { describe, expect, it } from 'vitest';
import { ToolName } from '@shared/types/viewer';
import { CATALOG_TO_TOOLNAME, TOOLNAME_TO_CATALOG, toolsForKind } from '../toolCatalog';
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
  const ALL = (['SEG', 'RTSTRUCT', 'SR'] as const).flatMap((k) => toolsForKind(k));

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
    const known = new Set(['brushSize', 'intensityWindow', 'samplingRadius', 'scissorMode']);
    for (const t of ALL) for (const c of t.needs ?? []) expect(known.has(c), `${t.id} needs "${c}"`).toBe(true);
  });
});
