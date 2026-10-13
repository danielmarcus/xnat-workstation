/**
 * Memory guard for the 3D solvers (branch 5, G1; wireframes §5: an estimate line, then an amber
 * warning, then a disabled Run with a reason — never a modal).
 *
 * Bytes per voxel are counted from what each solver allocates (typed arrays, sized up front),
 * not guessed:
 *  - Fast GrowCut: image 4 + seeds 1 + labels 1 + distance 8 + heap 4 + heap index 4 = 22.
 *  - Graph Cut: image 4 + seeds 1 + two unaries 8 + graph nodes 25 + active queue 5 + three
 *    6-neighbour edges × two arcs × 16 = 96 + labels 2 = 141.
 *  - α-expansion: image 4 + seeds 1 + labels 3 + pair tables 36 + one move's graph 126 + its
 *    labels 2, plus a data cost per class 4·K.
 *  - Region competition: image 4 + clipped image 4 + gradient 4 + sorted copy 4 + labels 3 +
 *    cleanup stack 5 = 24.
 */

export type SolverMethod = 'growCut' | 'graphCut' | 'alphaExpansion' | 'regionCompetition';

export function bytesPerVoxel(method: SolverMethod, classes = 2): number {
  switch (method) {
    case 'growCut': return 22;
    case 'graphCut': return 141;
    case 'alphaExpansion': return 172 + 4 * classes;
    case 'regionCompetition': return 24;
  }
}

export interface MemoryLimits {
  /** Amber from here (bytes). */
  warn: number;
  /** Run refused from here (bytes). */
  block: number;
}

/** The worker's budget: well inside what one Electron worker can hold. */
export const DEFAULT_MEMORY_LIMITS: MemoryLimits = { warn: 512 * 2 ** 20, block: 1536 * 2 ** 20 };

export interface MemoryEstimate {
  bytes: number;
  level: 'ok' | 'warn' | 'block';
  /** "1.9 M voxels · est. 210 MB" — the estimate line. */
  text: string;
  /** Why Run is disabled (block only). */
  reason: string | null;
}

export function estimateMemory(method: SolverMethod, voxels: number, classes = 2, limits: MemoryLimits = DEFAULT_MEMORY_LIMITS): MemoryEstimate {
  const bytes = voxels * bytesPerVoxel(method, classes);
  const level = bytes >= limits.block ? 'block' : bytes >= limits.warn ? 'warn' : 'ok';
  const mb = Math.round(bytes / 2 ** 20);
  const vox = voxels >= 1e6 ? `${(voxels / 1e6).toFixed(1)} M` : voxels >= 1e3 ? `${Math.round(voxels / 1e3)} k` : String(voxels);
  return {
    bytes,
    level,
    text: `${vox} voxels · est. ${mb} MB`,
    reason: level === 'block' ? `Too large to solve (${mb} MB over ${Math.round(limits.block / 2 ** 20)} MB) — narrow the domain or the slice range` : null,
  };
}
