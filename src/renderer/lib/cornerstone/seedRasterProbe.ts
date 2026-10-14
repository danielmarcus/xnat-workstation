/**
 * Test seam (read only): the seed raster the last seeded run solved with — Random Walker's
 * plane or a seeded solve's box — summarised per class: voxel count and extent in mm along
 * the box's x, y and z. E2E specs check the brush's shape in mm and the seeds a run used.
 */
export interface SeedRasterSummary {
  spacing: [number, number, number];
  classes: Record<number, { voxels: number; extentMm: [number, number, number] }>;
}

let last: SeedRasterSummary | null = null;

/** Record a raster: a class per voxel (0 = none) over `dims`, x fastest. */
export function recordSeedRaster(dims: readonly number[], spacing: readonly number[], seeds: ArrayLike<number>): void {
  const lo = new Map<number, number[]>(), hi = new Map<number, number[]>(), n = new Map<number, number>();
  const [nx, ny] = dims;
  for (let i = 0; i < seeds.length; i++) {
    const c = seeds[i];
    if (!c) continue;
    const p = [i % nx, Math.floor(i / nx) % ny, Math.floor(i / (nx * ny))];
    const a = lo.get(c), b = hi.get(c);
    if (!a || !b) { lo.set(c, [...p]); hi.set(c, [...p]); }
    else for (let k = 0; k < 3; k++) { a[k] = Math.min(a[k], p[k]); b[k] = Math.max(b[k], p[k]); }
    n.set(c, (n.get(c) ?? 0) + 1);
  }
  const classes: SeedRasterSummary['classes'] = {};
  for (const [c, voxels] of n) {
    const a = lo.get(c)!, b = hi.get(c)!;
    classes[c] = { voxels, extentMm: [0, 1, 2].map((k) => (b[k] - a[k] + 1) * spacing[k]) as [number, number, number] };
  }
  last = { spacing: [spacing[0], spacing[1], spacing[2] ?? 1], classes };
}

export function lastSeedRaster(): SeedRasterSummary | null {
  return last;
}
