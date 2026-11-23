/**
 * Before signing out (Disconnect, or a link that switches servers): with unsaved annotations,
 * offer to save a draft or discard them. False when the user chose to stay connected.
 */
import { useSegmentationStore } from '../stores/segmentationStore';
import { segmentationManager } from '../lib/segmentation/segmentationManagerSingleton';
import { segmentationService } from '../lib/cornerstone/segmentationService';
import { showConfirmDialog } from '../stores/dialogStore';

export async function confirmDisconnect(): Promise<boolean> {
  const hasUnsaved =
    useSegmentationStore.getState().hasUnsavedChanges ||
    segmentationManager.hasDirtySegmentations();
  if (!hasUnsaved) return true;

  const saveDraft = await showConfirmDialog({
    title: 'Unsaved Annotations',
    message:
      'You have unsaved annotations.\n\n' +
      'Press Save Draft to keep a recoverable copy before disconnecting.\n' +
      'Press Discard to choose whether to drop changes.',
    confirmLabel: 'Save Draft',
    cancelLabel: 'Discard',
  });

  if (saveDraft) {
    const saved = await segmentationService.flushAutoSaveNow();
    if (saved) return true;
    return showConfirmDialog({
      title: 'Draft Save Failed',
      message: 'Could not save a draft. Disconnect anyway and discard unsaved changes?',
      confirmLabel: 'Disconnect',
      cancelLabel: 'Stay Connected',
      tone: 'danger',
    });
  }

  return showConfirmDialog({
    title: 'Discard Unsaved Annotations',
    message: 'Disconnect and discard unsaved annotations?',
    confirmLabel: 'Disconnect',
    cancelLabel: 'Cancel',
    tone: 'danger',
  });
}
