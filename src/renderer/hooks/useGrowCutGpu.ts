/**
 * Whether Region / Region+ can run here (Cornerstone's grow-cut needs WebGPU) — the toolbox's
 * view of growCutGpu. Asks the first time a component wants it; the answer is cached.
 */
import { useEffect, useSyncExternalStore } from 'react';
import {
  GROW_CUT_GPU_UNAVAILABLE_MESSAGE, growCutGpuStatus, probeGrowCutGpu, subscribeGrowCutGpu,
} from '../lib/cornerstone/growCutGpu';

/** Catalog tool ids → why they cannot run here; undefined while they can (or before the answer). */
export function useGrowCutGpuUnavailableTools(): Partial<Record<string, string>> | undefined {
  useEffect(() => { void probeGrowCutGpu(); }, []);
  const status = useSyncExternalStore(subscribeGrowCutGpu, growCutGpuStatus);
  return status === 'unavailable'
    ? { region: GROW_CUT_GPU_UNAVAILABLE_MESSAGE, regionPlus: GROW_CUT_GPU_UNAVAILABLE_MESSAGE }
    : undefined;
}
