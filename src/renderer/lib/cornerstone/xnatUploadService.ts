/**
 * XNAT Upload Service — single entry point for "Upload to XNAT"
 * triggered from any list-panel surface.
 *
 * Lifted out of `SegmentationPanel` in Phase 6 / Stage 2B.2 so the
 * upload flow is callable from the new ContainerListPanel ⋯ menu
 * (and any future list surface) without dragging React-local toast
 * / dialog state along. Every UI concern is injected via DI:
 *
 *   - `promptExisting` decides overwrite-vs-create-new when the
 *     segmentation already has an XNAT scan id.
 *   - `notify` posts a status message ("saved", "failed", ...).
 *   - `getSessionScans` / `setSessionData` refresh the session-scan
 *     list after a successful upload so the new scan appears in
 *     subsequent browse / association calls.
 *
 * The service does not call into React directly. Callers wire the
 * UI surface they own.
 */
import { useSegmentationStore } from '../../stores/segmentationStore';
import { useSegmentationManagerStore } from '../../stores/segmentationManagerStore';
import { isScanIdCompatibleWithType, nextVersionedLabel } from '../../components/viewer/segmentationPanelUtils';
import { validateBase64ForUpload, DicomValidationError } from './dicomValidation';
import type { SegmentationDicomType } from '@shared/types/segmentation';
import type { XnatScan, XnatUploadContext } from '@shared/types/xnat';

export type UploadOutcome = 'saved' | 'cancelled' | 'failed';

export type ExistingSavePromptResult =
  | { action: 'cancel' }
  | { action: 'overwrite' }
  | { action: 'create-new'; label: string };

export interface UploadDeps {
  /**
   * Resolve the active XNAT context for the panel originating the
   * upload. Returns null when no XNAT session is loaded — the upload
   * fails fast with an actionable error.
   */
  getPanelXnatContext: () => XnatUploadContext | null;
  /**
   * Resolve the source-scan ID for the panel originating the upload.
   * Used to track xnatOrigin so subsequent saves target the same scan.
   */
  getSourceScanId: () => string | null;
  /**
   * Export the segmentation as DICOM SEG / RTSTRUCT base64. Returns
   * the encoded payload or throws.
   */
  exportToBase64: (segmentationId: string, dicomType: SegmentationDicomType) => Promise<string>;
  /**
   * Open a UI prompt for the overwrite-vs-create-new decision when the
   * segmentation already has an XNAT scan id. Returns the user's
   * choice (or cancel).
   */
  promptExisting: (
    scanId: string,
    dicomType: SegmentationDicomType,
    suggestedLabel: string,
  ) => Promise<ExistingSavePromptResult>;
  /**
   * Surface a message to the user. The kind is informational; callers
   * map to whatever surface they own (toast, inline status, etc.).
   */
  notify: (message: string, kind: 'success' | 'error' | 'info') => void;
}

const NOOP_DEPS: UploadDeps = {
  getPanelXnatContext: () => null,
  getSourceScanId: () => null,
  exportToBase64: () => Promise.reject(new Error('[xnatUploadService] exportToBase64 not wired')),
  promptExisting: () => Promise.resolve({ action: 'cancel' }),
  notify: () => undefined,
};

let deps: UploadDeps = NOOP_DEPS;

/** Inject the runtime deps. Called once at segmentationService.initialize(). */
export function wireXnatUpload(injected: Partial<UploadDeps>): void {
  deps = { ...NOOP_DEPS, ...injected };
}

export function resetXnatUploadWiring(): void {
  deps = NOOP_DEPS;
}

/**
 * Suggest the next versioned label for a new XNAT scan, stepping
 * past any existing labels in the session. Pure given a scan list.
 */
function suggestNextLabel(scans: XnatScan[], baseLabel: string): string {
  const existing = new Set(
    scans
      .map((s) => s.seriesDescription?.trim().toLowerCase())
      .filter((label): label is string => !!label),
  );
  let candidate = nextVersionedLabel(baseLabel);
  let guard = 0;
  while (existing.has(candidate.toLowerCase()) && guard < 1000) {
    candidate = nextVersionedLabel(candidate);
    guard++;
  }
  return candidate;
}

