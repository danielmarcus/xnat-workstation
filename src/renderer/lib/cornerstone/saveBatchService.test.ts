/**
 * saveBatchService unit tests — spec §4.4.4 / §4.4.5 Save All batch.
 *
 * Uses a synthetic SaveAdapter (the DI seam) to drive the executor
 * deterministically, mirroring MV-Phase 2.8's adapter pattern.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getContainerMock = vi.hoisted(() => vi.fn());

vi.mock('./containerBridge', () => ({
  containerBridge: {
    getContainer: getContainerMock,
  },
}));

vi.mock('./containerActions', () => ({
  // Never called when a test adapter is wired; the default adapter
  // would otherwise pull this in.
  uploadContainerToXnat: vi.fn(),
}));

import {
  executeSaveAllBatch,
  resetSaveBatchSaver,
  wireSaveBatchSaver,
  type SaveAdapter,
  type SaveAllDecision,
  type SaveBatchProgress,
} from './saveBatchService';

beforeEach(() => {
  getContainerMock.mockReset();
  getContainerMock.mockImplementation((id: string) => ({
    id,
    name: `Container ${id}`,
    members: [],
  }));
});

afterEach(() => {
  resetSaveBatchSaver();
});

describe('executeSaveAllBatch', () => {
  it('returns an empty result for an empty decision list', async () => {
    const adapter: SaveAdapter = vi.fn();
    wireSaveBatchSaver(adapter);
    const result = await executeSaveAllBatch([]);
    expect(result).toEqual({ saved: [], failures: [], skipped: [] });
    expect(adapter).not.toHaveBeenCalled();
  });

  it('calls the adapter once per non-skipped decision, in input order', async () => {
    const seenOrder: string[] = [];
    const adapter: SaveAdapter = async (id) => {
      seenOrder.push(id);
      return 'saved';
    };
    wireSaveBatchSaver(adapter);
    const decisions: SaveAllDecision[] = [
      { containerId: 'a', action: 'overwrite' },
      { containerId: 'b', action: 'copy', copyName: 'B copy' },
      { containerId: 'c', action: 'new' },
    ];
    const result = await executeSaveAllBatch(decisions);
    expect(seenOrder).toEqual(['a', 'b', 'c']);
    expect(result.saved).toEqual(['a', 'b', 'c']);
    expect(result.failures).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it('respects skip decisions — adapter not called, ids land in `skipped`', async () => {
    const adapter: SaveAdapter = vi.fn().mockResolvedValue('saved');
    wireSaveBatchSaver(adapter);
    const decisions: SaveAllDecision[] = [
      { containerId: 'a', action: 'overwrite' },
      { containerId: 'b', action: 'skip' },
      { containerId: 'c', action: 'new' },
    ];
    const result = await executeSaveAllBatch(decisions);
    expect(adapter).toHaveBeenCalledTimes(2);
    expect(adapter).toHaveBeenCalledWith('a', expect.objectContaining({ containerId: 'a' }));
    expect(adapter).toHaveBeenCalledWith('c', expect.objectContaining({ containerId: 'c' }));
    expect(result.saved).toEqual(['a', 'c']);
    expect(result.skipped).toEqual(['b']);
  });

  it('passes the decision through to the adapter so it can read copyName etc.', async () => {
    const adapter: SaveAdapter = vi.fn().mockResolvedValue('saved');
    wireSaveBatchSaver(adapter);
    await executeSaveAllBatch([
      { containerId: 'a', action: 'copy', copyName: 'A (copy)' },
    ]);
    expect(adapter).toHaveBeenCalledWith('a', {
      containerId: 'a',
      action: 'copy',
      copyName: 'A (copy)',
    });
  });

  it('onProgress fires once per non-skipped decision with current/total/name/action', async () => {
    const adapter: SaveAdapter = async () => 'saved';
    wireSaveBatchSaver(adapter);
    getContainerMock.mockImplementation((id: string) => ({
      id,
      name: id === 'a' ? 'Alpha' : id === 'c' ? 'Gamma' : `c-${id}`,
      members: [],
    }));
    const progress: SaveBatchProgress[] = [];
    await executeSaveAllBatch(
      [
        { containerId: 'a', action: 'overwrite' },
        { containerId: 'b', action: 'skip' },
        { containerId: 'c', action: 'new' },
      ],
      { onProgress: (p) => progress.push(p) },
    );
    expect(progress).toEqual([
      { current: 1, total: 2, currentName: 'Alpha', action: 'overwrite' },
      { current: 2, total: 2, currentName: 'Gamma', action: 'new' },
    ]);
  });

  it("'failed' adapter outcome becomes a SaveBatchFailure with a generic message", async () => {
    const adapter: SaveAdapter = async (id) => (id === 'b' ? 'failed' : 'saved');
    wireSaveBatchSaver(adapter);
    const result = await executeSaveAllBatch([
      { containerId: 'a', action: 'overwrite' },
      { containerId: 'b', action: 'overwrite' },
      { containerId: 'c', action: 'new' },
    ]);
    expect(result.saved).toEqual(['a', 'c']);
    expect(result.failures).toEqual([
      { containerId: 'b', containerName: 'Container b', errorMessage: 'Upload failed' },
    ]);
  });

  it('thrown errors become SaveBatchFailure entries; batch keeps going', async () => {
    const adapter: SaveAdapter = async (id) => {
      if (id === 'b') throw new Error('502 Bad Gateway');
      return 'saved';
    };
    wireSaveBatchSaver(adapter);
    const result = await executeSaveAllBatch([
      { containerId: 'a', action: 'overwrite' },
      { containerId: 'b', action: 'overwrite' },
      { containerId: 'c', action: 'new' },
    ]);
    expect(result.saved).toEqual(['a', 'c']);
    expect(result.failures[0].errorMessage).toBe('502 Bad Gateway');
    expect(result.failures[0].containerId).toBe('b');
  });

  it('falls back to the containerId when the bridge has no container record', async () => {
    getContainerMock.mockReturnValue(null);
    const adapter: SaveAdapter = async () => 'saved';
    wireSaveBatchSaver(adapter);
    const progress: SaveBatchProgress[] = [];
    await executeSaveAllBatch(
      [{ containerId: 'orphan', action: 'overwrite' }],
      { onProgress: (p) => progress.push(p) },
    );
    expect(progress[0].currentName).toBe('orphan');
  });
});
