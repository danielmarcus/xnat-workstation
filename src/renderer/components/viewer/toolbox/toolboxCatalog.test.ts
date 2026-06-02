/**
 * Tool catalog shape tests — spec §4.8.3.
 *
 * These are mostly invariants: the toolbox sizes from the spec, no
 * duplicate ids inside a catalog, and the family-resolution helper.
 */
import { describe, expect, it } from 'vitest';
import { ToolName } from '@shared/types/viewer';
import {
  SEG_TOOLBOX,
  STRUCT_TOOLBOX,
  MEAS_TOOLBOX,
  catalogFor,
  toolboxKindForContainerKind,
  controlsFamilyForTool,
  TOOLBOX_COLUMNS,
} from './toolboxCatalog';

describe('toolboxCatalog (spec §4.8.3)', () => {
  it('SEG toolbox has 21 entries arranged in a 3×7 grid', () => {
    expect(SEG_TOOLBOX.length).toBe(21);
    expect(SEG_TOOLBOX.length / TOOLBOX_COLUMNS).toBe(7);
  });

  it('STRUCT toolbox has 4 wired entries', () => {
    expect(STRUCT_TOOLBOX.length).toBe(4);
    expect(STRUCT_TOOLBOX.filter((e) => e.wired).length).toBe(4);
  });

  it('MEAS toolbox has 9 entries in a 3×3 grid', () => {
    expect(MEAS_TOOLBOX.length).toBe(9);
    expect(MEAS_TOOLBOX.length / TOOLBOX_COLUMNS).toBe(3);
  });

  it('each catalog has unique ids', () => {
    for (const cat of [SEG_TOOLBOX, STRUCT_TOOLBOX, MEAS_TOOLBOX]) {
      const ids = new Set(cat.map((e) => e.id));
      expect(ids.size).toBe(cat.length);
    }
  });

  it('every wired entry resolves to a non-null ToolName', () => {
    for (const cat of [SEG_TOOLBOX, STRUCT_TOOLBOX, MEAS_TOOLBOX]) {
      for (const entry of cat) {
        if (entry.wired) expect(entry.tool).not.toBeNull();
        else expect(entry.tool).toBeNull();
      }
    }
  });

  it('catalogFor maps the toolboxKind to the right catalog', () => {
    expect(catalogFor('SEG')).toBe(SEG_TOOLBOX);
    expect(catalogFor('STRUCT')).toBe(STRUCT_TOOLBOX);
    expect(catalogFor('MEAS')).toBe(MEAS_TOOLBOX);
  });

  it('toolboxKindForContainerKind maps SEG/RTSTRUCT/POI correctly', () => {
    expect(toolboxKindForContainerKind('SEG')).toBe('SEG');
    expect(toolboxKindForContainerKind('RTSTRUCT')).toBe('STRUCT');
    expect(toolboxKindForContainerKind('POI')).toBe('MEAS');
  });

  describe('controlsFamilyForTool', () => {
    it('Brush / Eraser → "brush"', () => {
      expect(controlsFamilyForTool(ToolName.Brush)).toBe('brush');
      expect(controlsFamilyForTool(ToolName.Eraser)).toBe('brush');
    });
    it('ThresholdBrush + ROIThreshold tools → "threshold-range"', () => {
      expect(controlsFamilyForTool(ToolName.ThresholdBrush)).toBe('threshold-range');
      expect(controlsFamilyForTool(ToolName.RectangleROIThreshold)).toBe('threshold-range');
      expect(controlsFamilyForTool(ToolName.CircleROIThreshold)).toBe('threshold-range');
    });
    it('SplineContour → "spline-type"', () => {
      expect(controlsFamilyForTool(ToolName.SplineContour)).toBe('spline-type');
    });
    it('Region tools → "region-strength"', () => {
      expect(controlsFamilyForTool(ToolName.RegionSegment)).toBe('region-strength');
      expect(controlsFamilyForTool(ToolName.RegionSegmentPlus)).toBe('region-strength');
    });
    it('MEAS tools → "meas-hint"', () => {
      expect(controlsFamilyForTool(ToolName.Length)).toBe('meas-hint');
      expect(controlsFamilyForTool(ToolName.Probe)).toBe('meas-hint');
    });
    it('STRUCT non-spline tools → "struct-contour"', () => {
      expect(controlsFamilyForTool(ToolName.FreehandContour)).toBe('struct-contour');
      expect(controlsFamilyForTool(ToolName.LivewireContour)).toBe('struct-contour');
      expect(controlsFamilyForTool(ToolName.Sculptor)).toBe('struct-contour');
    });
    it('null / unwired-only entries → "none"', () => {
      expect(controlsFamilyForTool(null)).toBe('none');
      // Crosshairs isn't in any toolbox.
      expect(controlsFamilyForTool(ToolName.Crosshairs)).toBe('none');
    });
  });
});
