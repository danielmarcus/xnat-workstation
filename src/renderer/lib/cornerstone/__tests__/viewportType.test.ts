import { describe, it, expect } from 'vitest';
import { chooseViewportType } from '../viewportType';

describe('chooseViewportType (stack-eligibility predicate, design §1.1)', () => {
  it('multi-slice CT / MR / PT → volume (the default)', () => {
    expect(chooseViewportType({ modality: 'CT', imageCount: 200 })).toBe('volume');
    expect(chooseViewportType({ modality: 'MR', imageCount: 24 })).toBe('volume');
    expect(chooseViewportType({ modality: 'PT', imageCount: 120 })).toBe('volume');
  });

  it('inherently non-volumetric modalities US/XA/RF → stack', () => {
    expect(chooseViewportType({ modality: 'US', imageCount: 1 })).toBe('stack');
    expect(chooseViewportType({ modality: 'XA', numberOfFrames: 30 })).toBe('stack');
    expect(chooseViewportType({ modality: 'RF', imageCount: 5 })).toBe('stack');
  });

  it('single-frame projection radiography DX/CR/MG → stack', () => {
    expect(chooseViewportType({ modality: 'DX', imageCount: 1, numberOfFrames: 1 })).toBe('stack');
    expect(chooseViewportType({ modality: 'CR', imageCount: 1 })).toBe('stack');
    expect(chooseViewportType({ modality: 'MG', imageCount: 1 })).toBe('stack');
  });

  it('multi-frame instance with NO spatial dimension (cine) → stack', () => {
    expect(chooseViewportType({ modality: 'XC', numberOfFrames: 60, multiFrameIsSpatial: false })).toBe('stack');
  });

  it('spatially-organized multi-frame instance (enhanced CT/MR) → volume', () => {
    expect(chooseViewportType({ modality: 'CT', numberOfFrames: 80, multiFrameIsSpatial: true, imageCount: 1 })).toBe('volume');
  });

  it('planar NM → stack; volumetric NM/SPECT → volume', () => {
    expect(chooseViewportType({ modality: 'NM', imageCount: 1 })).toBe('stack');
    expect(chooseViewportType({ modality: 'NM', imageCount: 64 })).toBe('volume');
  });

  it('a single image is not enough to build a volume → stack', () => {
    expect(chooseViewportType({ modality: 'CT', imageCount: 1 })).toBe('stack');
    expect(chooseViewportType({})).toBe('stack');
  });
});
