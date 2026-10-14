/**
 * Checkpoint identity (#102): the key does not depend on which session was loaded last,
 * a listing names the container's series + label so pre-#102 checkpoints are adopted, and
 * renaming a container moves its checkpoints instead of orphaning them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SERIES = '1.2.840.113619.2.1';
vi.mock('@cornerstonejs/core', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  metaData: { get: (type: string) => (type === 'generalSeriesModule' ? { seriesInstanceUID: SERIES } : undefined) },
}));
vi.mock('../sourceImageTracking', () => ({ getSourceImageIds: () => ['wadouri:img1'] }));
vi.mock('../segmentVoxelGrid', () => ({ readSegmentVoxelGrid: () => null }));
vi.mock('../labelmapTransaction', () => ({ beginTransaction: () => ({ ok: false, reason: 'no-labelmap' }) }));

import { checkpointIdentity, followCheckpointRename, listCheckpoints } from '../checkpointService';
import { useSegmentationStore, type SegmentationSummary } from '../../../stores/segmentationStore';
import { useViewerStore } from '../../../stores/viewerStore';

const meta = { id: 'a', name: 'kept', kind: 'named', createdAt: '2026-10-01T00:00:00.000Z', seriesInstanceUID: SERIES, containerLabel: 'Liver', dims: [1, 1, 1], memberCount: 1 };
const api = {
  list: vi.fn(async () => ({ ok: true, checkpoints: [meta] })),
  move: vi.fn(async () => ({ ok: true })),
};

function setLabel(label: string) {
  const seg: SegmentationSummary = { segmentationId: 'seg-1', label, segments: [], isActive: true };
  useSegmentationStore.setState({ segmentations: [seg] });
}

beforeEach(() => {
  (globalThis as unknown as { window: unknown }).window = { electronAPI: { checkpoint: api } };
  api.list.mockClear();
  api.move.mockClear();
  setLabel('Liver');
});
afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe('checkpointIdentity', () => {
  it('does not depend on the last-loaded session', () => {
    useViewerStore.setState({ sessionId: 'XNAT_E00001' });
    const first = checkpointIdentity('seg-1')!.key;
    useViewerStore.setState({ sessionId: 'XNAT_E00002' });
    expect(checkpointIdentity('seg-1')!.key).toBe(first);
    expect(first).not.toContain('XNAT_E0000');
  });

  it('a listing names the series + label, so checkpoints filed under the old key are found', async () => {
    await listCheckpoints('seg-1');
    expect(api.list).toHaveBeenCalledWith(checkpointIdentity('seg-1')!.key, { seriesInstanceUID: SERIES, containerLabel: 'Liver' });
  });
});

describe('followCheckpointRename', () => {
  it('moves the checkpoints of a container that has some to its new key', async () => {
    await listCheckpoints('seg-1');
    const before = checkpointIdentity('seg-1');
    setLabel('Liver lobe');
    await followCheckpointRename('seg-1', before);
    expect(api.move).toHaveBeenCalledWith(before!.key, checkpointIdentity('seg-1')!.key, 'Liver lobe');
  });

  it('naming a brand-new container does not take another container’s checkpoints', async () => {
    useSegmentationStore.setState({ segmentations: [{ segmentationId: 'seg-new', label: 'Segmentation 1', segments: [], isActive: true }] });
    const before = checkpointIdentity('seg-new');
    useSegmentationStore.setState({ segmentations: [{ segmentationId: 'seg-new', label: 'Tumor', segments: [], isActive: true }] });
    await followCheckpointRename('seg-new', before);
    expect(api.move).not.toHaveBeenCalled();
  });
});
