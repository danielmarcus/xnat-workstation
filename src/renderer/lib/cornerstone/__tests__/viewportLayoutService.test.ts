import { describe, it, expect, beforeEach } from 'vitest';
import { viewportLayoutService } from '../viewportLayoutService';

describe('viewportLayoutService (skeleton)', () => {
  beforeEach(() => {
    viewportLayoutService.dispose();
  });

  it('initializes idempotently and defaults to a 1x1 grid', () => {
    expect(viewportLayoutService.isInitialized()).toBe(false);
    viewportLayoutService.initialize();
    viewportLayoutService.initialize();
    expect(viewportLayoutService.isInitialized()).toBe(true);
    expect(viewportLayoutService.getLayout()).toEqual({ rows: 1, cols: 1 });
    expect(viewportLayoutService.getPanelCount()).toBe(1);
  });

  it('sets layout and computes panel count', () => {
    viewportLayoutService.initialize();
    viewportLayoutService.setLayout({ rows: 2, cols: 3 });
    expect(viewportLayoutService.getLayout()).toEqual({ rows: 2, cols: 3 });
    expect(viewportLayoutService.getPanelCount()).toBe(6);
  });

  it('clamps invalid dimensions to >= 1', () => {
    viewportLayoutService.initialize();
    viewportLayoutService.setLayout({ rows: 0, cols: -4 });
    expect(viewportLayoutService.getLayout()).toEqual({ rows: 1, cols: 1 });
  });

  it('returns a defensive copy of the layout', () => {
    viewportLayoutService.initialize();
    viewportLayoutService.setLayout({ rows: 2, cols: 2 });
    const snap = viewportLayoutService.getLayout();
    snap.rows = 99;
    expect(viewportLayoutService.getLayout().rows).toBe(2);
  });

  it('resets to default and clears state on dispose', () => {
    viewportLayoutService.initialize();
    viewportLayoutService.setLayout({ rows: 4, cols: 4 });
    viewportLayoutService.dispose();
    expect(viewportLayoutService.isInitialized()).toBe(false);
    expect(viewportLayoutService.getLayout()).toEqual({ rows: 1, cols: 1 });
  });

  describe('layout presets (Phase 1)', () => {
    it('single preset → one axial panel on a 1x1 grid', () => {
      expect(viewportLayoutService.getPresetPanels('single')).toEqual([
        { panelId: 'panel_0', orientation: 'AXIAL' },
      ]);
      expect(viewportLayoutService.presetGrid('single')).toEqual({ cols: 1, rows: 1 });
    });

    it('mpr-2x2 preset → three slice planes + a 3D render on a 2x2 grid (C5c)', () => {
      const panels = viewportLayoutService.getPresetPanels('mpr-2x2');
      expect(panels.map((p) => p.panelId)).toEqual(['panel_0', 'panel_1', 'panel_2', 'panel_3']);
      expect(panels.map((p) => p.orientation)).toEqual(['AXIAL', 'SAGITTAL', 'CORONAL', 'CORONAL']);
      // Only the fourth slot is a volume rendering; the other three stay slice views.
      expect(panels.map((p) => p.render3d === true)).toEqual([false, false, false, true]);
      expect(viewportLayoutService.presetGrid('mpr-2x2')).toEqual({ cols: 2, rows: 2 });
    });

    it('mpr-2x2 panel count matches its grid area', () => {
      const grid = viewportLayoutService.presetGrid('mpr-2x2');
      expect(viewportLayoutService.getPresetPanels('mpr-2x2')).toHaveLength(grid.cols * grid.rows);
    });
  });

  describe('generic grids (Phase 1.9)', () => {
    it('gridPanels(rows, cols) → rows*cols INDEPENDENT axial panels, each sourcing its own id', () => {
      expect(viewportLayoutService.gridPanels(1, 2)).toEqual([
        { panelId: 'panel_0', orientation: 'AXIAL', sourcePanelId: 'panel_0' },
        { panelId: 'panel_1', orientation: 'AXIAL', sourcePanelId: 'panel_1' },
      ]);
      expect(viewportLayoutService.gridPanels(2, 2)).toHaveLength(4);
      expect(viewportLayoutService.gridPanels(2, 2).map((p) => p.panelId)).toEqual([
        'panel_0', 'panel_1', 'panel_2', 'panel_3',
      ]);
    });

    it('clamps non-positive dimensions to one panel', () => {
      expect(viewportLayoutService.gridPanels(0, -3)).toEqual([
        { panelId: 'panel_0', orientation: 'AXIAL', sourcePanelId: 'panel_0' },
      ]);
    });
  });
});
