import { useEffect, useState, useCallback, useRef } from 'react';
import { initCornerstone } from './lib/cornerstone/init';
import ViewerPage from './pages/ViewerPage';
import ExportDropdown from './components/viewer/ExportDropdown';
import LoginForm from './components/connection/LoginForm';
import ConnectionStatus from './components/connection/ConnectionStatus';
import XnatBrowser from './components/connection/XnatBrowser';
import { useConnectionStore } from './stores/connectionStore';
import { useViewerStore } from './stores/viewerStore';
import { useSegmentationStore } from './stores/segmentationStore';
import { wadouri } from '@cornerstonejs/dicom-image-loader';
import { dicomwebLoader } from './lib/cornerstone/dicomwebLoader';
import { matchProtocol, applyProtocol } from './lib/hangingProtocolService';
import { panelId } from '@shared/types/viewer';
import { BUILT_IN_PROTOCOLS } from '@shared/types/hangingProtocol';
import type { XnatScan } from '@shared/types/xnat';
import { IconOpenFile, IconPin, IconChevronDown, XnatLogo } from './components/icons';
import { volumeService } from './lib/cornerstone/volumeService';
import {
  loadPinnedItems,
  addPinnedItem,
  removePinnedItem,
  isPinned as isPinnedCheck,
  loadRecentSessions,
  saveRecentSession as saveRecentSessionUtil,
  removeRecentSession,
  migrateOldStorage,
  type PinnedItem,
  type RecentSession,
  type NavigateToTarget,
} from './lib/pinnedItems';
import { rtStructService } from './lib/cornerstone/rtStructService';
import { viewportService } from './lib/cornerstone/viewportService';
import { imageLoader, cache, metaData } from '@cornerstonejs/core';
import * as dicomParser from 'dicom-parser';
import { viewportReadyService } from './lib/cornerstone/viewportReadyService';
import { useSessionDerivedIndexStore, isSegScan, isRtStructScan, isDerivedScan } from './stores/sessionDerivedIndexStore';
import { useSegmentationManagerStore } from './stores/segmentationManagerStore';
import { segmentationManager } from './lib/segmentation/segmentationManagerSingleton';
import { segmentationService } from './lib/cornerstone/segmentationService';
import { getSegReferenceInfo } from './lib/dicom/segReferencedSeriesUid';

/** DICOM SEG SOP Class UID */
const SEG_SOP_CLASS_UID = '1.2.840.10008.5.1.4.1.1.66.4';

/** DICOM RTSTRUCT SOP Class UID */
const RTSTRUCT_SOP_CLASS_UID = '1.2.840.10008.5.1.4.1.1.481.3';
const XNAT_SCAN_DRAG_MIME = 'application/x-xnat-scan';
const XNAT_SCAN_DRAG_FALLBACK_MIME = 'text/x-xnat-scan';

interface XnatScanDragPayload {
  sessionId: string;
  scanId: string;
  scan: XnatScan;
  context: {
    projectId: string;
    subjectId: string;
    sessionLabel: string;
    projectName?: string;
    subjectLabel?: string;
  };
}

// isSegScan, isRtStructScan, isDerivedScan imported from sessionDerivedIndexStore
// getSegReferenceInfo imported from lib/dicom/segReferencedSeriesUid

/** Tracks sessions that have already been checked for auto-save recovery. */
const recoveredSessions = new Set<string>();

/** Tracks SEG/RTSTRUCT scan IDs with in-progress loads (prevents duplicates from rapid clicks).
 *  Map of scanId → timestamp(ms). Entries older than 30s are considered stale and auto-cleared. */
const segLoadingLock = new Map<string, number>();
const SEG_LOCK_STALE_MS = 30_000;

/** Acquire a loading lock for a SEG/RTSTRUCT scan. Returns false if already locked (not stale). */
function acquireSegLock(scanId: string): boolean {
  const now = Date.now();
  const existing = segLoadingLock.get(scanId);
  if (existing && (now - existing) < SEG_LOCK_STALE_MS) {
    console.warn(`[App] SEG scan #${scanId} already loading — ignoring duplicate click`);
    return false;
  }
  segLoadingLock.set(scanId, now);
  return true;
}

/** Release a loading lock for a SEG/RTSTRUCT scan. */
function releaseSegLock(scanId: string): void {
  segLoadingLock.delete(scanId);
}

/**
 * Check for auto-saved temp files on the XNAT session and prompt recovery.
 * Called after all scans are loaded in loadSessionFromXnat().
 */