/**
 * Upload a segmentation to XNAT. Returns the outcome so the caller
 * can sequence next steps (e.g. close menus, advance state).
 *
 * Decision tree:
 *   1. Resolve panel context and source scan; bail with actionable
 *      error when missing.
 *   2. Block if the segmentation has no exportable content.
 *   3. If the seg has an existing compatible XNAT scan id, prompt
 *      the user (overwrite vs. create-new vs. cancel).
 *   4. Export base64; choose the right electronAPI route
 *      (overwrite vs. first-time upload, SEG vs. RTSTRUCT).
 *   5. Update xnatOrigin / dicomType / manager store on success.
 *   6. Refresh session scans + UID associations so the new scan
 *      appears immediately in browse state.
 *   7. Clean up local backup entries + legacy XNAT temp files.
 */
export async function uploadSegmentationToXnat(
  segmentationId: string,
  dicomType: SegmentationDicomType,
): Promise<UploadOutcome> {
  // Lazy import to break the circular dep with segmentationService
  // (which imports this module to wire it). The runtime function
  // call is one of segmentationService.hasExportableContent or its
  // brethren — they don't trigger module init at import time.
  const { segmentationService } = await import('./segmentationService');
  const { segmentationManager } = await import('../segmentation/segmentationManagerSingleton');

  const panelCtx = deps.getPanelXnatContext();
  if (!panelCtx) {
    deps.notify('No XNAT session context — load images from XNAT first', 'error');
    return 'failed';
  }

  if (!segmentationService.hasExportableContent(segmentationId, dicomType)) {
    deps.notify(
      dicomType === 'RTSTRUCT'
        ? 'Add at least one structure contour before upload.'
        : 'Add at least one painted segment before upload.',
      'error',
    );
    return 'failed';
  }

  segmentationManager.beginManualSave();
  try {
    const segStoreSnapshot = useSegmentationStore.getState();
    const origin = segStoreSnapshot.xnatOriginMap[segmentationId];
    const segLabel = segStoreSnapshot.segmentations.find(
      (s) => s.segmentationId === segmentationId,
    )?.label?.trim() || (dicomType === 'RTSTRUCT' ? 'Structure' : 'Segmentation');
    const sourceScanId = origin?.sourceScanId ?? deps.getSourceScanId() ?? panelCtx.scanId;

    const canOverwriteSeg =
      dicomType === 'SEG'
      && !!origin?.scanId
      && isScanIdCompatibleWithType(origin.scanId, 'SEG');
    const canOverwriteRtStruct =
      dicomType === 'RTSTRUCT'
      && !!origin?.scanId
      && isScanIdCompatibleWithType(origin.scanId, 'RTSTRUCT');
    const canOverwriteExisting = canOverwriteSeg || canOverwriteRtStruct;

    let uploadLabel = segLabel;
    let createNewScan = false;
    if (canOverwriteExisting && origin?.scanId) {
      const scans = await window.electronAPI.xnat.getScans(panelCtx.sessionId);
      const suggested = suggestNextLabel(scans, segLabel);
      const decision = await deps.promptExisting(origin.scanId, dicomType, suggested);
      if (decision.action === 'cancel') return 'cancelled';
      if (decision.action === 'create-new') {
        uploadLabel = decision.label.trim() || suggested;
        createNewScan = true;
      }
    }

    const base64 = await deps.exportToBase64(segmentationId, dicomType);

    // Pre-upload IOD validation (MV-Phase 7.1, spec §13.3; CLAUDE.md
    // §"DICOM Compliance"). Blocks the upload with the exact missing-tag
    // list rather than letting XNAT reject (or silently accept) a
    // non-conformant object.
    try {
      await validateBase64ForUpload(base64);
    } catch (validationErr) {
      if (validationErr instanceof DicomValidationError) {
        deps.notify(
          `Upload blocked — ${validationErr.message}. `
          + 'The exported file does not meet the DICOM standard for its type; this is an application bug worth reporting.',
          'error',
        );
        console.error('[xnatUploadService] pre-upload validation failed:', validationErr);
        return 'failed';
      }
      // Parse-level failure (corrupt buffer, not a DICOM file). Same block,
      // different message.
      const msg = validationErr instanceof Error ? validationErr.message : String(validationErr);
      deps.notify(`Upload blocked — exported file failed DICOM validation: ${msg}`, 'error');
      console.error('[xnatUploadService] pre-upload parse failed:', validationErr);
      return 'failed';
    }

    let result: { ok: boolean; url?: string; scanId?: string; error?: string };
    if (canOverwriteSeg && origin?.scanId && !createNewScan) {
      result = await window.electronAPI.xnat.overwriteDicomSeg(
        panelCtx.sessionId,
        origin.scanId,
        base64,
        uploadLabel,
      );
    } else if (canOverwriteRtStruct && origin?.scanId && !createNewScan) {
      result = await window.electronAPI.xnat.overwriteDicomRtStruct(
        panelCtx.sessionId,
        origin.scanId,
        base64,
        uploadLabel,
      );
    } else if (dicomType === 'SEG') {
      result = await window.electronAPI.xnat.uploadDicomSeg(
        panelCtx.projectId,
        panelCtx.subjectId,
        panelCtx.sessionId,
        panelCtx.sessionLabel,
        sourceScanId,
        base64,
        uploadLabel,
      );
    } else {
      result = await window.electronAPI.xnat.uploadDicomRtStruct(
        panelCtx.projectId,
        panelCtx.subjectId,
        panelCtx.sessionId,
        panelCtx.sessionLabel,
        sourceScanId,
        base64,
        uploadLabel,
      );
    }

    if (!result.ok) {
      deps.notify(`Upload failed: ${result.error}`, 'error');
      return 'failed';
    }

    if (result.scanId) {
      const isCreateNewFromExisting = createNewScan && canOverwriteExisting;
      if (!isCreateNewFromExisting) {
        useSegmentationStore.getState().setXnatOrigin(segmentationId, {
          scanId: result.scanId,
          sourceScanId,
          projectId: panelCtx.projectId,
          sessionId: panelCtx.sessionId,
        });
        useSegmentationStore.getState().setDicomType(segmentationId, dicomType);
        if (sourceScanId) {
          const compositeKey = `${panelCtx.projectId}/${panelCtx.sessionId}/${sourceScanId}`;
          const mgr = useSegmentationManagerStore.getState();
          mgr.recordLoaded(compositeKey, result.scanId, {
            segmentationId,
            loadedAt: Date.now(),
          });
          mgr.setLoadStatus(result.scanId, 'loaded');
        }
      }

      // Refresh session scans + UID associations so the new annotation scan
      // appears immediately in the annotation browser state.
      try {
        const refreshedScans = await window.electronAPI.xnat.getScans(panelCtx.sessionId);
        // Dynamic imports: useSessionDerivedIndexStore (transitively
        // imports @cornerstonejs/dicom-image-loader/wadouri) and
        // dicomwebLoader both fail to parse in JSDOM. Keep them out of
        // the static graph so unit tests don't have to mock the entire
        // Cornerstone web-worker stack.
        const [{ useSessionDerivedIndexStore }, { dicomwebLoader }] = await Promise.all([
          import('../../stores/sessionDerivedIndexStore'),
          import('./dicomwebLoader'),
        ]);
        const idxStore = useSessionDerivedIndexStore.getState();
        idxStore.buildDerivedIndex(refreshedScans);
        void idxStore.resolveAssociationsForSession(
          panelCtx.sessionId,
          refreshedScans,
          (sessionId, scanId) => dicomwebLoader.getScanImageIds(sessionId, scanId),
          async (sessionId, scanId) => {
            const dl = await window.electronAPI.xnat.downloadScanFile(sessionId, scanId);
            if (!dl.ok || !dl.data) {
              throw new Error(dl.error || 'Failed to download scan file');
            }
            const binary = atob(dl.data);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            return bytes.buffer;
          },
        ).catch((err) => {
          console.warn('[xnatUploadService] Post-upload UID refresh failed:', err);
        });
      } catch (err) {
        console.warn('[xnatUploadService] Failed to refresh scans after upload:', err);
      }

      deps.notify(
        isCreateNewFromExisting
          ? `Created new ${dicomType} scan ${result.scanId}`
          : `Uploaded ${dicomType} as scan ${result.scanId}`,
        'success',
      );
    } else if ((canOverwriteSeg || canOverwriteRtStruct) && origin?.scanId) {
      deps.notify(`Saved ${dicomType} to scan ${origin.scanId}`, 'success');
    }

    // Clear dirty + clean up backups / legacy temp files.
    const mgrStore = useSegmentationManagerStore.getState();
    const recoveredInfo = mgrStore.recoveredSegIds[segmentationId];
    mgrStore.clearDirty(segmentationId);
    mgrStore.clearRecovered(segmentationId);
    if (!mgrStore.hasDirtySegmentations()) {
      useSegmentationStore.getState()._markClean();
    }
    // Dynamic import: backupService transitively pulls in
    // segmentationService + rtStructService, which break JSDOM
    // unit tests. Keep out of the static graph.
    try {
      const { backupService } = await import('../backup/backupService');
      await backupService.deleteEntriesForSegmentation(panelCtx.sessionId, segmentationId);
      if (recoveredInfo && typeof recoveredInfo === 'object') {
        try {
          await backupService.deleteBackupEntry(recoveredInfo.sessionId, recoveredInfo.filename);
        } catch {
          // Best-effort.
        }
      }
    } catch {
      // Best-effort backup cleanup.
    }
    try {
      const files = await window.electronAPI.xnat.listTempFiles(panelCtx.sessionId);
      const pattern = new RegExp(`^autosave_(?:seg|rtstruct)_${sourceScanId}(?:_\\d{14})?\\.dcm$`);
      for (const f of files.files ?? []) {
        if (pattern.test(f.name)) {
          window.electronAPI.xnat.deleteTempFile(panelCtx.sessionId, f.name).catch(() => undefined);
        }
      }
    } catch {
      // Best-effort temp-file cleanup.
    }
    return 'saved';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const normalized = msg.toLowerCase();
    if (
      normalized.includes('no painted segment data found')
      || normalized.includes('no painted segment data')
      || normalized.includes('nothing to export')
    ) {
      deps.notify(
        dicomType === 'RTSTRUCT'
          ? 'No structure content to save. Add a contour first.'
          : 'No painted segment data to save. Paint at least one slice first.',
        'error',
      );
      return 'failed';
    }
    deps.notify(msg || `${dicomType} upload failed`, 'error');
    console.error('[xnatUploadService] uploadSegmentationToXnat failed:', err);
    return 'failed';
  } finally {
    segmentationManager.endManualSave();
  }
}

/**
 * Default export factory used by callers that want the standard
 * "export the segmentation by type" implementation.
 *
 * Lives in this module so callers don't have to wire the
 * `rtStructService.exportToRtStruct` / `segmentationManager.exportToDicomSeg`
 * branch themselves — those are universal.
 */
export function defaultExportToBase64(): UploadDeps['exportToBase64'] {
  return async (segmentationId, dicomType) => {
    // Dynamic imports break the static graph that pulls in
    // @cornerstonejs/adapters via rtStructService — that module
    // fails to parse in JSDOM unit-test environments.
    if (dicomType === 'RTSTRUCT') {
      const { rtStructService } = await import('./rtStructService');
      return rtStructService.exportToRtStruct(segmentationId);
    }
    const { segmentationManager } = await import('../segmentation/segmentationManagerSingleton');
    return segmentationManager.exportToDicomSeg(segmentationId);
  };
}
