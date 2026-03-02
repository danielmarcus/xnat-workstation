/**
 * ConnectionStatus — compact header bar indicator showing connection
 * state with a disconnect button.
 *
 * Displays: green dot + server URL + username + Disconnect button
 */
import { useState } from 'react';
import { useConnectionStore } from '../../stores/connectionStore';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { segmentationManager } from '../../lib/segmentation/segmentationManagerSingleton';
import { segmentationService } from '../../lib/cornerstone/segmentationService';
import { showConfirmDialog } from '../../stores/dialogStore';
import { IconDisconnect } from '../icons';

export default function ConnectionStatus() {
  const connection = useConnectionStore((s) => s.connection);
  const logout = useConnectionStore((s) => s.logout);
  const [disconnecting, setDisconnecting] = useState(false);

  if (!connection) return null;

  // Show just the hostname from the server URL
  let displayUrl = connection.serverUrl;
  try {
    displayUrl = new URL(connection.serverUrl).hostname;
  } catch {
    // Keep full URL if parsing fails
  }

  async function handleDisconnect() {
    if (disconnecting) return;

    const hasUnsaved =
      useSegmentationStore.getState().hasUnsavedChanges ||
      segmentationManager.hasDirtySegmentations();

    if (hasUnsaved) {
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
        if (!saved) {
          const discardAfterFailed = await showConfirmDialog({
            title: 'Draft Save Failed',
            message: 'Could not save a draft. Disconnect anyway and discard unsaved changes?',
            confirmLabel: 'Disconnect',
            cancelLabel: 'Stay Connected',
            tone: 'danger',
          });
          if (!discardAfterFailed) return;
        }
      } else {
        const discard = await showConfirmDialog({
          title: 'Discard Unsaved Annotations',
          message: 'Disconnect and discard unsaved annotations?',
          confirmLabel: 'Disconnect',
          cancelLabel: 'Cancel',
          tone: 'danger',
        });
        if (!discard) return;
      }
    }

    setDisconnecting(true);
    try {
      await logout();
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      {/* Green status dot */}
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-40" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
      </span>

      {/* Server + user info */}
      <span className="text-zinc-400 truncate max-w-[200px]" title={connection.serverUrl}>
        {displayUrl}
      </span>
      <span className="text-zinc-600">/</span>
      <span className="text-zinc-300 font-medium">{connection.username}</span>

      {/* Disconnect button */}
      <button
        onClick={() => { void handleDisconnect(); }}
        disabled={disconnecting}
        className="flex items-center gap-1 text-zinc-500 hover:text-red-400 transition-colors ml-0.5 p-1 rounded hover:bg-zinc-800"
        title="Disconnect from XNAT"
      >
        <IconDisconnect className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
