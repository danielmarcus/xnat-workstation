/**
 * The WebGPU check behind Region / Region+: asked once, the way Cornerstone's grow-cut will ask
 * (an adapter, then a device with its ~2 GB limits), and never rejecting.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { growCutGpuStatus, probeGrowCutGpu, resetGrowCutGpuProbeForTests, type GpuLike } from '../growCutGpu';

beforeEach(() => resetGrowCutGpuProbeForTests());

describe('probeGrowCutGpu', () => {
  it('is unavailable with no navigator.gpu', async () => {
    await expect(probeGrowCutGpu(null)).resolves.toBe(false);
    expect(growCutGpuStatus()).toBe('unavailable');
  });

  it('is unavailable when requestAdapter() resolves null', async () => {
    await expect(probeGrowCutGpu({ requestAdapter: async () => null })).resolves.toBe(false);
  });

  it('is unavailable when the device cannot be had with the grow-cut\'s limits', async () => {
    const gpu: GpuLike = { requestAdapter: async () => ({ requestDevice: async () => { throw new Error('limit exceeded'); } }) };
    await expect(probeGrowCutGpu(gpu)).resolves.toBe(false);
  });

  it('is available with a device, which it releases, and asks only once', async () => {
    const destroy = vi.fn();
    const requestDevice = vi.fn(async (_desc?: { requiredLimits?: Record<string, number> }) => ({ destroy }));
    const requestAdapter = vi.fn(async () => ({ requestDevice }));
    expect(growCutGpuStatus()).toBe('unknown');
    await expect(probeGrowCutGpu({ requestAdapter })).resolves.toBe(true);
    await expect(probeGrowCutGpu({ requestAdapter })).resolves.toBe(true);
    expect(growCutGpuStatus()).toBe('available');
    expect(requestAdapter).toHaveBeenCalledTimes(1);
    expect(requestDevice.mock.calls[0][0]?.requiredLimits?.maxBufferSize).toBeGreaterThan(1.9 * 1024 ** 3);
    expect(destroy).toHaveBeenCalled();
  });
});
