/**
 * Checkpoints for the Annotations panel (SegWorks parity D8): list (refreshed when a
 * container menu opens), save (named or baseline), restore (one undo step), delete.
 * Failures surface as a toast (a user-initiated action that failed); success is silent —
 * the restored mask is the confirmation.
 */
import { deleteCheckpoint, listCheckpoints, restoreCheckpoint, saveCheckpoint, type CheckpointResult } from '../lib/cornerstone/checkpointService';
import { showToast } from '../stores/toastStore';
import { useCheckpointStore } from '../stores/checkpointStore';

function failure(r: Extract<CheckpointResult, { ok: false }>): string {
  switch (r.reason) {
    case 'locked': return 'A segment is locked — nothing was restored';
    case 'other-series': return 'That checkpoint belongs to a different series';
    case 'other-grid': return 'That checkpoint does not match this segmentation’s grid';
    case 'no-identity': return 'Checkpoints need the segmentation’s scan to be open';
    case 'no-labelmap': return 'This segmentation has nothing to checkpoint yet';
    case 'not-found': return 'That checkpoint could not be read';
    default: return 'The checkpoint could not be saved';
  }
}

export function useCheckpoints() {
  const lists = useCheckpointStore((s) => s.lists);
  const savingFor = useCheckpointStore((s) => s.savingFor);
  const setList = useCheckpointStore((s) => s.setList);
  const setSavingFor = useCheckpointStore((s) => s.setSavingFor);

  const refresh = async (containerId: string) => setList(containerId, await listCheckpoints(containerId));

  return {
    listOf: (containerId: string) => lists[containerId] ?? [],
    refresh: (containerId: string) => { void refresh(containerId); },
    savingFor,
    openSave: (containerId: string) => setSavingFor(containerId),
    cancelSave: () => setSavingFor(null),
    save: async (containerId: string, name: string, baseline: boolean) => {
      setSavingFor(null);
      const r = await saveCheckpoint(containerId, name, baseline ? 'baseline' : 'named');
      if (!r.ok) showToast(failure(r), 'error');
      await refresh(containerId);
    },
    restore: async (containerId: string, checkpointId: string) => {
      const r = await restoreCheckpoint(containerId, checkpointId);
      if (!r.ok) showToast(failure(r), r.reason === 'locked' ? 'warning' : 'error');
      else if (r.untouchedMembers) showToast(`${r.untouchedMembers} segment(s) added since the checkpoint were left as they are`, 'warning');
    },
    remove: async (containerId: string, checkpointId: string) => {
      await deleteCheckpoint(containerId, checkpointId);
      await refresh(containerId);
    },
  };
}
