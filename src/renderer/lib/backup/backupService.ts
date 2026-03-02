/**
 * Backup Service — renderer-side abstraction for local file backup.
 *
 * Provides a strategy-pattern interface (`BackupBackend`) so that the
 * XNAT temp resource backend can be re-added in the future without
 * changing the calling code.
 *
 * The `backupService` singleton exposes high-level methods used by
 * segmentationService (auto-save), App.tsx (recovery), and
 * SegmentationPanel (cleanup).
 */
import type {
  BackupManifest,
  BackupManifestEntry,
  BackupSessionSummary,
} from '@shared/types/backup';
import { segmentationService } from '../cornerstone/segmentationService';
import { rtStructService } from '../cornerstone/rtStructService';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { useSegmentationManagerStore } from '../../stores/segmentationManagerStore';
import { useViewerStore } from '../../stores/viewerStore';

// ─── Backend Strategy Interface ─────────────────────────────────
// Implement this to add alternative backup backends (e.g. XNAT temp).

export interface BackupBackend {
  writeSegmentation(
    sessionId: string,
    segId: string,
    sourceScanId: string,
    format: 'SEG' | 'RTSTRUCT',
    base64: string,
  ): Promise<{ filename: string; sizeBytes: number }>;

  readSegmentation(sessionId: string, filename: string): Promise<string>;
  deleteSegmentation(sessionId: string, filename: string): Promise<void>;
  readManifest(sessionId: string): Promise<BackupManifest | null>;
  writeManifest(sessionId: string, manifest: BackupManifest): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  listAllSessions(): Promise<BackupSessionSummary[]>;
}

// ─── Local Filesystem Backend ───────────────────────────────────

class LocalFilesystemBackend implements BackupBackend {
  async writeSegmentation(
    sessionId: string,
    segId: string,
    sourceScanId: string,
    format: 'SEG' | 'RTSTRUCT',
    base64: string,
  ): Promise<{ filename: string; sizeBytes: number }> {
    const ts = formatTimestamp();
    const prefix = format === 'RTSTRUCT' ? 'rtstruct' : 'seg';
    // Sanitize segId for filename safety
    const safeSegId = segId.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 60);
    const filename = `${prefix}_${safeSegId}_${ts}.dcm`;

