// @vitest-environment jsdom
/**
 * Region / Region+ without WebGPU. Cornerstone's grow-cut runs on WebGPU only; where
 * `navigator.gpu` is absent or `requestAdapter()` resolves null, its `runGrowCut` threw a
 * TypeError ("Cannot read properties of null (reading 'requestDevice')") as an unhandled
 * rejection, changed nothing, and told the user nothing. The tools must refuse with a toast
 * before they start, let no rejection escape, and leave no undo step behind.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => {
  /** Cornerstone's grow-cut device request, as `runGrowCut` makes it. */
  async function cornerstoneRunGrowCut(): Promise<void> {
    const adapter = await (navigator as unknown as { gpu?: { requestAdapter(): Promise<{ requestDevice(): Promise<unknown> } | null> } }).gpu?.requestAdapter();
    await adapter!.requestDevice();
    write();
  }
  const write = vi.fn();
  class GrowCutBase {
    growCutData: unknown = null;
    allowedToProceed = true;
    mouseTimer: number | null = null;
    async preMouseDownCallback(): Promise<boolean> {
      this.growCutData = { segmentation: {} };
      return true;
    }
    async runGrowCut(): Promise<void> {
      await cornerstoneRunGrowCut();
      this.growCutData = null;
    }
  }
  class RegionSegmentTool extends GrowCutBase {
    static toolName = 'RegionSegment';
    /** Cornerstone's mouse-up: `this.runGrowCut()`, not awaited and not caught. */
    end(): void {
      this.runGrowCut();
    }
  }
  class RegionSegmentPlusTool extends GrowCutBase {
    static toolName = 'RegionSegmentPlus';
    async onMouseStable(): Promise<void> { this.allowedToProceed = true; }
    mouseMoveCallback(): void {}
    async preMouseDownCallback(): Promise<boolean> {
      await super.preMouseDownCallback();
      await this.runGrowCut();
      return true;
    }
  }
  const edit = { finish: vi.fn(() => 'no-change'), abort: vi.fn() };
  return { RegionSegmentTool, RegionSegmentPlusTool, write, edit, beginDirectEdit: vi.fn(() => edit) };
});

vi.mock('@cornerstonejs/tools', () => ({ RegionSegmentTool: m.RegionSegmentTool, RegionSegmentPlusTool: m.RegionSegmentPlusTool }));
vi.mock('@cornerstonejs/core', () => ({ getEnabledElement: () => ({ viewport: { getCamera: () => ({ viewPlaneNormal: [0, 0, 1] }) } }) }));
vi.mock('../segmentVoxelGrid', () => ({ readSegmentVoxelGrid: () => null }));
vi.mock('../maskIslands', () => ({ OBLIQUE_VIEW_MESSAGE: 'oblique', viewAlignedWithGrid: () => true }));
vi.mock('../labelmapTransaction', () => ({ beginDirectEdit: m.beginDirectEdit, isSegmentLockedHere: () => false }));
vi.mock('../../annotations/lockWarning', () => ({ warnMemberLocked: vi.fn() }));

import { AppRegionSegmentPlusTool, AppRegionSegmentTool } from './AppRegionSegmentPlusTool';
import { useToastStore } from '../../../stores/toastStore';
import { useSegmentationStore } from '../../../stores/segmentationStore';
import { GROW_CUT_GPU_UNAVAILABLE_MESSAGE, resetGrowCutGpuProbeForTests } from '../growCutGpu';

function setGpu(gpu: unknown): void {
  Object.defineProperty(navigator, 'gpu', { value: gpu, configurable: true });
}
const NULL_ADAPTER = { requestAdapter: async () => null };
const WORKING_GPU = { requestAdapter: async () => ({ requestDevice: async () => ({ destroy() {} }) }) };

const evt = () => ({ detail: { element: document.createElement('div'), currentPoints: { world: [0, 0, 0] } } }) as never;
const toasts = () => useToastStore.getState().toasts.map((t) => t.message);

