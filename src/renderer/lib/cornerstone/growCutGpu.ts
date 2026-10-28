/**
 * Whether this machine can run Cornerstone's grow-cut — the engine of the Region and Region+
 * tools. That grow-cut runs on WebGPU only (`runGrowCut` asks `navigator.gpu` for an adapter and
 * a device with ~2 GB buffer limits), and without one it threw from deep inside Cornerstone: a
 * GPU-less host, a VM or a remote desktop got an unhandled TypeError and a tool that silently
 * did nothing.
 *
 * Asked once, the way Cornerstone will ask, and cached: an adapter, then a device with the same
 * limits (an adapter whose limits are smaller fails exactly where Cornerstone's would). The
 * toolbox reads the answer (useGrowCutGpu) to disable both tools; the tools await it before running.
 */
export type GrowCutGpuStatus = 'unknown' | 'available' | 'unavailable';

/** What the user is told when Region / Region+ cannot run here (toast and tooltip). */
export const GROW_CUT_GPU_UNAVAILABLE_MESSAGE =
  'Region and Region+ need WebGPU, which this computer does not provide. Use the Seeded segmentation operation (Fast GrowCut, on the CPU) instead.';

/** `runGrowCut`'s requiredLimits (maxStorageBufferBindingSize, maxBufferSize). */
const GROW_CUT_MEMORY_LIMIT = 1.99 * 1024 * 1024 * 1024;

/** The slice of the WebGPU API asked here (the DOM lib in use does not type `navigator.gpu`). */
interface GpuDevice { destroy?: () => void }
interface GpuAdapter { requestDevice(desc?: { requiredLimits?: Record<string, number> }): Promise<GpuDevice> }
export interface GpuLike { requestAdapter(): Promise<GpuAdapter | null> }

let status: GrowCutGpuStatus = 'unknown';
let probe: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

function settle(ok: boolean, why?: unknown): boolean {
  status = ok ? 'available' : 'unavailable';
  if (!ok) console.warn('[growCutGpu] Region / Region+ unavailable — no usable WebGPU device:', why);
  for (const l of listeners) l();
  return ok;
}

/**
 * Whether grow-cut can run here (resolves once; later calls share the answer). Never rejects.
 * `gpu` is for tests; the app asks `navigator.gpu`.
 */
export function probeGrowCutGpu(gpu?: GpuLike | null): Promise<boolean> {
  if (probe) return probe;
  const api = gpu !== undefined ? gpu : (globalThis.navigator as { gpu?: GpuLike } | undefined)?.gpu;
  probe = (async () => {
    if (!api) return settle(false, 'navigator.gpu is absent');
    try {
      const adapter = await api.requestAdapter();
      if (!adapter) return settle(false, 'requestAdapter() returned null');
      const device = await adapter.requestDevice({
        requiredLimits: { maxStorageBufferBindingSize: GROW_CUT_MEMORY_LIMIT, maxBufferSize: GROW_CUT_MEMORY_LIMIT },
      });
      device.destroy?.();
      return settle(true);
    } catch (err) {
      return settle(false, err);
    }
  })();
  return probe;
}

export function growCutGpuStatus(): GrowCutGpuStatus {
  return status;
}

/** Called when the answer arrives. Returns the unsubscribe. */
export function subscribeGrowCutGpu(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** Tests only: forget the cached answer. */
export function resetGrowCutGpuProbeForTests(): void {
  status = 'unknown';
  probe = null;
}