    const result = await window.electronAPI.backup.writeFile(sessionId, filename, base64);
    if (!result.ok) {
      throw new Error(`Backup write failed: ${result.error}`);
    }
    return { filename, sizeBytes: result.sizeBytes ?? 0 };
  }

  async readSegmentation(sessionId: string, filename: string): Promise<string> {
    const result = await window.electronAPI.backup.readFile(sessionId, filename);
    if (!result.ok || !result.data) {
      throw new Error(`Backup read failed: ${result.error}`);
    }
    return result.data;
  }

  async deleteSegmentation(sessionId: string, filename: string): Promise<void> {
    await window.electronAPI.backup.deleteFile(sessionId, filename);
  }

  async readManifest(sessionId: string): Promise<BackupManifest | null> {
    const result = await window.electronAPI.backup.readManifest(sessionId);
    if (!result.ok) {
      if (result.error === 'not_found') return null;
      throw new Error(`Manifest read failed: ${result.error}`);
    }
    return result.manifest ?? null;
  }

  async writeManifest(sessionId: string, manifest: BackupManifest): Promise<void> {
    const result = await window.electronAPI.backup.writeManifest(
      sessionId,
      JSON.stringify(manifest, null, 2),
    );
    if (!result.ok) {
      throw new Error(`Manifest write failed: ${result.error}`);
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    await window.electronAPI.backup.deleteSession(sessionId);
  }

  async listAllSessions(): Promise<BackupSessionSummary[]> {
    const result = await window.electronAPI.backup.listAllSessions();
    if (!result.ok) return [];
    return result.sessions ?? [];
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function formatTimestamp(): string {
  const d = new Date();
  return (
    d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0') +
    String(d.getHours()).padStart(2, '0') +
    String(d.getMinutes()).padStart(2, '0') +
    String(d.getSeconds()).padStart(2, '0')
  );
}

// ─── Public Backup Service ──────────────────────────────────────

const backend: BackupBackend = new LocalFilesystemBackend();

export const backupService = {
  /**
   * Back up ALL dirty segmentations to local cache.
   *
   * Iterates every segmentation marked dirty in segmentationManagerStore,
   * exports each to DICOM SEG or RTSTRUCT, writes to local backup, and
   * updates the manifest. Returns number of successfully backed-up segs.
   */
  async backupAllDirtySegmentations(
    sessionId: string,
    serverUrl: string,
  ): Promise<number> {
    const mgrStore = useSegmentationManagerStore.getState();
    const segStore = useSegmentationStore.getState();

    // Collect dirty segmentation IDs
    const dirtySegIds = Object.entries(mgrStore.dirtySegIds)
      .filter(([, dirty]) => dirty)
      .map(([segId]) => segId);

    if (dirtySegIds.length === 0) return 0;

    // Gather XNAT metadata for the manifest from viewer stores
    const viewerState = useViewerStore.getState();
    const xnatCtx = viewerState.xnatContext;
    const activePanel = viewerState.activeViewportId;
    const projectId = xnatCtx?.projectId ?? '';
    const subjectId = xnatCtx?.subjectId ?? '';
    const sessionLabel = xnatCtx?.sessionLabel ?? sessionId;
    const subjectLabel = activePanel
      ? (viewerState.panelSubjectLabelMap?.[activePanel] ?? '')
      : '';

    // Read existing manifest or create a new one
    let manifest: BackupManifest;
    try {
      manifest = (await backend.readManifest(sessionId)) ?? {
        version: 1,
        sessionId,
        serverUrl,
        lastUpdated: new Date().toISOString(),
        entries: [],
        projectId,
        subjectId,
        subjectLabel,
        sessionLabel,
      };
    } catch {
      manifest = {
        version: 1,
        sessionId,
        serverUrl,
        lastUpdated: new Date().toISOString(),
        entries: [],
        projectId,
        subjectId,
        subjectLabel,
        sessionLabel,
      };
    }

    // Always update metadata in case labels were resolved after manifest was first created
    if (projectId) manifest.projectId = projectId;
    if (subjectId) manifest.subjectId = subjectId;
    if (subjectLabel) manifest.subjectLabel = subjectLabel;
    if (sessionLabel && sessionLabel !== sessionId) manifest.sessionLabel = sessionLabel;

    let backed = 0;

    // Process each dirty seg sequentially (Cornerstone exports aren't thread-safe)
    for (const segId of dirtySegIds) {
      try {
        const dicomType = segmentationService.getPreferredDicomType(segId);
        if (!segmentationService.hasExportableContent(segId, dicomType)) {
          // No actual data to export — skip silently
          continue;
        }

        // Determine sourceScanId
        const origin = segStore.xnatOriginMap[segId];
        const xnatContext = useViewerStore.getState().xnatContext;
        const sourceScanId = origin?.sourceScanId ?? xnatContext?.scanId ?? 'unknown';

        // Export to base64
        let base64: string;
        if (dicomType === 'RTSTRUCT') {
          base64 = await rtStructService.exportToRtStruct(segId);
        } else {
          base64 = await segmentationService.exportToDicomSeg(segId);
        }

        // Remove old entries for this segId from manifest
        const oldEntries = manifest.entries.filter((e) => e.segmentationId === segId);
        manifest.entries = manifest.entries.filter((e) => e.segmentationId !== segId);

        // Write the backup file
        const { filename, sizeBytes } = await backend.writeSegmentation(
          sessionId,
          segId,
          sourceScanId,
          dicomType,
          base64,
        );

        // Delete old backup files for this segId
        for (const old of oldEntries) {
          try {
            await backend.deleteSegmentation(sessionId, old.filename);
          } catch { /* ignore */ }
        }

        // Add new manifest entry
        manifest.entries.push({
          segmentationId: segId,
          filename,
          format: dicomType,
          sourceScanId,
          timestamp: new Date().toISOString(),
          sizeBytes,
        });

        // Clear dirty flag for this specific segmentation
        mgrStore.clearDirty(segId);
        backed++;

        console.log(
          `[backupService] Backed up ${dicomType} for ${segId} → ${filename} (${sizeBytes} bytes)`,
        );
      } catch (err: any) {
        const msg = err instanceof Error ? err.message : String(err);
        // "No painted segment data" is not an error — user hasn't painted yet
        if (
          msg.includes('No painted segment data') ||
          msg.includes('no segment-frame pairs') ||
          msg.includes('Error inserting pixels in PixelData')
        ) {
          console.log(`[backupService] Skipped ${segId} — no painted pixels yet`);
          continue;
        }
        console.error(`[backupService] Failed to back up ${segId}:`, err);
      }
    }

    // Write updated manifest
    if (backed > 0) {
      manifest.lastUpdated = new Date().toISOString();
      try {
        await backend.writeManifest(sessionId, manifest);
      } catch (err) {
        console.error('[backupService] Failed to write manifest:', err);
      }

      // If all dirty segs are now clean, update the global flag
      if (!mgrStore.hasDirtySegmentations()) {
        useSegmentationStore.getState()._markClean();
      }
    }

    return backed;
  },

  /** Read the backup manifest for a specific XNAT session. */
  async getManifestForSession(sessionId: string): Promise<BackupManifest | null> {
    return backend.readManifest(sessionId);
  },

  /** Read a backed-up segmentation file (returns base64). */
  async readSegmentation(sessionId: string, filename: string): Promise<string> {
    return backend.readSegmentation(sessionId, filename);
  },

  /** Delete a specific backup entry and update the manifest. */
  async deleteBackupEntry(sessionId: string, filename: string): Promise<void> {
    try {
      await backend.deleteSegmentation(sessionId, filename);
    } catch { /* ignore if already gone */ }

    // Update manifest
    try {
      const manifest = await backend.readManifest(sessionId);
      if (manifest) {
        manifest.entries = manifest.entries.filter((e) => e.filename !== filename);
        manifest.lastUpdated = new Date().toISOString();
        if (manifest.entries.length === 0) {
          // No entries left — delete the entire session directory
          await backend.deleteSession(sessionId);
        } else {
          await backend.writeManifest(sessionId, manifest);
        }
      }
    } catch { /* ignore manifest update errors */ }
  },

  /** Delete all entries for a specific segmentationId and update the manifest. */
  async deleteEntriesForSegmentation(sessionId: string, segmentationId: string): Promise<void> {
    try {
      const manifest = await backend.readManifest(sessionId);
      if (!manifest) return;

      const toDelete = manifest.entries.filter((e) => e.segmentationId === segmentationId);
      for (const entry of toDelete) {
        try {
          await backend.deleteSegmentation(sessionId, entry.filename);
        } catch { /* ignore */ }
      }

      manifest.entries = manifest.entries.filter((e) => e.segmentationId !== segmentationId);
      manifest.lastUpdated = new Date().toISOString();
      if (manifest.entries.length === 0) {
        await backend.deleteSession(sessionId);
      } else {
        await backend.writeManifest(sessionId, manifest);
      }
    } catch { /* ignore cleanup errors */ }
  },

  /** Delete the entire backup directory for a session. */
  async deleteSessionBackups(sessionId: string): Promise<void> {
    return backend.deleteSession(sessionId);
  },

  /** List all backup sessions with summaries (for the settings UI). */
  async listAllBackups(): Promise<BackupSessionSummary[]> {
    return backend.listAllSessions();
  },
};
