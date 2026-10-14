/**
 * Fast GrowCut as a module (branch 9, M5(b) — docs/segworks-parity.md §12): the built-in
 * Seeded segmentation's solve (`runSeededSolve`, method growCut), bundled from the host's own
 * source by `npm run build:modules` — so on the same seeds and box its result is the built-in's,
 * voxel for voxel. Seeds arrive as API 1.0 strokes (box coordinates, a radius in voxels) and are
 * rasterised exactly as the built-in rasterises them: the active member is the target (class
 * 1), every other seed is background (class 2).
 */
import { runSeededSolve } from '../../../src/renderer/lib/segmentation/solvers/seeded';
import { rasterizeSeeds, type Dims, type SeedStroke } from '../../../src/renderer/lib/segmentation/solvers/volume';

interface Input {
  dims: [number, number, number];
  spacing: [number, number, number];
  image: Float32Array;
  seeds?: Array<{ cls: 'active' | 'background' | number; radius: number; points: Array<[number, number, number]> }>;
  params: Record<string, number | string | boolean>;
}
interface Api { progress(f: number): void; log(...a: unknown[]): void }

export function run(input: Input, api: Api): { mask: Uint8Array } {
  const dims = input.dims as unknown as Dims;
  const p = input.params;
  const strokes: SeedStroke[] = (input.seeds ?? []).filter((s) => s.points.length).map((s) => {
    const z = s.points[0][2];
    return {
      cls: s.cls === 'active' ? 1 : 2,
      z,
      points: s.points.filter((q) => q[2] === z).map((q) => [q[0], q[1]] as [number, number]),
      rx: s.radius,
      ry: s.radius,
    };
  });
  const seeds = rasterizeSeeds(dims, strokes);
  const present = new Set(seeds);
  if (!present.has(1) || !present.has(2)) throw new Error('Seed the segment and its background (another segment, or Background) first');
  api.log(`${strokes.length} seed strokes; box ${dims.join(' × ')}`);
  const out = runSeededSolve({
    method: 'growCut', image: input.image, dims, spacing: input.spacing as unknown as Dims, seeds, classes: 2,
    gate: p.gateOn ? { lo: Number(p.gateLo), hi: Number(p.gateHi) } : null,
    post: { enabled: !!p.postOn, keep: p.postKeep as 'off' | 'seed' | 'largest', minIsland: Number(p.postMinIsland), smoothPasses: Number(p.postSmooth), shrinkGrowPasses: Number(p.postShrinkGrow) },
  }, (f) => api.progress(f));
  if (!out) throw new Error('Fast GrowCut found nothing to grow');
  return { mask: out.labels };
}
