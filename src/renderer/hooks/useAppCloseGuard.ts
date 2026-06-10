/**
 * useAppCloseGuard (Change 1b) — the renderer half of the save-first-on-close
 * flow. The main process intercepts the window close and asks via
 * electronAPI.app.onCloseRequested; this hook answers:
 *   - no unsaved annotations → reply 'proceed' immediately (quit).
 *   - unsaved annotations    → open a Save / Quit-without-saving / Cancel dialog
 *     and reply based on the user's choice.
 *
 * "Save" flushes every dirty container through the injected transport
 * (segmentationService.flushContainerSave) before replying 'proceed' — manual
 * save always works regardless of the autosave opt-in. The local-fs backup
 * remains the safety net if a server save fails.
 */
import { useEffect, useState } from 'react';
import { useSegmentationStore } from '../stores/segmentationStore';
import { useSegmentationManagerStore } from '../stores/segmentationManagerStore';
import { segmentationService } from '../lib/cornerstone/segmentationService';
import { segmentationManager } from '../lib/segmentation/segmentationManagerSingleton';

function dirtyContainerIds(): string[] {
  const { dirtySegIds } = useSegmentationManagerStore.getState();
  return Object.keys(dirtySegIds).filter((id) => dirtySegIds[id]);
}

function hasUnsavedAnnotations(): boolean {
  const segStore = useSegmentationStore.getState();
  return segStore.segmentations.length > 0 && segmentationManager.hasDirtySegmentations();
}

export interface AppCloseGuard {
  /** Whether the close confirmation dialog is open. */
  promptOpen: boolean;
  /** Number of unsaved containers (shown in the dialog). */
  unsavedCount: number;
  /** Save every unsaved container, then quit. */
  onSaveAndQuit: () => void;
  /** Quit without saving (local backup still protects the work). */
  onQuitWithoutSaving: () => void;
  /** Cancel the quit and return to the session. */
  onCancel: () => void;
}

export function useAppCloseGuard(): AppCloseGuard {
  const [promptOpen, setPromptOpen] = useState(false);
  const [unsavedCount, setUnsavedCount] = useState(0);

  useEffect(() => {
    const api = window.electronAPI?.app;
    if (!api) return;
    const unsubscribe = api.onCloseRequested(() => {
      if (!hasUnsavedAnnotations()) {
        api.sendCloseDecision('proceed');
        return;
      }
      setUnsavedCount(dirtyContainerIds().length);
      setPromptOpen(true);
    });
    return unsubscribe;
  }, []);

  const reply = (decision: 'proceed' | 'cancel') => {
    setPromptOpen(false);
    window.electronAPI?.app?.sendCloseDecision(decision);
  };

  return {
    promptOpen,
    unsavedCount,
    onSaveAndQuit: () => {
      void (async () => {
        await Promise.all(dirtyContainerIds().map((id) => segmentationService.flushContainerSave(id)));
        reply('proceed');
      })();
    },
    onQuitWithoutSaving: () => reply('proceed'),
    onCancel: () => reply('cancel'),
  };
}
