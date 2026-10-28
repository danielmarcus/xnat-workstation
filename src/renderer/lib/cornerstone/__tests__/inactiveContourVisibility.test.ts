import { describe, expect, it } from 'vitest';
import { installInactiveContourVisibility, type ContourVisibilityLookups } from '../inactiveContourVisibility';

/**
 * Cornerstone 5 draws an INACTIVE contour segmentation's segments whatever their visibility
 * (reported 2026-10-28: a Structure's eye did not hide it while a Segmentation was active).
 * The wrapper makes a hidden segment, or a hidden representation, not draw.
 */
function fakeToolClass(visibility: boolean) {
  class Base {
    _getContourSegmentationStyle(_context: unknown): Record<string, unknown> {
      return { color: 'red', visibility };
    }
  }
  class Tool extends Base {}
  return Tool;
}

const ctx = (segmentIndex: number) => ({
  annotation: { data: { segmentation: { segmentationId: 'rt-1', segmentIndex } } },
  styleSpecifier: { viewportId: 'panel_0' },
});

function lookups(hidden: number[], repVisible = true): ContourVisibilityLookups {
  return { hiddenSegments: () => new Set(hidden), representationVisible: () => repVisible };
}

describe('installInactiveContourVisibility', () => {
  it('a hidden segment is not drawn even when Cornerstone says to draw it (inactive segmentation)', () => {
    const Tool = fakeToolClass(true);
    expect(installInactiveContourVisibility(Tool, lookups([2]))).toBe(true);
    const tool = new Tool();
    expect(tool._getContourSegmentationStyle(ctx(2))).toMatchObject({ color: 'red', visibility: false });
    expect(tool._getContourSegmentationStyle(ctx(1))).toMatchObject({ color: 'red', visibility: true });
  });

  it('a hidden representation hides every segment', () => {
    const Tool = fakeToolClass(true);
    installInactiveContourVisibility(Tool, lookups([], false));
    expect(new Tool()._getContourSegmentationStyle(ctx(1))).toMatchObject({ visibility: false });
  });

  it('never shows what Cornerstone hid, and wraps only once', () => {
    const Tool = fakeToolClass(false);
    let calls = 0;
    const counting: ContourVisibilityLookups = { hiddenSegments: () => { calls++; return new Set(); }, representationVisible: () => true };
    installInactiveContourVisibility(Tool, counting);
    installInactiveContourVisibility(Tool, counting);
    expect(new Tool()._getContourSegmentationStyle(ctx(1))).toMatchObject({ visibility: false });
    expect(calls).toBe(0);
  });

  it('reports false when the method is not there (a Cornerstone upgrade renamed it)', () => {
    class Bare {}
    expect(installInactiveContourVisibility(Bare, lookups([]))).toBe(false);
  });
});
