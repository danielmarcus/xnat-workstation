import { describe, it, expect } from 'vitest';
import { hasMixedOrientation, orientationGroups, sliceNormal } from '../seriesGeometry';

const AXIAL = [1, 0, 0, 0, 1, 0];
const SAGITTAL = [0, 1, 0, 0, 0, -1];
const CORONAL = [1, 0, 0, 0, 0, -1];

describe('seriesGeometry', () => {
  it('computes the unit slice normal, and rejects unusable orientations', () => {
    expect(sliceNormal(AXIAL)).toEqual([0, 0, 1]);
    expect(sliceNormal([1, 0, 0, 1, 0, 0])).toBeNull(); // parallel row/column
    expect(sliceNormal([1, 0, 0])).toBeNull();
    expect(sliceNormal(undefined)).toBeNull();
  });

  it('groups a 3-plane localizer into three planes, numbered by first appearance', () => {
    expect(orientationGroups([AXIAL, AXIAL, SAGITTAL, CORONAL, SAGITTAL, null])).toEqual([0, 0, 1, 2, 1, null]);
    expect(hasMixedOrientation([AXIAL, SAGITTAL, CORONAL])).toBe(true);
  });

  it('treats one plane as one orientation, including flipped normals and sub-degree jitter', () => {
    const flipped = [1, 0, 0, 0, -1, 0]; // normal (0,0,-1): same plane
    const jitter = [1, 0, 0, 0, Math.cos(0.004), Math.sin(0.004)]; // ~0.23°
    expect(hasMixedOrientation([AXIAL, flipped, jitter, AXIAL])).toBe(false);
  });

  it('counts a genuinely tilted plane as a different orientation', () => {
    const tilted = [1, 0, 0, 0, Math.cos(Math.PI / 36), Math.sin(Math.PI / 36)]; // 5°
    expect(hasMixedOrientation([AXIAL, tilted])).toBe(true);
  });

  it('ignores images with no orientation rather than calling the series mixed', () => {
    expect(hasMixedOrientation([AXIAL, null, undefined, AXIAL])).toBe(false);
    expect(hasMixedOrientation([])).toBe(false);
  });
});
