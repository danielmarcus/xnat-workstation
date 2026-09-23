import { describe, expect, it, vi } from 'vitest';

vi.mock('@cornerstonejs/core', () => ({ cache: {}, metaData: { get: () => undefined } }));
vi.mock('@cornerstonejs/tools', () => ({ segmentation: { state: {} } }));

import { stackGridGeometry, type SlicePlane } from '../segmentVoxelGrid';
import { indexToWorld, type Vec3 } from '../segmentationService/voxelClipboard';

const s = Math.SQRT1_2;
function plane(ipp: Vec3, row: Vec3 = [1, 0, 0], col: Vec3 = [0, 1, 0]): SlicePlane {
  return {
    rows: 4, columns: 6, imagePositionPatient: ipp, rowCosines: row, columnCosines: col,
    rowPixelSpacing: 0.5, columnPixelSpacing: 0.8,
  };
}
const close = (a: Vec3, b: Vec3) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));

describe('stackGridGeometry', () => {
  it('orders slices along the normal, whatever the stack order', () => {
    const placed = stackGridGeometry([plane([0, 0, 4]), plane([0, 0, 0]), plane([0, 0, 2])])!;
    expect(placed.order).toEqual([1, 2, 0]);
    expect(placed.geometry.dimensions).toEqual([6, 4, 3]);
    expect(placed.geometry.spacing).toEqual([0.8, 0.5, 2]);
    expect(placed.geometry.origin).toEqual([0, 0, 0]);
  });

  it('maps grid index (i, j, k) to the pixel centre of that slice, on an oblique plane', () => {
    const row: Vec3 = [s, s, 0];
    const col: Vec3 = [0, 0, -1];
    const normal: Vec3 = [-s, s, 0]; // row × col
    const at = (k: number): Vec3 => [10 + normal[0] * 3 * k, 20 + normal[1] * 3 * k, 30];
    const placed = stackGridGeometry([plane(at(0), row, col), plane(at(1), row, col)])!;
    const [i, j, k] = [5, 2, 1];
    const expected: Vec3 = [
      at(k)[0] + i * 0.8 * row[0] + j * 0.5 * col[0],
      at(k)[1] + i * 0.8 * row[1] + j * 0.5 * col[1],
      at(k)[2] + i * 0.8 * row[2] + j * 0.5 * col[2],
    ];
    close(indexToWorld(placed.geometry, [i, j, k]), expected);
  });

  it('refuses stacks that are not one regular volume', () => {
    expect(stackGridGeometry([plane([0, 0, 0]), plane([0, 0, 1]), plane([0, 0, 3])])).toBeNull();
    expect(stackGridGeometry([plane([0, 0, 0]), plane([0, 0, 1], [0, 1, 0], [0, 0, 1])])).toBeNull();
    expect(stackGridGeometry([plane([0, 0, 0]), { ...plane([0, 0, 1]), rows: 8 }])).toBeNull();
    expect(stackGridGeometry([plane([0, 0, 0]), plane([0, 0, 0])])).toBeNull();
  });
});
