/**
 * The Seeded segmentation operation's solve (branch 5; docs/segworks-parity.md §11): one entry
 * for the compute worker, dispatching on the method and applying the shared 3D cleanup.
 *
 * Seeds hold class + 1 per voxel. The binary methods (Fast GrowCut, Graph Cut) solve class 0
 * (the active member) against every other seeded class; α-expansion solves all classes at once
 * and its result is a class per voxel. Pure — runs in the worker and in unit tests.
 */
import { fastGrowCut } from './fastGrowCut';
import { graphCut, type GraphCutOptions } from './graphCut';
import { alphaExpansion, type AlphaExpansionOptions } from './alphaExpansion';
import { postProcess3d, type PostProcessOptions } from '../maskOps/volumeCleanup';
import type { Dims, Spacing } from './volume';

export type SeededMethod = 'growCut' | 'graphCut' | 'alphaExpansion';

export interface SeededSolveInput {
  method: SeededMethod;
  image: Float32Array;
  dims: Dims;
  spacing: Spacing;
  /** Class + 1 per voxel (0 = no seed). */
  seeds: Uint8Array;
  classes: number;
  /** Fast GrowCut's intensity gate (#110). */
  gate?: { lo: number; hi: number } | null;
  graphCut?: GraphCutOptions;
  alpha?: AlphaExpansionOptions;
  post?: PostProcessOptions;
  /**
   * For α-expansion: the class that is Background (never written, never cleaned). The binary
   * methods treat class 0 as the target.
   */
  backgroundClass?: number;
}

export interface SeededSolveOutput {
  /** Binary methods: 1 = the target. α-expansion: class index per voxel. */
  labels: Uint8Array;
  /** α-expansion's starting labelling (the preview's "init" view). */
  initial?: Uint8Array;
}

export function runSeededSolve(input: SeededSolveInput, onProgress?: (fraction: number) => void): SeededSolveOutput | null {
  const { method, image, dims, spacing, seeds, classes } = input;
  if (method === 'alphaExpansion') {
    const r = alphaExpansion(image, dims, spacing, seeds, classes, input.alpha, onProgress, input.backgroundClass);
    if (!r) return null;
    if (input.post?.enabled) {
      // Clean each written class on its own; what a class loses becomes Background.
      const bg = input.backgroundClass ?? -1;
      for (let k = 0; k < classes; k++) {
        if (k === bg) continue;
        const mask = Uint8Array.from(r.labels, (l) => (l === k ? 1 : 0));
        const own = Uint8Array.from(seeds, (s) => (s === k + 1 ? 1 : 0));
        const kept = postProcess3d(mask, dims, input.post, own);
        for (let i = 0; i < mask.length; i++) {
          if (mask[i] && !kept[i]) r.labels[i] = bg >= 0 ? bg : 255;
          else if (kept[i] && !mask[i] && r.labels[i] === bg) r.labels[i] = k;
        }
      }
    }
    return { labels: r.labels, initial: r.initial };
  }
  // Binary: class 0 is the target, any other seeded class is background.
  const binary = Uint8Array.from(seeds, (s) => (s === 0 ? 0 : s === 1 ? 1 : 2));
  let fg: Uint8Array | null;
  if (method === 'growCut') {
    const labels = fastGrowCut(image, dims, binary, { gate: input.gate ?? null, onProgress });
    fg = Uint8Array.from(labels, (l) => (l === 1 ? 1 : 0));
  } else {
    fg = graphCut(image, dims, binary, input.graphCut);
    onProgress?.(1);
  }
  if (!fg) return null;
  if (input.post?.enabled) fg = postProcess3d(fg, dims, input.post, Uint8Array.from(binary, (s) => (s === 1 ? 1 : 0)));
  return { labels: fg };
}