async function checkForAutoSaveRecovery(
  sessionId: string,
  scanIdToPanelInfo: Map<string, { pid: string; ids: string[] }>,
): Promise<void> {
  // Only check once per session to avoid repeated dialog prompts
  if (recoveredSessions.has(sessionId)) return;

  try {
    const result = await window.electronAPI.xnat.listTempFiles(sessionId);
    if (!result.ok || !result.files || result.files.length === 0) return;

    // Find auto-save files (both SEG and RTSTRUCT)
    const autoSaveFiles = result.files.filter(
      (f) => (f.name.startsWith('autosave_seg_') || f.name.startsWith('autosave_rtstruct_')) && f.name.endsWith('.dcm'),
    );
    if (autoSaveFiles.length === 0) return;

    const loadedPanelsById: Record<string, string[]> = {};
    for (const panelInfo of scanIdToPanelInfo.values()) {
      loadedPanelsById[panelInfo.pid] = panelInfo.ids;
    }

    for (const file of autoSaveFiles) {
      const isRtStruct = file.name.startsWith('autosave_rtstruct_');
      const sourceScanHint = file.name.match(/^autosave_(?:seg|rtstruct)_(.+?)(?:_\d{14})?\.dcm$/)?.[1] ?? null;

      let arrayBuffer: ArrayBuffer;
      try {
        const downloadResult = await window.electronAPI.xnat.downloadTempFile(sessionId, file.name);
        if (!downloadResult.ok || !downloadResult.data) {
          console.error(`[App] Failed to download temp file: ${downloadResult.error}`);
          continue;
        }
        const binaryString = atob(downloadResult.data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        arrayBuffer = bytes.buffer;
      } catch (err) {
        console.error(`[App] Failed to fetch auto-saved file "${file.name}":`, err);
        continue;
      }

      let targetPanelInfo: { panelId: string; imageIds: string[] } | null = null;
      let refLabel = '';
      try {
        if (isRtStruct) {
          const parsedRt = rtStructService.parseRtStruct(arrayBuffer);
          if (parsedRt.referencedSeriesUID) {
            targetPanelInfo = findPanelBySeriesUID(parsedRt.referencedSeriesUID, loadedPanelsById);
            if (targetPanelInfo) refLabel = `SeriesInstanceUID ${parsedRt.referencedSeriesUID}`;
          }
          if (!targetPanelInfo) {
            const referencedSops = new Set<string>();
            for (const roi of parsedRt.rois) {
              for (const contour of roi.contours) {
                if (contour.referencedSOPInstanceUID) {
                  referencedSops.add(contour.referencedSOPInstanceUID);
                }
              }
            }
            if (referencedSops.size > 0) {
              targetPanelInfo = findPanelByReferencedSopInstanceUIDs(
                Array.from(referencedSops),
                loadedPanelsById,
              );
              if (targetPanelInfo) refLabel = `${referencedSops.size} referenced SOP UID(s)`;
            }
          }
        } else {
          const refInfo = getSegReferenceInfo(arrayBuffer);
          if (refInfo.referencedSeriesUID) {
            targetPanelInfo = findPanelBySeriesUID(refInfo.referencedSeriesUID, loadedPanelsById);
            if (targetPanelInfo) refLabel = `SeriesInstanceUID ${refInfo.referencedSeriesUID}`;
          }
          if (!targetPanelInfo && refInfo.referencedSOPInstanceUIDs.length > 0) {
            targetPanelInfo = findPanelByReferencedSopInstanceUIDs(
              refInfo.referencedSOPInstanceUIDs,
              loadedPanelsById,
            );
            if (targetPanelInfo) refLabel = `${refInfo.referencedSOPInstanceUIDs.length} referenced SOP UID(s)`;
          }
        }
      } catch (err) {
        console.error(`[App] Failed to parse auto-saved file "${file.name}":`, err);
      }

      if (!targetPanelInfo) {
        console.warn(
          `[App] Auto-save recovery: could not resolve loaded source for ${file.name}`
          + (sourceScanHint ? ` (hint source scan #${sourceScanHint})` : ''),
        );
        continue;
      }

      const typeLabel = isRtStruct ? 'contour (RTSTRUCT)' : 'segmentation';
      const recover = window.confirm(
        `An auto-saved ${typeLabel} was found.\n\n` +
        `${refLabel ? `Linked by ${refLabel}.\n\n` : ''}` +
        `This may be from an editing session that was not saved.\n\n` +
        `Would you like to recover it?`,
      );

      if (recover) {
        try {
          await preloadImages(targetPanelInfo.imageIds);

          let recoveredSegId: string;
          if (isRtStruct) {
            const { segmentationId, firstReferencedImageId } =
              await segmentationManager.loadRtStructFromArrayBuffer(
                targetPanelInfo.panelId,
                arrayBuffer,
                targetPanelInfo.imageIds,
              );
            recoveredSegId = segmentationId;
            await jumpViewportToReferencedImage(targetPanelInfo.panelId, firstReferencedImageId);
          } else {
            const { segmentationId, firstNonZeroReferencedImageId } =
              await segmentationManager.loadSegFromArrayBuffer(
                targetPanelInfo.panelId,
                arrayBuffer,
                targetPanelInfo.imageIds,
              );
            recoveredSegId = segmentationId;
            await jumpViewportToReferencedImage(targetPanelInfo.panelId, firstNonZeroReferencedImageId);
          }

          await window.electronAPI.xnat.deleteTempFile(sessionId, file.name).catch(() => {});

          console.log(
            `[App] Recovered ${isRtStruct ? 'RTSTRUCT' : 'SEG'} auto-save "${file.name}" `
            + `on ${targetPanelInfo.panelId} as ${recoveredSegId}`,
          );

          const segStore = useSegmentationStore.getState();
          if (!segStore.showPanel) segStore.togglePanel();
        } catch (err) {
          console.error(`[App] Failed to load recovered auto-save file "${file.name}":`, err);
        }
      } else {
        const deleteIt = window.confirm('Delete this auto-saved file?');
        if (deleteIt) {
          await window.electronAPI.xnat.deleteTempFile(sessionId, file.name).catch(() => {});
        }
      }
    }

    // Mark this session as checked so the dialog won't fire again
    recoveredSessions.add(sessionId);
  } catch (err) {
    console.error('[App] Auto-save recovery check failed:', err);
    // Non-fatal — don't block session loading
    recoveredSessions.add(sessionId); // Still mark as checked to avoid retry loops
  }
}

// getSegReferenceInfo moved to lib/dicom/segReferencedSeriesUid.ts

/**
 * Find which loaded scan's images match a given SeriesInstanceUID.
 * Returns the panelId and imageIds if found.
 */
function findPanelBySeriesUID(
  seriesUID: string,
  panelImageIds: Record<string, string[]>,
): { panelId: string; imageIds: string[] } | null {
  for (const [pid, ids] of Object.entries(panelImageIds)) {
    if (ids.length === 0) continue;
    // Check the first image's series UID
    const seriesMeta = metaData.get('generalSeriesModule', ids[0]) as
      | { seriesInstanceUID?: string } | undefined;
    if (seriesMeta?.seriesInstanceUID === seriesUID) {
      return { panelId: pid, imageIds: ids };
    }
  }
  return null;
}

function toWadouriUri(imageId: string): string {
  return imageId.startsWith('wadouri:') ? imageId.slice('wadouri:'.length) : imageId;
}

function extractObjectUidFromImageId(imageId: string): string | null {
  const uri = toWadouriUri(imageId);
  const queryStart = uri.indexOf('?');
  if (queryStart < 0) return null;
  const params = new URLSearchParams(uri.slice(queryStart + 1));
  return (
    params.get('objectUID') ??
    params.get('objectUid') ??
    params.get('SOPInstanceUID') ??
    params.get('sopInstanceUID')
  );
}

function findPanelByReferencedSopInstanceUIDs(
  referencedSopInstanceUIDs: string[],
  panelImageIds: Record<string, string[]>,
): { panelId: string; imageIds: string[] } | null {
  if (referencedSopInstanceUIDs.length === 0) return null;
  const target = new Set(referencedSopInstanceUIDs);

  for (const [pid, ids] of Object.entries(panelImageIds)) {
    if (ids.length === 0) continue;
    for (const imageId of ids) {
      const fromImageId = extractObjectUidFromImageId(imageId);
      if (fromImageId && target.has(fromImageId)) {
        return { panelId: pid, imageIds: ids };
      }

      const sopCommon = metaData.get('sopCommonModule', imageId) as
        | { sopInstanceUID?: string }
        | undefined;
      if (sopCommon?.sopInstanceUID && target.has(sopCommon.sopInstanceUID)) {
        return { panelId: pid, imageIds: ids };
      }
    }
  }

  return null;
}

async function getSeriesUidForImageId(imageId: string): Promise<string | null> {
  const seriesMeta = metaData.get('generalSeriesModule', imageId) as
    | { seriesInstanceUID?: string } | undefined;
  if (seriesMeta?.seriesInstanceUID) return seriesMeta.seriesInstanceUID;

  try {
    const uri = toWadouriUri(imageId);
    if (!wadouri.dataSetCacheManager.isLoaded(uri)) {
      await wadouri.dataSetCacheManager.load(uri, undefined as any, imageId);
    }
    const ds = wadouri.dataSetCacheManager.get(uri);
    return ds?.string?.('x0020000e') ?? null;
  } catch {
    return null;
  }
}

async function getSopInstanceUidForImageId(imageId: string): Promise<string | null> {
  const fromImageId = extractObjectUidFromImageId(imageId);
  if (fromImageId) return fromImageId;

  const sopCommon = metaData.get('sopCommonModule', imageId) as
    | { sopInstanceUID?: string }
    | undefined;
  if (sopCommon?.sopInstanceUID) return sopCommon.sopInstanceUID;

  try {
    const uri = toWadouriUri(imageId);
    if (!wadouri.dataSetCacheManager.isLoaded(uri)) {
      await wadouri.dataSetCacheManager.load(uri, undefined as any, imageId);
    }
    const ds = wadouri.dataSetCacheManager.get(uri);
    return ds?.string?.('x00080018') ?? null;
  } catch {
    return null;
  }
}

/**
 * Search through all session scans to find the one whose SeriesInstanceUID
 * matches the given UID. Loads the first image of each candidate scan to
 * check its metadata. Returns the full imageIds array for the matching scan.
 */
async function findSourceScanBySeriesUID(
  sessionId: string,
  targetSeriesUID: string,
  scans: XnatScan[],
): Promise<{ scanId: string; imageIds: string[] } | null> {
  // Only check non-derived scans (exclude SEG, RTSTRUCT)
  const candidates = scans.filter((s) => !isDerivedScan(s));
  console.log(`[App] Searching ${candidates.length} scans for SeriesInstanceUID ${targetSeriesUID}`);

  for (const scan of candidates) {
    try {
      const ids = await dicomwebLoader.getScanImageIds(sessionId, scan.id);
      if (ids.length === 0) continue;

      const seriesUID = await getSeriesUidForImageId(ids[0]);
      if (seriesUID === targetSeriesUID) {
        console.log(`[App] Found matching source: scan #${scan.id} (${ids.length} images)`);
        return { scanId: scan.id, imageIds: ids };
      }
    } catch (err) {
      console.warn(`[App] Failed to probe scan #${scan.id}:`, err);
    }
  }
  return null;
}

async function findSourceScanByReferencedSopInstanceUIDs(
  sessionId: string,
  referencedSopInstanceUIDs: string[],
  scans: XnatScan[],
): Promise<{ scanId: string; imageIds: string[] } | null> {
  if (referencedSopInstanceUIDs.length === 0) return null;
  const target = new Set(referencedSopInstanceUIDs);
  const candidates = scans.filter((s) => !isDerivedScan(s));
  console.log(
    `[App] Searching ${candidates.length} scans for referenced SOP Instance UID fallback (${target.size} UID(s))`,
  );

  for (const scan of candidates) {
    try {
      const ids = await dicomwebLoader.getScanImageIds(sessionId, scan.id);
      if (ids.length === 0) continue;

      // Fast path: UID embedded in wadouri URL query.
      const fastMatch = ids.some((imageId) => {
        const uid = extractObjectUidFromImageId(imageId);
        return !!uid && target.has(uid);
      });
      if (fastMatch) {
        console.log(`[App] Found SOP UID fallback match in source scan #${scan.id} (${ids.length} images)`);
        return { scanId: scan.id, imageIds: ids };
      }

      // Slow path: metadata/header probe for non-query imageIds.
      const probeIds = ids.slice(0, Math.min(ids.length, 8));
      for (const imageId of probeIds) {
        const uid = await getSopInstanceUidForImageId(imageId);
        if (uid && target.has(uid)) {
          console.log(`[App] Found SOP UID fallback metadata match in source scan #${scan.id}`);
          return { scanId: scan.id, imageIds: ids };
        }
      }
    } catch (err) {
      console.warn(`[App] Failed SOP UID fallback probe for scan #${scan.id}:`, err);
    }
  }

  return null;
}

/**
 * Pre-load and cache all source images so their metadata is available.
 * Cornerstone only parses DICOM metadata when a file is actually fetched;
 * without this, metadataProvider.get('instance', imageId) returns undefined
 * and createFromDICOMSegBuffer fails.
 */
async function preloadImages(imageIds: string[]): Promise<void> {
  console.log(`[App] Pre-loading ${imageIds.length} images for metadata...`);
  const promises = imageIds.map((id) => {
    if (cache.getImageLoadObject(id)) return Promise.resolve();
    return imageLoader.loadAndCacheImage(id).catch((err: unknown) => {
      console.warn(`[App] Failed to pre-load image ${id}:`, err);
    });
  });
  await Promise.all(promises);
  console.log(`[App] All ${imageIds.length} images pre-loaded`);
}

async function jumpViewportToReferencedImage(panelId: string, referencedImageId: string | null) {
  if (!referencedImageId) return;

  // The viewport should already be ready (callers await viewportReadyService.whenReady
  // or addToViewport before calling this). No polling needed.
  const vp = viewportService.getViewport(panelId);
  if (!vp) return;

  const stackIds = vp.getImageIds();
  const targetIndex = stackIds.indexOf(referencedImageId);

  if (targetIndex < 0) {
    console.warn(`[App] referencedImageId not found in stack: ${referencedImageId}`);
    return;
  }

  const anyVp: any = vp;
  if (typeof anyVp.setImageIdIndex === 'function') {
    anyVp.setImageIdIndex(targetIndex);
  } else {
    const cur = vp.getCurrentImageIdIndex();
    vp.scroll(targetIndex - cur);
  }

  vp.render();
  console.log(`[App] Jumped ${panelId} to referenced slice index=${targetIndex}`);
}

/**
 * Download a DICOM SEG file from XNAT and convert from base64 to ArrayBuffer.
 */
async function downloadSegArrayBuffer(
  sessionId: string,
  scanId: string,
): Promise<ArrayBuffer> {
  const result = await window.electronAPI.xnat.downloadScanFile(sessionId, scanId);
  if (!result.ok || !result.data) {
    throw new Error(result.error || 'Failed to download scan file');
  }
  // Convert base64 → ArrayBuffer (manual loop; fetch(data:) violates Electron CSP)
  const binaryString = atob(result.data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * App — Root component for XNAT Workstation.
 *
 * Shows LoginForm when disconnected, viewer when connected.
 *
 * Supports loading DICOM data via:
 * 1. Drag-and-drop local DICOM files (always available)
 * 2. Open Files button (file picker, always available)
 * 3. DICOMweb via XNAT (Study UID + Series UID, requires connection)
 *
 * Images are loaded into the currently active panel (multi-panel support).
 */
export default function App() {
  const [cornerstoneReady, setCornerstoneReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [panelImageIds, setPanelImageIdsRaw] = useState<Record<string, string[]>>({});
  /** Always-current ref to panelImageIds — avoids stale closures in callbacks
   *  that only depend on [isConnected]. */
  const panelImageIdsRef = useRef(panelImageIds);
  panelImageIdsRef.current = panelImageIds;

  /**
   * Tracks the latest epoch per panel. Whenever a panel's imageIds change, we
   * bump the epoch via viewportReadyService so that any pending async operations
   * targeting the old viewport can detect staleness and abort.
   */
  const panelEpochRef = useRef<Record<string, number>>({});

  /**
   * Wrapper around setPanelImageIds that bumps the viewport-ready epoch for
   * each panel whose imageIds change. This is the ONLY way to update panelImageIds.
   *
   * Epochs are bumped synchronously before the React setState call so that
   * downstream code (e.g. onPanelImagesChanged) sees the correct epoch
   * immediately — React 18 batches setState updaters so a bump inside the
   * updater function would not be visible until the next render.
   *
   * When called with an updater function, we compute the next state eagerly
   * from panelImageIdsRef so the epoch bump still happens synchronously.
   */
  const setPanelImageIds = useCallback((
    updater: Record<string, string[]> | ((prev: Record<string, string[]>) => Record<string, string[]>),
  ) => {
    // Compute the next value eagerly so we can bump epochs synchronously.
    const prev = panelImageIdsRef.current;
    const next = typeof updater === 'function' ? updater(prev) : updater;
    // Bump epoch for every panel in the new map (synchronous — no batching delay)
    for (const pid of Object.keys(next)) {
      panelEpochRef.current[pid] = viewportReadyService.bumpEpoch(pid);
    }
    // Eagerly update the ref so that back-to-back calls before React re-renders
    // still see the correct "previous" value.
    panelImageIdsRef.current = next;
    setPanelImageIdsRaw(next);
  }, []);

  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showBrowser, setShowBrowser] = useState(true);
  const [browserWidth, setBrowserWidth] = useState(288);
  const browserWidthRef = useRef(288); // persists width when collapsed
  const isResizingRef = useRef(false);

  // ─── Bookmarks (pinned items & recent sessions) ───────────────
  const [pinnedItems, setPinnedItems] = useState<PinnedItem[]>([]);
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([]);
  const [navigateTo, setNavigateTo] = useState<NavigateToTarget | null>(null);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const bookmarksRef = useRef<HTMLDivElement>(null);

  const recordLoadedOverlay = useCallback((
    projectId: string,
    sessionId: string,
    sourceScanId: string,
    derivedScanId: string,
    segmentationId: string,
  ) => {
    useSegmentationManagerStore.getState().recordLoaded(
      `${projectId}/${sessionId}/${sourceScanId}`,
      derivedScanId,
      { segmentationId, loadedAt: Date.now() },
    );
  }, []);

  /**
   * Pending DICOM SEG load — when loading a SEG that requires loading new
   * source images into a panel, we can't load the SEG immediately because
   * setPanelImageIds triggers a React state update that destroys and recreates
   * the CornerstoneViewport. The segmentation would be destroyed during the
   * re-render cycle. Instead, we store the pending load here and process it
   * in a useEffect after the new panelImageIds have settled and the viewport
   * has been re-created.
   */
  const pendingSegLoadRef = useRef<{
    panelId: string;
    arrayBuffer: ArrayBuffer;
    sourceImageIds: string[];
    /** XNAT scan ID of the SEG scan (e.g. "3004") — used for origin tracking */
    xnatScanId?: string;
    /** Source imaging scan ID (e.g. "4") — used for origin tracking */
    sourceScanId?: string;
    /** XNAT scan series description — used to override generic Cornerstone labels */
    xnatScanLabel?: string;
    /** XNAT project ID — used for session-scoped origin tracking */
    projectId?: string;
    /** XNAT session (experiment) ID — used for session-scoped origin tracking */
    sessionId?: string;
  } | null>(null);

  /** Tracks panels with an active deferred SEG load (set when loadSeg starts,
   *  cleared when it finishes). Prevents concurrent regular scan loads from
   *  clobbering the segmentation. */
  const segLoadingPanelRef = useRef<string | null>(null);

  // Connection state
  const connectionStatus = useConnectionStore((s) => s.status);
  const connection = useConnectionStore((s) => s.connection);
  const isConnected = connectionStatus === 'connected';

  // Active panel from viewer store
  const activeViewportId = useViewerStore((s) => s.activeViewportId);

  const promptToSaveUnsavedAnnotations = useCallback(async (): Promise<boolean> => {
    const segStore = useSegmentationStore.getState();
    const hasUnsaved =
      segStore.hasUnsavedChanges || segmentationManager.hasDirtySegmentations();
    if (!hasUnsaved) return true;

    const saveDraft = window.confirm(
      'You have unsaved annotations.\n\n' +
      'Press OK to save a recoverable draft before continuing.\n' +
      'Press Cancel to choose whether to discard changes.',
    );

    if (saveDraft) {
      const saved = await segmentationService.flushAutoSaveNow();
      if (saved) {
        segStore._markClean();
        return true;
      }

      const continueWithoutSave = window.confirm(
        'Could not save a draft. Continue and discard unsaved changes?',
      );
      if (!continueWithoutSave) return false;
      segStore._markClean();
      return true;
    }

    const discard = window.confirm(
      'Continue without saving and discard unsaved annotations?',
    );
    if (!discard) return false;
    segStore._markClean();
    return true;
  }, []);

  const wasConnectedRef = useRef(false);
  useEffect(() => {
    if (wasConnectedRef.current && !isConnected) {
      // Clear in-memory viewer/session/annotation state when disconnecting.
      for (const seg of [...useSegmentationStore.getState().segmentations]) {
        segmentationManager.removeSegmentation(seg.segmentationId);
      }
      useSegmentationStore.getState()._markClean();
      useSessionDerivedIndexStore.getState().clear();
      useSegmentationManagerStore.getState().reset();
      recoveredSessions.clear();
      segLoadingLock.clear();
      pendingSegLoadRef.current = null;
      segLoadingPanelRef.current = null;
      setPanelImageIds({});
      setLoading(false);
      setLoadError(null);
      useViewerStore.setState({
        sessionId: null,
        sessionScans: null,
        currentProtocol: null,
        xnatContext: null,
        panelXnatContextMap: {},
        panelScanMap: {},
        panelSessionLabelMap: {},
      });
    }
    wasConnectedRef.current = isConnected;
  }, [isConnected, setPanelImageIds]);

  useEffect(() => {
    initCornerstone()
      .then(() => {
        setCornerstoneReady(true);
        console.log('Cornerstone3D ready');
      })
      .catch((err) => {
        console.error('Cornerstone init failed:', err);
        setInitError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  // ─── Initialize SegmentationManager once Cornerstone is ready ──
  useEffect(() => {
    if (!cornerstoneReady) return;

    segmentationManager.initialize({
      setPanelImageIds: (pid, imageIds) => {
        setPanelImageIds((prev) => ({ ...prev, [pid]: imageIds }));
      },
      getPanelImageIds: (pid) => panelImageIdsRef.current[pid] ?? [],
      preloadImages,
      downloadScanFile: downloadSegArrayBuffer,
      getScanImageIds: (sessionId, scanId) =>
        dicomwebLoader.getScanImageIds(sessionId, scanId),
    });

    return () => {
      segmentationManager.dispose();
    };
  }, [cornerstoneReady, setPanelImageIds]);

  // ─── Unsaved changes: beforeunload guard ────────────────────
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      // Check both old store and new manager store for unsaved changes
      if (
        useSegmentationStore.getState().hasUnsavedChanges ||
        segmentationManager.hasDirtySegmentations()
      ) {
        e.preventDefault();
        // Modern browsers show a generic message; returnValue triggers the dialog
        e.returnValue = 'You have unsaved segmentation changes. Are you sure you want to leave?';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // ─── Bookmarks: migrate old storage on mount ──────────────────
  useEffect(() => {
    migrateOldStorage();
  }, []);

  // ─── Bookmarks: refresh pins & recents when server changes ────
  const refreshBookmarks = useCallback(() => {
    const url = connection?.serverUrl;
    if (url) {
      setPinnedItems(loadPinnedItems(url));
      setRecentSessions(loadRecentSessions(url));
    } else {
      setPinnedItems([]);
      setRecentSessions([]);
    }
  }, [connection?.serverUrl]);

  useEffect(() => {
    refreshBookmarks();
  }, [refreshBookmarks]);

  // ─── Bookmarks: close dropdown on outside click ───────────────
  useEffect(() => {
    if (!showBookmarks) return;
    function handleClick(e: MouseEvent) {
      if (bookmarksRef.current && !bookmarksRef.current.contains(e.target as Node)) {
        setShowBookmarks(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showBookmarks]);

  // ─── Bookmarks: handlers ──────────────────────────────────────
  const handleTogglePin = useCallback(
    (item: PinnedItem) => {
      const url = connection?.serverUrl;
      if (!url) return;
      const id =
        item.type === 'project' ? item.projectId :
        item.type === 'subject' ? item.subjectId :
        item.sessionId;
      if (isPinnedCheck(pinnedItems, item.type, id)) {
        removePinnedItem(item.type, id, url);
      } else {
        addPinnedItem(item);
      }
      refreshBookmarks();
    },
    [connection?.serverUrl, pinnedItems, refreshBookmarks],
  );

  /** Navigate to a pinned or recent item via the bookmarks dropdown. */
  const handleBookmarkNavigate = useCallback(
    (target: NavigateToTarget) => {
      setNavigateTo(target);
      setShowBookmarks(false);
      if (!showBrowser) setShowBrowser(true);
    },
    [showBrowser],
  );

  // ─── Browser panel resize via drag handle ────────────────────
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    const startX = e.clientX;
    const startW = browserWidth;

    function onMouseMove(ev: MouseEvent) {
      const newWidth = startW + (ev.clientX - startX);
      if (newWidth < 150) {
        // Collapse
        isResizingRef.current = false;
        browserWidthRef.current = startW; // remember last width for restore
        setShowBrowser(false);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        return;
      }
      const clamped = Math.min(Math.max(newWidth, 200), 500);
      setBrowserWidth(clamped);
      browserWidthRef.current = clamped;
    }

    function onMouseUp() {
      isResizingRef.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [browserWidth]);

  /** Promote a recent session to a pinned item. */
  const handlePromoteRecent = useCallback(
    (recent: RecentSession) => {
      addPinnedItem({
        type: 'session',
        serverUrl: recent.serverUrl,
        projectId: recent.projectId,
        projectName: recent.projectName,
        subjectId: recent.subjectId,
        subjectLabel: recent.subjectLabel,
        sessionId: recent.sessionId,
        sessionLabel: recent.sessionLabel,
        timestamp: Date.now(),
      });
      refreshBookmarks();
    },
    [refreshBookmarks],
  );

  /**
   * Load local DICOM files using Cornerstone's file manager.
   * Creates wadouri: image IDs backed by in-memory File objects.
   * Loads into the active panel.
   *
   * Detects DICOM SEG files by SOP Class UID and routes them to
   * segmentationService.loadDicomSeg() instead of loading as images.
   */
  const loadLocalFiles = useCallback(async (files: FileList | File[]) => {
    const dicomFiles = Array.from(files).filter(
      (f) => f.name.endsWith('.dcm') || f.name.endsWith('.DCM') || !f.name.includes('.')
    );

    if (dicomFiles.length === 0) {
      console.warn('No DICOM files found in selection');
      return;
    }

    // Separate DICOM SEG / RTSTRUCT files from regular image files.
    // We peek at the SOP Class UID tag (0008,0016) in each file.
    const regularFiles: File[] = [];
    const segFiles: File[] = [];
    const rtStructFiles: File[] = [];

    for (const file of dicomFiles) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const byteArray = new Uint8Array(arrayBuffer);
        // Parse just enough to read the SOP Class UID (stop before pixel data)
        const dataSet = dicomParser.parseDicom(byteArray, { untilTag: 'x7fe00010' });
        const sopClassUid = dataSet.string('x00080016');

        if (sopClassUid === SEG_SOP_CLASS_UID) {
          segFiles.push(file);
        } else if (sopClassUid === RTSTRUCT_SOP_CLASS_UID) {
          rtStructFiles.push(file);
        } else {
          regularFiles.push(file);
        }
      } catch {
        // If parsing fails, treat as regular DICOM image
        regularFiles.push(file);
      }
    }

    // Load regular DICOM image files into the active panel
    let newImageIds: string[] = [];
    const targetPanel = useViewerStore.getState().activeViewportId;

    if (regularFiles.length > 0) {
      for (const file of regularFiles) {
        const imageId = wadouri.fileManager.add(file);
        newImageIds.push(imageId);
      }
      if (newImageIds.length > 1) {
        try {
          newImageIds = await dicomwebLoader.orderImageIdsByDicomMetadata(
            newImageIds,
            `local import (${regularFiles.length} file(s))`,
          );
        } catch (err) {
          console.warn('[App] Local file metadata ordering failed, using insertion order:', err);
        }
      }
      console.log(`Loaded ${newImageIds.length} DICOM image files into ${targetPanel}`);
      setPanelImageIds((prev) => ({ ...prev, [targetPanel]: newImageIds }));
      useViewerStore.getState().setPanelSessionLabel(targetPanel, '');
    }

    // Load DICOM SEG files as segmentation overlays
    if (segFiles.length > 0) {
      // Baseline source image IDs — use freshly loaded IDs if we just loaded
      // images in the same drop, otherwise fall back to existing active-panel images.
      const defaultSourceImageIds = newImageIds.length > 0
        ? newImageIds
        : (panelImageIdsRef.current[targetPanel] ?? []);

      // Small delay to let Cornerstone register the source images (if loaded together)
      if (newImageIds.length > 0) {
        await new Promise((r) => setTimeout(r, 200));
      }

      for (const file of segFiles) {
        try {
          const arrayBuffer = await file.arrayBuffer();
          let segTargetPanel = targetPanel;
          let segSourceImageIds = defaultSourceImageIds;
          let matchedByReference = false;

          // For externally-generated SEG files, resolve source linkage against
          // currently loaded panels before assuming the active panel.
          const refInfo = getSegReferenceInfo(arrayBuffer);
          const refSeriesUID = refInfo.referencedSeriesUID;
          if (refSeriesUID) {
            const loadedMatch = findPanelBySeriesUID(refSeriesUID, panelImageIdsRef.current);
            if (loadedMatch) {
              segTargetPanel = loadedMatch.panelId;
              segSourceImageIds = loadedMatch.imageIds;
              matchedByReference = true;
              console.log(
                `[App] Local SEG "${file.name}" matched loaded source in ${segTargetPanel} via SeriesInstanceUID`,
              );
            }
          }
          if (!matchedByReference && refInfo.referencedSOPInstanceUIDs.length > 0) {
            const loadedSopMatch = findPanelByReferencedSopInstanceUIDs(
              refInfo.referencedSOPInstanceUIDs,
              panelImageIdsRef.current,
            );
            if (loadedSopMatch) {
              segTargetPanel = loadedSopMatch.panelId;
              segSourceImageIds = loadedSopMatch.imageIds;
              matchedByReference = true;
              console.log(
                `[App] Local SEG "${file.name}" matched loaded source in ${segTargetPanel} via SOP Instance UID fallback`,
              );
            }
          }
          // If SEG carries explicit references but none match loaded panels,
          // avoid applying it to an unrelated active stack.
          if (
            !matchedByReference
            && (refSeriesUID || refInfo.referencedSOPInstanceUIDs.length > 0)
          ) {
            segSourceImageIds = [];
          }

          if (segSourceImageIds.length === 0) {
            console.warn(
              `[App] Cannot load DICOM SEG "${file.name}" — no matching source images loaded in any viewport`,
            );
            continue;
          }

          const { segmentationId, firstNonZeroReferencedImageId } =
            await segmentationManager.loadSegFromArrayBuffer(segTargetPanel, arrayBuffer, segSourceImageIds);
          useViewerStore.getState().setActiveViewport(segTargetPanel);
          await jumpViewportToReferencedImage(segTargetPanel, firstNonZeroReferencedImageId);
          console.log(`[App] Loaded DICOM SEG file "${file.name}" as ${segmentationId} on ${segTargetPanel}`);
        } catch (err) {
          console.error(`[App] Failed to load DICOM SEG "${file.name}":`, err);
        }
      }

      // Open the segmentation panel
      const segStore = useSegmentationStore.getState();
      if (!segStore.showPanel) {
        segStore.togglePanel();
      }
    }

    // Load DICOM RTSTRUCT files as contour segmentation overlays
    if (rtStructFiles.length > 0) {
      const sourceImageIds = newImageIds.length > 0
        ? newImageIds
        : (panelImageIdsRef.current[targetPanel] ?? []);

      if (sourceImageIds.length === 0) {
        console.warn('[App] Cannot load DICOM RTSTRUCT — no source images loaded in active panel');
        return;
      }

      // Small delay to let Cornerstone register the source images (if loaded together)
      if (newImageIds.length > 0) {
        await new Promise((r) => setTimeout(r, 200));
      }

      for (const file of rtStructFiles) {
        try {
          const arrayBuffer = await file.arrayBuffer();
          const { segmentationId, firstReferencedImageId } =
            await segmentationManager.loadRtStructFromArrayBuffer(targetPanel, arrayBuffer, sourceImageIds);
          await jumpViewportToReferencedImage(targetPanel, firstReferencedImageId);
          console.log(`[App] Loaded RTSTRUCT file "${file.name}" as ${segmentationId}`);
        } catch (err) {
          console.error(`[App] Failed to load RTSTRUCT "${file.name}":`, err);
        }
      }

      // Open the segmentation panel
      const segStore2 = useSegmentationStore.getState();
      if (!segStore2.showPanel) {
        segStore2.togglePanel();
      }
    }
  }, []);

  /**
   * Process pending DICOM SEG loads after the viewport has been recreated.
   *
   * When a SEG scan requires loading new source images, setPanelImageIds
   * triggers CornerstoneViewport to destroy and recreate the viewport.
   * The SEG must be loaded AFTER this recreation settles. We watch for
   * panelImageIds changes and process any pending SEG load.
   */
  useEffect(() => {
    const pending = pendingSegLoadRef.current;
    if (!pending) return;

    // Verify the panel now has the expected source images
    const currentIds = panelImageIds[pending.panelId];
    if (!currentIds || currentIds.length === 0) return;

    // Clear the ref immediately to prevent re-processing
    pendingSegLoadRef.current = null;

    // Give the viewport time to fully initialize after the React re-render.
    // The CornerstoneViewport useEffect creates the viewport, loads images,
    // and resets the camera — we need to wait for all of that to complete.
    const loadSeg = async () => {
      segLoadingPanelRef.current = pending.panelId;
      try {
        // Use the deterministic viewport-ready barrier via manager.
        // The epoch was bumped when setPanelImageIds was called; CornerstoneViewport
        // will call markReady after loadStack + render succeeds.
        const epoch = panelEpochRef.current[pending.panelId] ?? viewportReadyService.getEpoch(pending.panelId);

        const { segmentationId, firstNonZeroReferencedImageId } =
          await segmentationManager.loadSegFromArrayBuffer(
            pending.panelId,
            pending.arrayBuffer,
            pending.sourceImageIds,
            { label: pending.xnatScanLabel, epoch },
          );
        await jumpViewportToReferencedImage(pending.panelId, firstNonZeroReferencedImageId);
        console.log(`[App] Loaded deferred DICOM SEG as ${segmentationId} on ${pending.panelId}`);

        // Track XNAT origin for overwrite-on-save (session-scoped)
        if (pending.xnatScanId && pending.sourceScanId && pending.projectId && pending.sessionId) {
          useSegmentationStore.getState().setXnatOrigin(segmentationId, {
            scanId: pending.xnatScanId,
            sourceScanId: pending.sourceScanId,
            projectId: pending.projectId,
            sessionId: pending.sessionId,
          });
          recordLoadedOverlay(
            pending.projectId,
            pending.sessionId,
            pending.sourceScanId,
            pending.xnatScanId,
            segmentationId,
          );
        }
        if (pending.xnatScanId) releaseSegLock(pending.xnatScanId);

        // Open segmentation panel
        const segStore = useSegmentationStore.getState();
        if (!segStore.showPanel) segStore.togglePanel();
      } catch (err) {
        console.error('[App] Failed to load deferred DICOM SEG:', err);
        if (pending.xnatScanId) releaseSegLock(pending.xnatScanId);
      } finally {
        segLoadingPanelRef.current = null;
        setLoading(false);
      }
    };

    loadSeg();
  }, [panelImageIds, recordLoadedOverlay]);

  /**
   * Load DICOM files for an XNAT scan (selected from the browser panel).
   * Fetches file URIs via IPC and builds wadouri: image IDs.
   * Loads into the active panel.
   *
   * If the scan is a DICOM SEG, loads the source scan's images first,
   * then downloads the SEG and applies it as a segmentation overlay.
   */
  const loadFromXnatScan = useCallback(async (
    sessionId: string,
    scanId: string,
    scan: XnatScan,
    context: { projectId: string; subjectId: string; sessionLabel: string; projectName?: string; subjectLabel?: string },
  ) => {
    if (!isConnected) return;

    const segStoreNav = useSegmentationStore.getState();
    // Prompt to save/discard unsaved annotations before switching scans.
    if (!(await promptToSaveUnsavedAnnotations())) return;

    const currentSessionId = useViewerStore.getState().xnatContext?.sessionId ?? null;
    if (currentSessionId && currentSessionId !== sessionId) {
      for (const seg of [...segStoreNav.segmentations]) {
        segmentationManager.removeSegmentation(seg.segmentationId);
      }
      segLoadingLock.clear();
      useSessionDerivedIndexStore.getState().clear();
      useSegmentationManagerStore.getState().reset();
    }

    const targetPanel = useViewerStore.getState().activeViewportId;
    const ensureSourceScanOnPanel = async (panelId: string, sourceScanId: string): Promise<string[]> => {
      segmentationManager.removeSegmentationsFromViewport(panelId);
      const ids = await dicomwebLoader.getScanImageIds(sessionId, sourceScanId, {
        order: 'dicomMetadata',
      });
      setPanelImageIds((prev) => ({ ...prev, [panelId]: ids }));
      useViewerStore.getState().setPanelXnatContext(panelId, {
        projectId: context.projectId,
        subjectId: context.subjectId,
        sessionId,
        sessionLabel: context.sessionLabel,
        scanId: sourceScanId,
      });
      useViewerStore.getState().setPanelScan(panelId, sourceScanId);
      useViewerStore.getState().setPanelSessionLabel(panelId, context.sessionLabel);
      segmentationManager.onPanelImagesChanged(
        panelId, sourceScanId, panelEpochRef.current[panelId] ?? 0,
      );
      const epoch = panelEpochRef.current[panelId] ?? viewportReadyService.getEpoch(panelId);
      await viewportReadyService.whenReady(panelId, epoch);
      return ids;
    };

    // Ensure XNAT upload context is set (used by SegmentationPanel "Save to XNAT").
    // For derived scans (SEG/RTSTRUCT), prefer the currently loaded panel source.
    const contextScanId = isDerivedScan(scan)
      ? (useViewerStore.getState().panelScanMap[targetPanel] ?? scanId)
      : scanId;
    useViewerStore.getState().setPanelXnatContext(targetPanel, {
      projectId: context.projectId,
      subjectId: context.subjectId,
      sessionId,
      sessionLabel: context.sessionLabel,
      scanId: contextScanId,
    });

    // Remember this session for "Load Recent" on next visit
    const serverUrl = useConnectionStore.getState().connection?.serverUrl;
    if (serverUrl) {
      saveRecentSessionUtil(serverUrl, {
        projectId: context.projectId,
        projectName: context.projectName ?? context.projectId,
        subjectId: context.subjectId,
        subjectLabel: context.subjectLabel ?? context.subjectId,
        sessionId,
        sessionLabel: context.sessionLabel,
      });
      refreshBookmarks();
    }

    try {
      setLoading(true);
      setLoadError(null);

      if (isSegScan(scan)) {
        // ─── SEG scan: load source images + overlay ───────────────

        // Check loading lock (prevents duplicates from rapid clicks during deferred load)
        if (!acquireSegLock(scanId)) {
          setLoading(false);
          return;
        }

        // Check if this SEG scan is already loaded (prevent duplicates, session-scoped)
        const segStore = useSegmentationStore.getState();
        const existingSegEntry = Object.entries(segStore.xnatOriginMap).find(
          ([, origin]) => origin.scanId === scanId && origin.sessionId === sessionId
        );
        if (existingSegEntry) {
          const [existingSegId, existingOrigin] = existingSegEntry;
          if (segmentationManager.segmentationExists(existingSegId)) {
            // Check if the correct source images are loaded in the target panel.
            // The SEG labelmap geometry matches its source scan; reattaching to a
            // viewport showing a different scan's images will silently fail.
            const currentPanelScan = useViewerStore.getState().panelScanMap[targetPanel];
            if (currentPanelScan === existingOrigin.sourceScanId) {
              // Source images match — safe to reattach
              console.log(`[App] SEG scan #${scanId} already loaded — reattaching to viewport`);
              recordLoadedOverlay(
                existingOrigin.projectId,
                existingOrigin.sessionId,
                existingOrigin.sourceScanId,
                scanId,
                existingSegId,
              );
              segmentationManager.userSelectedSegmentation(targetPanel, existingSegId, 1);
              if (!segStore.showPanel) segStore.togglePanel();
              segStore.setActiveSegmentation(existingSegId);
              releaseSegLock(scanId);
              setLoading(false);
              return;
            }
            // Source images don't match the active panel. Reuse the existing
            // segmentation non-destructively by attaching it where its source scan is shown,
            // or load that source scan into the target panel and attach there.
            const panelWithSource = Object.entries(useViewerStore.getState().panelScanMap)
              .find(([, sid]) => sid === existingOrigin.sourceScanId)?.[0];
            if (panelWithSource && (panelImageIdsRef.current[panelWithSource]?.length ?? 0) > 0) {
              console.log(`[App] SEG scan #${scanId} already loaded — reusing on ${panelWithSource}`);
              useViewerStore.getState().setActiveViewport(panelWithSource);
              recordLoadedOverlay(
                existingOrigin.projectId,
                existingOrigin.sessionId,
                existingOrigin.sourceScanId,
                scanId,
                existingSegId,
              );
              segmentationManager.userSelectedSegmentation(panelWithSource, existingSegId, 1);
              if (!segStore.showPanel) segStore.togglePanel();
              segStore.setActiveSegmentation(existingSegId);
              releaseSegLock(scanId);
              setLoading(false);
              return;
            }
            try {
              await ensureSourceScanOnPanel(targetPanel, existingOrigin.sourceScanId);
              recordLoadedOverlay(
                existingOrigin.projectId,
                existingOrigin.sessionId,
                existingOrigin.sourceScanId,
                scanId,
                existingSegId,
              );
              segmentationManager.userSelectedSegmentation(targetPanel, existingSegId, 1);
              if (!segStore.showPanel) segStore.togglePanel();
              segStore.setActiveSegmentation(existingSegId);
              releaseSegLock(scanId);
              setLoading(false);
              return;
            } catch (err) {
              console.warn(`[App] Failed to reuse existing SEG #${scanId}, falling back to fresh load:`, err);
            }
          } else {
            // Stale origin — segmentation was removed. Clear it and proceed with fresh load.
            console.log(`[App] SEG scan #${scanId} origin is stale — reloading`);
            segStore.clearXnatOrigin(existingSegId);
          }
        }

        // 1. Download the SEG file first so we can inspect its metadata
        const arrayBuffer = await downloadSegArrayBuffer(sessionId, scanId);
        console.log(`[App] Downloaded SEG file (${arrayBuffer.byteLength} bytes)`);

        // 2. Parse SEG references for source matching.
        const refInfo = getSegReferenceInfo(arrayBuffer);
        const refSeriesUID = refInfo.referencedSeriesUID;

        // Populate derived index with the referenced series UID
        if (refSeriesUID) {
          useSessionDerivedIndexStore.getState().setDerivedReferencedSeriesUid(sessionId, scanId, refSeriesUID);
        }

        // 3. Check if matching source images are already loaded in a panel
        let sourceIds: string[] | null = null;
        let segTargetPanel = targetPanel;
        let resolvedSegSourceScanId: string | null = null;

        if (refSeriesUID) {
          // Use the ref to get the CURRENT panelImageIds (not the stale
          // closure value). Without this, loading a second SEG that references
          // the same source series would miss the already-loaded images and
          // take the deferred path, unnecessarily removing existing segmentations.
          const match = findPanelBySeriesUID(refSeriesUID, panelImageIdsRef.current);
          if (match) {
            console.log(`[App] Found matching source in ${match.panelId} via SeriesInstanceUID`);
            sourceIds = match.imageIds;
            segTargetPanel = match.panelId;
            resolvedSegSourceScanId = useViewerStore.getState().panelScanMap[match.panelId] ?? null;
          }
        }
        if (!sourceIds && refInfo.referencedSOPInstanceUIDs.length > 0) {
          const sopMatch = findPanelByReferencedSopInstanceUIDs(
            refInfo.referencedSOPInstanceUIDs,
            panelImageIdsRef.current,
          );
          if (sopMatch) {
            console.log(`[App] Found matching source in ${sopMatch.panelId} via SOP Instance UID fallback`);
            sourceIds = sopMatch.imageIds;
            segTargetPanel = sopMatch.panelId;
            resolvedSegSourceScanId = useViewerStore.getState().panelScanMap[sopMatch.panelId] ?? null;
          }
        }

        // 4. If not already loaded, find the correct source scan
        if (!sourceIds) {
          let foundScanId: string | null = null;

          // 4a. Use Referenced Series UID to search all session scans
          if (refSeriesUID) {
            let sessionScans = useViewerStore.getState().sessionScans;
            if (!sessionScans || sessionScans.length === 0) {
              // Fetch scans list from XNAT if not already cached
              sessionScans = await window.electronAPI.xnat.getScans(sessionId);
            }
            if (sessionScans.length > 0) {
              const match = await findSourceScanBySeriesUID(sessionId, refSeriesUID, sessionScans);
              if (match) {
                sourceIds = match.imageIds;
                foundScanId = match.scanId;
                resolvedSegSourceScanId = match.scanId;
                // Record source scan UID for the derived index
                useSessionDerivedIndexStore.getState().setSourceSeriesUid(sessionId, match.scanId, refSeriesUID);
              }
            }
          }
          // 4b. Fallback: match by referenced SOP Instance UIDs
          if (!sourceIds && refInfo.referencedSOPInstanceUIDs.length > 0) {
            let sessionScans = useViewerStore.getState().sessionScans;
            if (!sessionScans || sessionScans.length === 0) {
              sessionScans = await window.electronAPI.xnat.getScans(sessionId);
            }
            if (sessionScans.length > 0) {
              const sopMatch = await findSourceScanByReferencedSopInstanceUIDs(
                sessionId,
                refInfo.referencedSOPInstanceUIDs,
                sessionScans,
              );
              if (sopMatch) {
                sourceIds = sopMatch.imageIds;
                foundScanId = sopMatch.scanId;
                resolvedSegSourceScanId = sopMatch.scanId;
              }
            }
          }

          if (!sourceIds) {
            setLoadError(
              `Cannot resolve source scan for SEG scan #${scanId} via Series UID or SOP Instance UID references.`,
            );
            return;
          }

          // At this point sourceIds and foundScanId are guaranteed non-null
          // from UID-based matching.
          const resolvedSourceIds = sourceIds;
          const resolvedScanId = resolvedSegSourceScanId ?? foundScanId ?? scanId;

          console.log(`[App] Source scan #${resolvedScanId}: ${resolvedSourceIds.length} images`);
          // Clean up stale segmentations before loading new source images
          segmentationManager.removeSegmentationsFromViewport(segTargetPanel);

          // Defer the SEG loading: store the pending load info and let the
          // useEffect process it after the viewport has been recreated with
          // the new source images. This prevents the race condition where
          // setPanelImageIds triggers viewport destruction that removes our
          // segmentation.
          pendingSegLoadRef.current = {
            panelId: segTargetPanel,
            arrayBuffer,
            sourceImageIds: resolvedSourceIds,
            xnatScanId: scanId,
            sourceScanId: resolvedScanId,
            xnatScanLabel: scan.seriesDescription,
            projectId: context.projectId,
            sessionId,
          };
          // Mark panel as having a SEG load in progress BEFORE triggering
          // any React re-renders or viewport recreation. This prevents
          // concurrent regular scan loads from clobbering the segmentation.
          segLoadingPanelRef.current = segTargetPanel;

          setPanelImageIds((prev) => ({ ...prev, [segTargetPanel]: resolvedSourceIds }));
          useViewerStore.getState().setPanelScan(segTargetPanel, resolvedScanId);
          useViewerStore.getState().setPanelSessionLabel(segTargetPanel, context.sessionLabel);
          segmentationManager.onPanelImagesChanged(
            segTargetPanel, resolvedScanId, panelEpochRef.current[segTargetPanel] ?? 0,
          );
          // Don't setLoading(false) here — the deferred useEffect will do it
          return;
        }

        // Source images are already loaded in the panel — load SEG directly via manager.
        const { segmentationId, firstNonZeroReferencedImageId } =
          await segmentationManager.loadSegFromArrayBuffer(
            segTargetPanel,
            arrayBuffer,
            sourceIds,
            { label: scan.seriesDescription },
          );
        await jumpViewportToReferencedImage(segTargetPanel, firstNonZeroReferencedImageId);
        console.log(`[App] Loaded DICOM SEG from XNAT as ${segmentationId} on ${segTargetPanel}`);

        // Track XNAT origin for overwrite-on-save (session-scoped)
        const directSourceScanId =
          resolvedSegSourceScanId ??
          useViewerStore.getState().panelScanMap[segTargetPanel];
        if (directSourceScanId) {
          useSegmentationStore.getState().setXnatOrigin(segmentationId, {
            scanId,
            sourceScanId: directSourceScanId,
            projectId: context.projectId,
            sessionId,
          });
          recordLoadedOverlay(
            context.projectId,
            sessionId,
            directSourceScanId,
            scanId,
            segmentationId,
          );
        }
        releaseSegLock(scanId);

        // 7. Open segmentation panel
        if (!segStore.showPanel) segStore.togglePanel();
      } else if (isRtStructScan(scan)) {
        // ─── RTSTRUCT scan: load contours as segmentation overlay ──

        // Check loading lock (prevents duplicates from rapid clicks)
        if (!acquireSegLock(scanId)) {
          setLoading(false);
          return;
        }

        // Check if this RTSTRUCT scan is already loaded (prevent duplicates, session-scoped)
        const segStoreRt = useSegmentationStore.getState();
        const existingRtEntry = Object.entries(segStoreRt.xnatOriginMap).find(
          ([, origin]) => origin.scanId === scanId && origin.sessionId === sessionId
        );
        if (existingRtEntry) {
          const [existingRtId, existingRtOrigin] = existingRtEntry;
          if (segmentationManager.segmentationExists(existingRtId)) {
            // Check if the correct source images are loaded in the target panel.
            const currentPanelScan = useViewerStore.getState().panelScanMap[targetPanel];
            if (currentPanelScan === existingRtOrigin.sourceScanId) {
              // Source images match — safe to reattach
              console.log(`[App] RTSTRUCT scan #${scanId} already loaded — reattaching to viewport`);
              recordLoadedOverlay(
                existingRtOrigin.projectId,
                existingRtOrigin.sessionId,
                existingRtOrigin.sourceScanId,
                scanId,
                existingRtId,
              );
              segmentationManager.userSelectedSegmentation(targetPanel, existingRtId, 1);
              if (!segStoreRt.showPanel) segStoreRt.togglePanel();
              segStoreRt.setActiveSegmentation(existingRtId);
              releaseSegLock(scanId);
              setLoading(false);
              return;
            }
            const panelWithSource = Object.entries(useViewerStore.getState().panelScanMap)
              .find(([, sid]) => sid === existingRtOrigin.sourceScanId)?.[0];
            if (panelWithSource && (panelImageIdsRef.current[panelWithSource]?.length ?? 0) > 0) {
              console.log(`[App] RTSTRUCT scan #${scanId} already loaded — reusing on ${panelWithSource}`);
              useViewerStore.getState().setActiveViewport(panelWithSource);
              recordLoadedOverlay(
                existingRtOrigin.projectId,
                existingRtOrigin.sessionId,
                existingRtOrigin.sourceScanId,
                scanId,
                existingRtId,
              );
              segmentationManager.userSelectedSegmentation(panelWithSource, existingRtId, 1);
              if (!segStoreRt.showPanel) segStoreRt.togglePanel();
              segStoreRt.setActiveSegmentation(existingRtId);
              releaseSegLock(scanId);
              setLoading(false);
              return;
            }
            try {
              await ensureSourceScanOnPanel(targetPanel, existingRtOrigin.sourceScanId);
              recordLoadedOverlay(
                existingRtOrigin.projectId,
                existingRtOrigin.sessionId,
                existingRtOrigin.sourceScanId,
                scanId,
                existingRtId,
              );
              segmentationManager.userSelectedSegmentation(targetPanel, existingRtId, 1);
              if (!segStoreRt.showPanel) segStoreRt.togglePanel();
              segStoreRt.setActiveSegmentation(existingRtId);
              releaseSegLock(scanId);
              setLoading(false);
              return;
            } catch (err) {
              console.warn(`[App] Failed to reuse existing RTSTRUCT #${scanId}, falling back to fresh load:`, err);
            }
          } else {
            // Stale origin — segmentation was removed. Clear it and proceed with fresh load.
            console.log(`[App] RTSTRUCT scan #${scanId} origin is stale — reloading`);
            segStoreRt.clearXnatOrigin(existingRtId);
          }
        }

        // 1. Download the RTSTRUCT file
        const arrayBuffer = await downloadSegArrayBuffer(sessionId, scanId);
        console.log(`[App] Downloaded RTSTRUCT file (${arrayBuffer.byteLength} bytes)`);

        // 2. Parse the RTSTRUCT
        const parsed = rtStructService.parseRtStruct(arrayBuffer);

        // Populate derived index with the referenced series UID
        if (parsed.referencedSeriesUID) {
          useSessionDerivedIndexStore.getState().setDerivedReferencedSeriesUid(
            sessionId,
            scanId,
            parsed.referencedSeriesUID,
          );
        }

        // 3. Find source images
        let sourceIds: string[] | null = null;
        let rtTargetPanel = targetPanel;
        let resolvedRtSourceScanId: string | null = null;

        if (parsed.referencedSeriesUID) {
          const match = findPanelBySeriesUID(parsed.referencedSeriesUID, panelImageIdsRef.current);
          if (match) {
            console.log(`[App] RTSTRUCT matched to ${match.panelId} via SeriesInstanceUID`);
            sourceIds = match.imageIds;
            rtTargetPanel = match.panelId;
            resolvedRtSourceScanId = useViewerStore.getState().panelScanMap[match.panelId] ?? null;
          }
        }

        // 4. If source not loaded, find and load it
        if (!sourceIds) {
          if (parsed.referencedSeriesUID) {
            let sessionScans = useViewerStore.getState().sessionScans;
            if (!sessionScans || sessionScans.length === 0) {
              sessionScans = await window.electronAPI.xnat.getScans(sessionId);
            }
            if (sessionScans.length > 0) {
              const match = await findSourceScanBySeriesUID(sessionId, parsed.referencedSeriesUID, sessionScans);
              if (match) {
                sourceIds = match.imageIds;
                resolvedRtSourceScanId = match.scanId;
                // Record source scan UID for the derived index
                useSessionDerivedIndexStore.getState().setSourceSeriesUid(
                  sessionId,
                  match.scanId,
                  parsed.referencedSeriesUID,
                );
                // Load source images into panel, then load RTSTRUCT after settling
                sourceIds = await ensureSourceScanOnPanel(rtTargetPanel, match.scanId);
              }
            }
          }

          if (!sourceIds) {
            setLoadError(
              `Cannot resolve source scan for RTSTRUCT #${scanId} via ReferencedFrameOfReference/Series UID.`,
            );
            return;
          }
        }

        // 5-6. Load the RTSTRUCT as contour segmentation via manager
        const { segmentationId, firstReferencedImageId } =
          await segmentationManager.loadRtStructFromArrayBuffer(
            rtTargetPanel,
            arrayBuffer,
            sourceIds,
            { label: scan.seriesDescription },
          );
        await jumpViewportToReferencedImage(rtTargetPanel, firstReferencedImageId);
        console.log(`[App] Loaded RTSTRUCT from XNAT as ${segmentationId} on ${rtTargetPanel}`);

        // 7. Track XNAT origin for RTSTRUCT (same as SEG) for duplicate prevention + save (session-scoped)
        const sourceScanIdRt =
          resolvedRtSourceScanId ??
          useViewerStore.getState().panelScanMap[rtTargetPanel];
        if (!sourceScanIdRt) {
          throw new Error(`Unable to resolve source scan for RTSTRUCT scan #${scanId}`);
        }
        useSegmentationStore.getState().setXnatOrigin(segmentationId, {
          scanId,
          sourceScanId: sourceScanIdRt,
          projectId: context.projectId,
          sessionId,
        });
        recordLoadedOverlay(
          context.projectId,
          sessionId,
          sourceScanIdRt,
          scanId,
          segmentationId,
        );
        releaseSegLock(scanId);

        // 8. Open segmentation panel
        const segStore2 = useSegmentationStore.getState();
        if (!segStore2.showPanel) segStore2.togglePanel();
      } else {
        // ─── Regular scan: load as image stack ────────────────────

        // If a deferred SEG load is pending or in-progress for this panel,
        // skip the regular scan load to avoid clobbering the segmentation.
        if (pendingSegLoadRef.current?.panelId === targetPanel ||
            segLoadingPanelRef.current === targetPanel) {
          console.log(`[App] Skipping regular scan load — SEG load active for ${targetPanel}`);
          return;
        }

        const ids = await dicomwebLoader.getScanImageIds(sessionId, scanId, {
          order: 'dicomMetadata',
        });

        // Re-check after async: a deferred SEG load may have started while
        // we were fetching image IDs
        if (pendingSegLoadRef.current?.panelId === targetPanel ||
            segLoadingPanelRef.current === targetPanel) {
          console.log(`[App] Skipping regular scan load — SEG load started for ${targetPanel}`);
          return;
        }

        const currentScanId = useViewerStore.getState().panelScanMap[targetPanel] ?? null;
        const currentIds = panelImageIdsRef.current[targetPanel] ?? [];
        const stackUnchanged =
          currentScanId === scanId &&
          currentIds.length === ids.length &&
          currentIds.every((id, i) => id === ids[i]);

        if (stackUnchanged) {
          console.log(`[App] Scan #${scanId} already loaded in ${targetPanel}; skipping viewport reload`);
        } else {
          // Clean up stale segmentations before replacing the stack
          segmentationManager.removeSegmentationsFromViewport(targetPanel);
          console.log(`Loaded ${ids.length} images from XNAT into ${targetPanel}`);
          setPanelImageIds((prev) => ({ ...prev, [targetPanel]: ids }));
          useViewerStore.getState().setPanelScan(targetPanel, scanId);
        }
        useViewerStore.getState().setPanelSessionLabel(targetPanel, context.sessionLabel);

        // Notify SegmentationManager about the new source scan
        segmentationManager.onPanelImagesChanged(
          targetPanel,
          scanId,
          panelEpochRef.current[targetPanel] ?? viewportReadyService.getEpoch(targetPanel),
        );

        // Always resolve SEG/RTSTRUCT associations so the Segmentation panel can
        // list available overlays even when automatic display is disabled.
        const derivedIndexStore = useSessionDerivedIndexStore.getState();
        let sessionScans = useViewerStore.getState().sessionScans;

        // Fetch session scans if not already cached (single-scan-click mode)
        if (!sessionScans || sessionScans.length === 0) {
          sessionScans = await window.electronAPI.xnat.getScans(sessionId);
        }

        // Ensure UID resolution is complete (idempotent — skips if already done)
        if (sessionScans.length > 0) {
          await derivedIndexStore.resolveAssociationsForSession(
            sessionId,
            sessionScans,
            (sid, sid2) => dicomwebLoader.getScanImageIds(sid, sid2),
            downloadSegArrayBuffer,
          );
        }

        const derived = derivedIndexStore.getForSource(scanId);
        const allDerived = [...derived.segScans, ...derived.rtStructScans];

        // Auto-display associated SEG/RTSTRUCT annotations for this source scan
        // when the user preference is enabled.
        const { autoLoadSegOnScanClick } = useSegmentationStore.getState();
        if (autoLoadSegOnScanClick) {
          if (allDerived.length > 0) {
            const descriptors = allDerived.map((d) => ({
              type: (isSegScan(d) ? 'SEG' : 'RTSTRUCT') as 'SEG' | 'RTSTRUCT',
              scanId: d.id,
              sessionId,
              label: d.seriesDescription,
            }));
            console.log(`[App] Auto-loading ${descriptors.length} overlay(s) for source scan #${scanId}`);
            try {
              await segmentationManager.requestShowOverlaysForSourceScan(targetPanel, scanId, descriptors);
              // Track XNAT origin for each loaded overlay
              const compositeKey = `${context.projectId}/${sessionId}/${scanId}`;
              const loaded = useSegmentationManagerStore.getState().loadedBySourceScan[compositeKey];
              if (loaded) {
                for (const [derivedScanId, info] of Object.entries(loaded)) {
                  useSegmentationStore.getState().setXnatOrigin(info.segmentationId, {
                    scanId: derivedScanId, sourceScanId: scanId,
                    projectId: context.projectId, sessionId,
                  });
                }
              }
              const segStore = useSegmentationStore.getState();
              if (!segStore.showPanel) segStore.togglePanel();
            } catch (err) {
              console.error(`[App] Failed to auto-load overlays for source scan #${scanId}:`, err);
            }
          }
        } else {
          console.log('[App] Automatic annotation display is disabled — available overlays will be listed in Segments panel');
        }
      }
    } catch (err) {
      console.error('Scan load failed:', err);
      releaseSegLock(scanId);
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('different geometry dimensions') ||
        msg.includes('ReferencedSeriesSequence UID') ||
        msg.includes('ReferencedFrameOfReference/Series UID')
      ) {
        setLoadError(
          `Scan #${scanId} has a UID/geometry mismatch with the loaded source series. ` +
          `Verify that the SEG/RTSTRUCT references a source series present in this session.`
        );
      } else {
        setLoadError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [isConnected, refreshBookmarks, recordLoadedOverlay, promptToSaveUnsavedAnnotations]);

  /**
   * Load ALL scans from an XNAT session using hanging protocols.
   * Matches scans against protocol rules, sets the layout, and
   * loads each matched scan into the appropriate panel in parallel.
   *
   * After imaging scans are loaded, automatically detects and loads any
   * DICOM SEG scans as segmentation overlays on their source scans.
   */
  const loadSessionFromXnat = useCallback(
    async (
      sessionId: string,
      scans: XnatScan[],
      context: { projectId: string; subjectId: string; sessionLabel: string; projectName?: string; subjectLabel?: string },
    ) => {
      if (!isConnected) return;

      const segStoreNav = useSegmentationStore.getState();
      // Prompt to save/discard unsaved annotations before switching sessions.
      if (!(await promptToSaveUnsavedAnnotations())) return;

      for (const seg of [...segStoreNav.segmentations]) {
        segmentationManager.removeSegmentation(seg.segmentationId);
      }

      // Clear stale loading locks, derived index, and manager state from previous session
      segLoadingLock.clear();
      useSessionDerivedIndexStore.getState().clear();
      useSegmentationManagerStore.getState().reset();

      try {
        setLoading(true);
        setLoadError(null);

        // Separate derived scans (SEG, RTSTRUCT) from imaging scans
        const imagingScans = scans.filter((s) => !isDerivedScan(s));
        const segScans = scans.filter((s) => isSegScan(s));
        const rtStructScans = scans.filter((s) => isRtStructScan(s));

        if (segScans.length > 0) {
          console.log(`[App] Found ${segScans.length} SEG scan(s) — will auto-load as overlays`);
        }
        if (rtStructScans.length > 0) {
          console.log(`[App] Found ${rtStructScans.length} RTSTRUCT scan(s) — will auto-load as contour overlays`);
        }

        // Match imaging scans to a hanging protocol
        const { protocol, assignments, unmatched } = matchProtocol(imagingScans);
        console.log(
          `Matched protocol "${protocol.name}" (${protocol.layout}) — ` +
          `${assignments.size} assigned, ${unmatched.length} unmatched`
        );

        // Apply the layout
        const store = useViewerStore.getState();
        store.setLayout(protocol.layout);
        store.setCurrentProtocol(protocol);
        store.setSessionData(sessionId, scans);

        // Build the derived-scan index (source scan → SEG/RTSTRUCT overlays)
        const derivedIndexStore = useSessionDerivedIndexStore.getState();
        if (segScans.length > 0 || rtStructScans.length > 0) {
          await derivedIndexStore.resolveAssociationsForSession(
            sessionId,
            scans,
            (sid, scanIdArg) => dicomwebLoader.getScanImageIds(sid, scanIdArg),
            downloadSegArrayBuffer,
          );
        } else {
          derivedIndexStore.buildDerivedIndex(scans);
        }

        // Remember this session for "Load Recent" on next visit
        const serverUrl = useConnectionStore.getState().connection?.serverUrl;
        if (serverUrl) {
          saveRecentSessionUtil(serverUrl, {
            projectId: context.projectId,
            projectName: context.projectName ?? context.projectId,
            subjectId: context.subjectId,
            subjectLabel: context.subjectLabel ?? context.subjectId,
            sessionId,
            sessionLabel: context.sessionLabel,
          });
          refreshBookmarks();
        }

        // Fetch imageIds for all assigned panels in parallel
        const loadPromises = Array.from(assignments.entries()).map(
          async ([panelIdx, scan]) => {
            const ids = await dicomwebLoader.getScanImageIds(sessionId, scan.id, {
              order: 'dicomMetadata',
            });
            return { panelIdx, ids, scanId: scan.id };
          }
        );
        const results = await Promise.all(loadPromises);

        // Clean up all existing segmentations from panels we're about to load into
        for (const { panelIdx } of results) {
          segmentationManager.removeSegmentationsFromViewport(panelId(panelIdx));
        }

        // Build new panelImageIds map and track scanId→panelId+imageIds mapping
        const newPanelImageIds: Record<string, string[]> = {};
        const scanIdToPanelInfo = new Map<string, { pid: string; ids: string[] }>();

        for (const { panelIdx, ids, scanId } of results) {
          const pid = panelId(panelIdx);
          newPanelImageIds[pid] = ids;
          scanIdToPanelInfo.set(scanId, { pid, ids });
          store.setPanelXnatContext(pid, {
            projectId: context.projectId,
            subjectId: context.subjectId,
            sessionId,
            sessionLabel: context.sessionLabel,
            scanId,
          });
          store.setPanelScan(pid, scanId);
          store.setPanelSessionLabel(pid, context.sessionLabel);
          console.log(`  Panel ${panelIdx} (${pid}): scan #${scanId} → ${ids.length} images`);
        }

        setPanelImageIds(newPanelImageIds);

        // Notify SegmentationManager about every panel's source scan + epoch
        for (const { panelIdx, scanId: sid } of results) {
          const pid = panelId(panelIdx);
          segmentationManager.onPanelImagesChanged(pid, sid, panelEpochRef.current[pid] ?? 0);
        }

        // ─── Auto-display SEG + RTSTRUCT overlays via SegmentationManager ──
        // Use the derived index (built above) to find overlays for each loaded
        // source scan, then delegate loading to the manager which handles:
        // viewport readiness, epoch staleness, load/attach, presentation state.
        const { autoLoadSegOnScanClick } = useSegmentationStore.getState();
        if (autoLoadSegOnScanClick && (segScans.length > 0 || rtStructScans.length > 0)) {
          const derivedIndex = useSessionDerivedIndexStore.getState();
          const overlayPromises: Promise<void>[] = [];

          for (const { scanId: srcScanId } of results) {
            const panelInfo = scanIdToPanelInfo.get(srcScanId);
            if (!panelInfo) continue;

            const derived = derivedIndex.getForSource(srcScanId);
            const descriptors: Array<{ type: 'SEG' | 'RTSTRUCT'; scanId: string; sessionId: string; label?: string }> = [];

            for (const segScan of derived.segScans) {
              descriptors.push({
                type: 'SEG',
                scanId: segScan.id,
                sessionId,
                label: segScan.seriesDescription,
              });
            }
            for (const rtScan of derived.rtStructScans) {
              descriptors.push({
                type: 'RTSTRUCT',
                scanId: rtScan.id,
                sessionId,
                label: rtScan.seriesDescription,
              });
            }

            if (descriptors.length > 0) {
              overlayPromises.push(
                segmentationManager.requestShowOverlaysForSourceScan(
                  panelInfo.pid,
                  srcScanId,
                  descriptors,
                ).then(() => {
                  // Track XNAT origin for each loaded overlay (for overwrite-on-save, session-scoped)
                  const compositeSourceKey = `${context.projectId}/${sessionId}/${srcScanId}`;
                  const managerState = useSegmentationManagerStore.getState();
                  const loadedForSource = managerState.loadedBySourceScan[compositeSourceKey];
                  if (loadedForSource) {
                    for (const [derivedScanId, info] of Object.entries(loadedForSource)) {
                      useSegmentationStore.getState().setXnatOrigin(info.segmentationId, {
                        scanId: derivedScanId,
                        sourceScanId: srcScanId,
                        projectId: context.projectId,
                        sessionId,
                      });
                    }
                  }
                }),
              );
            }
          }

          if (overlayPromises.length > 0) {
            await Promise.all(overlayPromises);

            // Open segmentation panel if any overlays were loaded
            const segStore = useSegmentationStore.getState();
            if (!segStore.showPanel) segStore.togglePanel();
          }
        } else if (!autoLoadSegOnScanClick) {
          console.log('[App] Automatic annotation display is disabled — skipping session overlay attach');
        }

        // ─── Check for auto-save recovery (temp resource files) ──────
        await checkForAutoSaveRecovery(sessionId, scanIdToPanelInfo);

      } catch (err) {
        console.error('Session load failed:', err);
        setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [isConnected, refreshBookmarks, promptToSaveUnsavedAnnotations],
  );

  /**
   * Re-apply a different hanging protocol to the current session.
   * Called from the protocol picker dropdown in the Toolbar.
   */
  const handleApplyProtocol = useCallback(
    async (protocolId: string) => {
      const store = useViewerStore.getState();
      const { sessionScans, sessionId: storedSessionId } = store;
      if (!sessionScans || !storedSessionId) return;

      const protocol = BUILT_IN_PROTOCOLS.find((p) => p.id === protocolId);
      if (!protocol) return;

      try {
        setLoading(true);
        setLoadError(null);

        const { assignments, unmatched } = applyProtocol(sessionScans, protocol);
        console.log(
          `Applied protocol "${protocol.name}" (${protocol.layout}) — ` +
          `${assignments.size} assigned, ${unmatched.length} unmatched`
        );

        store.setLayout(protocol.layout);
        store.setCurrentProtocol(protocol);

        // Fetch imageIds in parallel
        const loadPromises = Array.from(assignments.entries()).map(
          async ([panelIdx, scan]) => {
            const ids = await dicomwebLoader.getScanImageIds(storedSessionId, scan.id, {
              order: 'dicomMetadata',
            });
            return { panelIdx, ids };
          }
        );
        const results = await Promise.all(loadPromises);

        // Clean up segmentations from panels that are about to be replaced
        for (const { panelIdx } of results) {
          segmentationManager.removeSegmentationsFromViewport(panelId(panelIdx));
        }

        const newPanelImageIds: Record<string, string[]> = {};
        for (const { panelIdx, ids } of results) {
          newPanelImageIds[panelId(panelIdx)] = ids;
        }
        setPanelImageIds(newPanelImageIds);
      } catch (err) {
        console.error('Protocol apply failed:', err);
        setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  /**
   * Toggle MPR mode on the active panel's image stack.
   * Enters MPR: creates a 3D volume and shows 2×2 orthogonal views.
   * Exits MPR: destroys volume and restores prior layout.
   */
  const handleToggleMPR = useCallback(async () => {
    const store = useViewerStore.getState();

    if (store.mprActive) {
      // Exit MPR
      store.exitMPR();
      return;
    }

    // Enter MPR — need images from the active panel
    const activeImageIds = panelImageIds[store.activeViewportId] ?? [];
    if (activeImageIds.length < 2) {
      console.warn('[App] Need at least 2 slices for MPR');
      return;
    }

    // Step 1: Generate volume ID and create the volume in cache FIRST
    // This must complete before viewports mount and try to call setVolume
    const volumeId = volumeService.generateId();

    try {
      await volumeService.create(volumeId, activeImageIds);
      console.log('[App] Volume created in cache:', volumeId);
    } catch (err) {
      console.error('[App] Volume creation failed:', err);
      return;
    }

    // Step 2: Now enter MPR mode (sets mprActive=true, renders viewports)
    // The volume exists in cache so viewports can successfully call setVolume
    store.enterMPR(store.activeViewportId, volumeId);

    // Step 3: Start loading the volume data (streaming, progressive)
    try {
      await volumeService.load(volumeId, (p) => {
        const percent = p.total > 0 ? Math.round((p.loaded / p.total) * 100) : 0;
        useViewerStore.getState()._updateMPRVolumeProgress({ ...p, percent });
      });
      // Clear progress when done
      useViewerStore.getState()._updateMPRVolumeProgress(null);
      console.log('[App] Volume loaded for MPR');
    } catch (err) {
      console.error('[App] Volume loading failed:', err);
      useViewerStore.getState().exitMPR();
    }
  }, [panelImageIds]);

  // Derive sourceImageIds for MPR mode (from the panel that launched MPR)
  const mprSourcePanelId = useViewerStore((s) => s.mprSourcePanelId);
  const mprSourceImageIds = mprSourcePanelId ? panelImageIds[mprSourcePanelId] ?? [] : [];

  // Handle drag-and-drop
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);

      const xnatScanRaw =
        e.dataTransfer.getData(XNAT_SCAN_DRAG_MIME) ||
        e.dataTransfer.getData(XNAT_SCAN_DRAG_FALLBACK_MIME);
      if (xnatScanRaw) {
        try {
          const payload = JSON.parse(xnatScanRaw) as XnatScanDragPayload;
          const dropTarget = e.target as HTMLElement | null;
          const dropPanelId = dropTarget?.closest?.('[data-panel-id]')?.getAttribute('data-panel-id');
          if (dropPanelId) {
            useViewerStore.getState().setActiveViewport(dropPanelId);
          }
          void loadFromXnatScan(payload.sessionId, payload.scanId, payload.scan, payload.context);
          return;
        } catch (err) {
          console.warn('[App] Failed to parse dropped XNAT scan payload:', err);
        }
      }

      if (e.dataTransfer.files.length > 0) {
        loadLocalFiles(e.dataTransfer.files);
      }
    },
    [loadLocalFiles, loadFromXnatScan]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer.types);
    const hasFileDrop = types.includes('Files');
    const hasXnatScanDrop =
      types.includes(XNAT_SCAN_DRAG_MIME) ||
      types.includes(XNAT_SCAN_DRAG_FALLBACK_MIME);
    if (!hasFileDrop && !hasXnatScanDrop) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOver(hasFileDrop);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  // File input handler
  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      loadLocalFiles(e.target.files);
    }
  }

  // ─── Error state ───────────────────────────────────────────────

  if (initError) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="bg-red-950 border border-red-800 text-red-200 px-6 py-4 rounded-lg max-w-lg">
          <h2 className="text-lg font-semibold mb-2">Cornerstone3D Initialization Failed</h2>
          <p className="text-sm">{initError}</p>
          <p className="text-xs text-red-400 mt-3">
            Check the console for details. Common issues: web worker configuration,
            WASM loading, or SharedArrayBuffer headers.
          </p>
        </div>
      </div>
    );
  }

  if (!cornerstoneReady) {
    return (
      <div className="h-full flex items-center justify-center bg-zinc-950">
        <div className="flex flex-col items-center gap-3">
          <svg className="animate-spin h-6 w-6 text-blue-400" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
            <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
          </svg>
          <span className="text-zinc-400 text-sm">Initializing Cornerstone3D...</span>
        </div>
      </div>
    );
  }

  // ─── Login screen ──────────────────────────────────────────────

  if (!isConnected) {
    return <LoginForm />;
  }

  // ─── Connected: Viewer ─────────────────────────────────────────

  return (
    <div
      className="h-full flex flex-col relative"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* Full-width toolbar at top, then browser + viewer below */}
      <ViewerPage
        panelImageIds={panelImageIds}
        onApplyProtocol={handleApplyProtocol}
        onToggleMPR={handleToggleMPR}
        mprSourceImageIds={mprSourceImageIds}
        leftSlot={
          <>
            <XnatLogo className="w-7 h-7 shrink-0" />
            <div className="w-px h-5 bg-zinc-700 mx-0.5" />
            <ConnectionStatus />
            <div className="w-px h-5 bg-zinc-700 mx-0.5" />
            {/* Import — icon only */}
            <label className="flex items-center justify-center p-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white rounded cursor-pointer transition-colors" title="Import">
              <IconOpenFile className="w-3.5 h-3.5" />
              <input
                type="file"
                multiple
                accept=".dcm,.DCM"
                className="hidden"
                onChange={handleFileInput}
              />
            </label>
            {/* Export — icon only */}
            <ExportDropdown />
            {/* Bookmarks dropdown — always visible, greyed out when empty */}
            {(() => {
              const hasBookmarks = pinnedItems.length > 0 || recentSessions.length > 0;
              return (
                <div ref={bookmarksRef} className="relative">
                  <button
                    onClick={() => hasBookmarks && setShowBookmarks((v) => !v)}
                    className={`flex items-center gap-1 text-xs font-medium px-2 py-1.5 rounded whitespace-nowrap transition-colors ${
                      !hasBookmarks
                        ? 'bg-zinc-800 text-zinc-600 cursor-default'
                        : showBookmarks
                          ? 'bg-amber-600/20 text-amber-300'
                          : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                    }`}
                    title={hasBookmarks ? 'Pinned & Recent' : 'No pinned or recent items'}
                  >
                    <IconPin className="w-3.5 h-3.5" filled={pinnedItems.length > 0} />
                    <IconChevronDown className="w-3 h-3" />
                  </button>

                  {showBookmarks && hasBookmarks && (
                    <div className="absolute top-full left-0 mt-1 w-72 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl z-50 py-1 max-h-80 overflow-y-auto">
                      {/* Pinned items section */}
                      {pinnedItems.length > 0 && (
                        <>
                          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                            Pinned
                          </div>
                          {pinnedItems.map((item) => {
                            const key =
                              item.type === 'project' ? `pin-p-${item.projectId}` :
                              item.type === 'subject' ? `pin-s-${item.subjectId}` :
                              `pin-x-${item.sessionId}`;
                            const label =
                              item.type === 'project' ? item.projectName :
                              item.type === 'subject' ? `${item.subjectLabel || item.subjectId}` :
                              `${item.sessionLabel || item.sessionId}`;
                            const sublabel =
                              item.type === 'project' ? null :
                              item.type === 'subject' ? item.projectName :
                              `${item.subjectLabel || item.subjectId} / ${item.projectName}`;
                            const icon =
                              item.type === 'project' ? 'text-blue-400' :
                              item.type === 'subject' ? 'text-violet-400' :
                              'text-emerald-400';
                            const typeLabel =
                              item.type === 'project' ? 'P' :
                              item.type === 'subject' ? 'S' : 'E';

                            return (
                              <div
                                key={key}
                                className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800 cursor-pointer group"
                                onClick={() => {
                                  const target: NavigateToTarget = {
                                    type: item.type,
                                    projectId: item.projectId,
                                    projectName: item.projectName,
                                    ...(item.type !== 'project' && {
                                      subjectId: item.subjectId,
                                      subjectLabel: item.subjectLabel,
                                    }),
                                    ...(item.type === 'session' && {
                                      sessionId: item.sessionId,
                                      sessionLabel: item.sessionLabel,
                                    }),
                                  };
                                  handleBookmarkNavigate(target);
                                }}
                              >
                                <span className={`text-[10px] font-bold ${icon} shrink-0 w-4 text-center`}>
                                  {typeLabel}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs text-zinc-200 truncate">{label}</div>
                                  {sublabel && (
                                    <div className="text-[10px] text-zinc-500 truncate">{sublabel}</div>
                                  )}
                                </div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleTogglePin(item);
                                  }}
                                  className="text-zinc-500 hover:text-red-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                  title="Unpin"
                                >
                                  <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                                    <line x1="4" y1="4" x2="12" y2="12" />
                                    <line x1="12" y1="4" x2="4" y2="12" />
                                  </svg>
                                </button>
                              </div>
                            );
                          })}
                        </>
                      )}

                      {/* Recent sessions section */}
                      {recentSessions.length > 0 && (
                        <>
                          {pinnedItems.length > 0 && (
                            <div className="border-t border-zinc-800 my-1" />
                          )}
                          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                            Recent
                          </div>
                          {recentSessions.map((recent) => (
                            <div
                              key={`recent-${recent.sessionId}`}
                              className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800 cursor-pointer group"
                              onClick={() => {
                                handleBookmarkNavigate({
                                  type: 'session',
                                  projectId: recent.projectId,
                                  projectName: recent.projectName,
                                  subjectId: recent.subjectId,
                                  subjectLabel: recent.subjectLabel,
                                  sessionId: recent.sessionId,
                                  sessionLabel: recent.sessionLabel,
                                });
                              }}
                            >
                              <span className="text-[10px] font-bold text-emerald-400 shrink-0 w-4 text-center">
                                E
                              </span>
                              <div className="flex-1 min-w-0">
                                <div className="text-xs text-zinc-200 truncate">
                                  {recent.sessionLabel || recent.sessionId}
                                </div>
                                <div className="text-[10px] text-zinc-500 truncate">
                                  {recent.subjectLabel || recent.subjectId} / {recent.projectName || recent.projectId}
                                </div>
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handlePromoteRecent(recent);
                                }}
                                className="text-zinc-500 hover:text-amber-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Pin this session"
                              >
                                <IconPin className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
            {/* Status indicators */}
            {loading && (
              <span className="text-xs text-blue-400 animate-pulse flex items-center gap-1.5 ml-1">
                <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                  <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
                </svg>
              </span>
            )}
            {loadError && (
              <span className="text-xs text-red-400 truncate max-w-[120px] ml-1" title={loadError}>
                Error
              </span>
            )}
          </>
        }
        browserSlot={
          showBrowser ? (
            <>
              <div
                className="shrink-0 border-r border-zinc-800 bg-zinc-950 overflow-hidden flex flex-col"
                style={{ width: browserWidth }}
              >
                <XnatBrowser
                  onLoadScan={loadFromXnatScan}
                  onLoadSession={loadSessionFromXnat}
                  navigateTo={navigateTo}
                  onNavigateComplete={() => setNavigateTo(null)}
                  pinnedItems={pinnedItems}
                  onTogglePin={handleTogglePin}
                />
              </div>
              {/* Drag handle */}
              <div
                className="w-1 shrink-0 cursor-col-resize hover:bg-blue-500/40 active:bg-blue-500/60 transition-colors"
                onMouseDown={handleResizeStart}
              />
            </>
          ) : (
            /* Collapsed strip — click to reopen browser */
            <div
              className="w-3 shrink-0 bg-zinc-900 hover:bg-zinc-700 cursor-pointer transition-colors border-r border-zinc-800 flex items-center justify-center group"
              onClick={() => {
                setBrowserWidth(browserWidthRef.current);
                setShowBrowser(true);
              }}
              title="Open browser"
            >
              <svg className="w-2.5 h-5 text-zinc-600 group-hover:text-zinc-300 transition-colors" viewBox="0 0 10 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <line x1="3" y1="6" x2="7" y2="10" />
                <line x1="7" y1="10" x2="3" y2="14" />
              </svg>
            </div>
          )
        }
      />

      {/* Drag overlay */}
      {dragOver && (
        <div className="absolute inset-0 bg-blue-900/50 border-2 border-dashed border-blue-400 flex items-center justify-center z-50">
          <p className="text-blue-200 text-xl font-semibold">Drop DICOM files here</p>
        </div>
      )}
    </div>
  );
}
