import { beforeEach, describe, expect, it } from 'vitest';
import {
  viewportLayoutService,
  _resetCurrentPreset,
} from '../viewportLayoutService';

describe('viewportLayoutService', () => {
  beforeEach(() => {
    _resetCurrentPreset();
  });

  describe('listPresets', () => {
    it('returns all six built-in presets', () => {
      const presets = viewportLayoutService.listPresets();
      const ids = presets.map((p) => p.id);
      expect(ids).toEqual(['1x1', '1x2', '2x1', '2x2', 'mpr-2x2', 'custom']);
    });

    it('returns clones (mutating the result does not affect canonical data)', () => {
      const first = viewportLayoutService.listPresets();
      first[0].rows = 999;
      const second = viewportLayoutService.listPresets();
      expect(second[0].rows).toBe(1);
    });
  });

  describe('getPreset', () => {
    it('returns the simple grid presets with row/col counts', () => {
      expect(viewportLayoutService.getPreset('1x1')?.rows).toBe(1);
      expect(viewportLayoutService.getPreset('1x1')?.cols).toBe(1);
      expect(viewportLayoutService.getPreset('2x2')?.rows).toBe(2);
      expect(viewportLayoutService.getPreset('2x2')?.cols).toBe(2);
    });

    it('returns mpr-2x2 with axial/sagittal/coronal/3d slots in row-major order', () => {
      const preset = viewportLayoutService.getPreset('mpr-2x2');
      expect(preset).not.toBeNull();
      expect(preset!.slots).toEqual([
        { index: 0, orientation: 'AXIAL' },
        { index: 1, orientation: 'SAGITTAL' },
        { index: 2, orientation: 'CORONAL' },
        { index: 3, orientation: '3d' },
      ]);
      expect(preset!.autoLink).toBe(true);
    });

    it('returns null for unknown preset', () => {
      expect(viewportLayoutService.getPreset('unknown' as never)).toBeNull();
    });

    it('only the mpr-2x2 preset auto-links by default', () => {
      const presets = viewportLayoutService.listPresets();
      for (const preset of presets) {
        expect(preset.autoLink).toBe(preset.id === 'mpr-2x2');
      }
    });
  });

  describe('applyPreset / getCurrentPresetId', () => {
    it('starts with null current preset', () => {
      expect(viewportLayoutService.getCurrentPresetId()).toBeNull();
    });

    it('records the applied preset id', () => {
      viewportLayoutService.applyPreset('mpr-2x2');
      expect(viewportLayoutService.getCurrentPresetId()).toBe('mpr-2x2');

      viewportLayoutService.applyPreset('1x1');
      expect(viewportLayoutService.getCurrentPresetId()).toBe('1x1');
    });

    it('throws for unknown preset', () => {
      expect(() => viewportLayoutService.applyPreset('unknown' as never)).toThrow(
        /Unknown preset/,
      );
    });
  });
});