/** Unhandled rejections raised while a case runs. */
let unhandled: unknown[];
const onUnhandled = (reason: unknown) => { unhandled.push(reason); };

beforeEach(() => {
  resetGrowCutGpuProbeForTests();
  useToastStore.setState({ toasts: [] });
  useSegmentationStore.setState({ activeSegmentationId: 'seg-1', activeSegmentIndex: 1 } as never);
  m.write.mockClear();
  m.beginDirectEdit.mockClear();
  m.edit.finish.mockClear();
  m.edit.abort.mockClear();
  unhandled = [];
  process.on('unhandledRejection', onUnhandled);
});
afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
  setGpu(undefined);
});

/** Let pending promise chains (and Node's unhandled-rejection check) run. */
const drain = () => new Promise((r) => setTimeout(r, 20));

describe.each([
  ['navigator.gpu is absent', undefined],
  ['requestAdapter() resolves null', NULL_ADAPTER],
])('without WebGPU (%s)', (_name, gpu) => {
  it('Region refuses the gesture with a toast, and runs nothing', async () => {
    setGpu(gpu);
    const tool = new AppRegionSegmentTool();
    expect(await tool.preMouseDownCallback(evt())).toBe(false);
    await drain();
    expect(toasts()).toEqual([GROW_CUT_GPU_UNAVAILABLE_MESSAGE]);
    expect(m.beginDirectEdit).not.toHaveBeenCalled();
    expect(m.write).not.toHaveBeenCalled();
    expect(unhandled).toEqual([]);
  });

  it('Region+ refuses the click with a toast, and runs nothing', async () => {
    setGpu(gpu);
    const tool = new AppRegionSegmentPlusTool();
    expect(await tool.preMouseDownCallback(evt())).toBe(false);
    await drain();
    expect(toasts()).toEqual([GROW_CUT_GPU_UNAVAILABLE_MESSAGE]);
    expect(m.beginDirectEdit).not.toHaveBeenCalled();
    expect(m.write).not.toHaveBeenCalled();
    expect(unhandled).toEqual([]);
  });
});

describe('a grow-cut that fails anyway (the device is lost after the check)', () => {
  it('Region: no rejection escapes Cornerstone\'s un-awaited call, the edit is aborted, the user is told', async () => {
    setGpu(WORKING_GPU);
    const tool = new AppRegionSegmentTool();
    expect(await tool.preMouseDownCallback(evt())).toBe(true);
    setGpu(NULL_ADAPTER);
    (tool as unknown as { end(): void }).end();
    await drain();
    expect(unhandled).toEqual([]);
    expect(m.edit.abort).toHaveBeenCalledTimes(1);
    expect(m.edit.finish).not.toHaveBeenCalled();
    expect(m.write).not.toHaveBeenCalled();
    expect(toasts()).toHaveLength(1);
    expect((tool as unknown as { growCutData: unknown }).growCutData).toBeNull();
  });

  it('Region+: the click resolves, the edit is aborted, the user is told', async () => {
    const tool = new AppRegionSegmentPlusTool();
    setGpu(WORKING_GPU);
    const { probeGrowCutGpu } = await import('../growCutGpu');
    await probeGrowCutGpu();
    setGpu(NULL_ADAPTER);
    await expect(tool.preMouseDownCallback(evt())).resolves.toBe(true);
    await drain();
    expect(unhandled).toEqual([]);
    expect(m.edit.abort).toHaveBeenCalledTimes(1);
    expect(toasts()).toHaveLength(1);
  });
});

describe('with WebGPU', () => {
  it('Region+ runs and records its edit', async () => {
    setGpu(WORKING_GPU);
    const tool = new AppRegionSegmentPlusTool();
    expect(await tool.preMouseDownCallback(evt())).toBe(true);
    expect(m.write).toHaveBeenCalledTimes(1);
    expect(m.edit.finish).toHaveBeenCalledTimes(1);
    expect(m.edit.abort).not.toHaveBeenCalled();
    expect(toasts()).toEqual([]);
  });
});
