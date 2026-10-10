/**
 * Checkpoint files for Settings › File Backup (SegWorks parity D8, #266–267): export a
 * checkpoint of the active Segmentation to a file, or import one made from the same scan.
 */
import { useEffect, useState } from 'react';
import { exportCheckpointFile, importCheckpointFile } from '../lib/cornerstone/checkpointService';
import { useCheckpoints } from './useCheckpoints';
import { useSegmentationStore } from '../stores/segmentationStore';

export function useCheckpointFiles() {
  const containerId = useSegmentationStore((s) => s.activeSegmentationId);
  const segmentations = useSegmentationStore((s) => s.segmentations);
  const label = segmentations.find((s) => s.segmentationId === containerId)?.label ?? null;
  const checkpoints = useCheckpoints();
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (containerId) checkpoints.refresh(containerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerId]);

  return {
    label,
    list: containerId ? checkpoints.listOf(containerId) : [],
    status,
    exportOne: async (checkpointId: string) => {
      if (!containerId) return;
      const r = await exportCheckpointFile(containerId, checkpointId);
      setStatus(r.ok ? `Saved to ${r.path}` : r.canceled ? null : `Export failed: ${r.error ?? 'unknown error'}`);
    },
    importOne: async () => {
      if (!containerId) return;
      const r = await importCheckpointFile(containerId);
      if (r.ok) {
        setStatus(`Imported “${r.name}” — restore it from the segmentation’s menu`);
        checkpoints.refresh(containerId);
      } else if (!r.canceled) {
        setStatus(
          r.reason === 'other-series' ? 'That checkpoint was made from a different series — not imported'
            : r.reason === 'other-grid' ? 'That checkpoint does not match this segmentation’s grid — not imported'
            : r.reason === 'invalid' ? `Not a Workstation checkpoint file${r.detail ? ` (${r.detail})` : ''}`
            : 'Import failed',
        );
      }
    },
  };
}
