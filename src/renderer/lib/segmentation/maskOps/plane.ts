/**
 * Binary mask planes — the unit every cleanup operation works on (SegWorks parity,
 * branch 1, docs/segworks-parity.md §5).
 *
 * A plane is one slice of ONE segment, in the viewing plane, as 0/1 bytes in row-major
 * order (`x + y·width`). It knows nothing about Cornerstone, storage or other segments:
 * the transaction layer extracts planes from a segment's voxel grid, runs an operation,
 * and decides what may actually be written (locks, other members, ROI). Keeping the
 * operations pure is what lets them be tested exactly, on synthetic planes.
 *
 * Sizes users reason about physically (areas, distances) are in mm / mm² and need the
 * plane's spacing; kernel radii are in pixels, as in SegWorks.
 */

export interface MaskPlane {
  width: number;
  height: number;
  /** 1 inside the segment, 0 outside; row-major `x + y·width`. */
  data: Uint8Array;
}

/** mm per pixel along the plane's x (width) and y (height) axes. */
export interface PlaneSpacing {
  x: number;
  y: number;
}

export type Connectivity = 4 | 8;

export interface Components {
  /** Component id per pixel (1-based); 0 where the plane is 0. */
  labels: Int32Array;
  /** Number of components. */
  count: number;
  /** Pixel count per component, indexed by id (index 0 unused). */
  sizes: number[];
  /** Centroid (pixel coordinates) per component, indexed by id (index 0 unused). */
  centroids: Array<{ x: number; y: number }>;
}

export function emptyPlane(width: number, height: number): MaskPlane {
  return { width, height, data: new Uint8Array(width * height) };
}

/** Number of set pixels. */
export function countSet(data: ArrayLike<number>): number {
  let n = 0;
  for (let i = 0; i < data.length; i++) if (data[i]) n++;
  return n;
}

/**
 * Connected components of the pixels where `data[i] === value`. Foreground uses
 * 8-connectivity by default — the same notion of "one island" the Select tool uses
 * (maskIslands) — so an op's idea of a component matches what the user can click.
 */
export function labelComponents(
  data: ArrayLike<number>,
  width: number,
  height: number,
  connectivity: Connectivity = 8,
  value = 1,
): Components {
  const n = width * height;
  const labels = new Int32Array(n);
  const sizes: number[] = [0];
  const centroids: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }];
  const stack = new Int32Array(n);
  let count = 0;
  for (let seed = 0; seed < n; seed++) {
    if (data[seed] !== value || labels[seed] !== 0) continue;
    count++;
    let top = 0;
    stack[top++] = seed;
    labels[seed] = count;
    let size = 0;
    let sx = 0;
    let sy = 0;
    while (top > 0) {
      const p = stack[--top];
      const y = (p / width) | 0;
      const x = p - y * width;
      size++;
      sx += x;
      sy += y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (connectivity === 4 && dx !== 0 && dy !== 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const q = nx + ny * width;
          if (data[q] !== value || labels[q] !== 0) continue;
          labels[q] = count;
          stack[top++] = q;
        }
      }
    }
    sizes.push(size);
    centroids.push({ x: sx / size, y: sy / size });
  }
  return { labels, count, sizes, centroids };
}
