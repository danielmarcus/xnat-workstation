import { describe, expect, it } from 'vitest';
import { ToolName } from '@shared/types/viewer';
import { CATALOG_TO_TOOLNAME, TOOLNAME_TO_CATALOG, toolsForKind } from '../toolCatalog';

/** Rebuild Phase 3, R3.8b — toolbox → Cornerstone tool mapping. */
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

  it('every non-planned catalog tool across all kinds has a ToolName mapping', () => {
    for (const kind of ['SEG', 'RTSTRUCT', 'SR'] as const) {
      for (const t of toolsForKind(kind)) {
        if (t.planned) continue;
        expect(CATALOG_TO_TOOLNAME[t.id], `missing mapping for ${kind} tool "${t.id}"`).toBeDefined();
      }
    }
  });
});
