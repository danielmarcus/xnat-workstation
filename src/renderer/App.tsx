import { useEffect, useState, useCallback, useRef } from 'react';
import { initCornerstone } from './lib/cornerstone/init';
import ViewerPage from './pages/ViewerPage';
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
import { IconFolder, IconOpenFile, IconPin, IconChevronDown, XnatLogo } from './components/icons';
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
import { segmentationService } from './lib/cornerstone/segmentationService';
import { rtStructService } from './lib/cornerstone/rtStructService';
import { viewportService } from './lib/cornerstone/viewportService';
import { imageLoader, cache, metaData } from '@cornerstonejs/core';
import * as dicomParser from 'dicom-parser';

/** DICOM SEG SOP Class UID */
const SEG_SOP_CLASS_UID = '1.2.840.10008.5.1.4.1.1.66.4';

/** DICOM RTSTRUCT SOP Class UID */
const RTSTRUCT_SOP_CLASS_UID = '1.2.840.10008.5.1.4.1.1.481.3';

/** Check if a scan is a DICOM SEG scan based on XNAT type metadata */
function isSegScan(scan: XnatScan): boolean {
  return scan.type?.toUpperCase() === 'SEG';
}

/** Check if a scan is a DICOM RTSTRUCT scan based on XNAT type metadata */
function isRtStructScan(scan: XnatScan): boolean {
  const t = scan.type?.toUpperCase();
  return t === 'RTSTRUCT' || t === 'RT';
}

/** Check if a scan is a derived object (SEG or RTSTRUCT) */
function isDerivedScan(scan: XnatScan): boolean {
  return isSegScan(scan) || isRtStructScan(scan);
}

/**
 * Extract the source scan ID from a SEG scan ID using the 30xx convention.
 * Supports prefixes 30-39 (e.g., "3004" → "4", "3012" → "12", "3104" → "4").
 * Returns null if the scan ID doesn't follow the convention.
 */
function getSourceScanId(segScanId: string): string | null {
  // Matches 30xx-39xx (manual SEG saves) and 50xx-59xx (legacy auto-saves)
  const match = segScanId.match(/^([35]\d)(\d{2})$/);
  if (!match) return null;
  const sourceId = parseInt(match[2], 10);
  if (sourceId === 0) return null; // scan ID "0" is not valid
  return String(sourceId);
}

/**
 * Check for auto-saved temp files on the XNAT session and prompt recovery.
 * Called after all scans are loaded in loadSessionFromXnat().
 */
async function checkForAutoSaveRecovery(
  sessionId: string,
  scanIdToPanelInfo: Map<string, { pid: string; ids: string[] }>,
): Promise<void> {
  try {
    const result = await window.electronAPI.xnat.listTempFiles(sessionId);
    if (!result.ok || !result.files || result.files.length === 0) return;

    // Find auto-save SEG files
    const autoSaveFiles = result.files.filter(
      (f) => f.name.startsWith('autosave_seg_') && f.name.endsWith('.dcm'),
    );
    if (autoSaveFiles.length === 0) return;

    for (const file of autoSaveFiles) {
      const match = file.name.match(/^autosave_seg_(.+)\.dcm$/);
      if (!match) continue;
      const sourceScanId = match[1];

      // Find the panel with the matching source scan loaded
      const panelInfo = scanIdToPanelInfo.get(sourceScanId);
      if (!panelInfo) {
        console.warn(`[App] Auto-save recovery: source scan #${sourceScanId} not loaded, skipping`);
        continue;
      }

      // Prompt the user
      const recover = window.confirm(
        `An auto-saved segmentation was found for scan #${sourceScanId}.\n\n` +
        `This may be from an editing session that was not saved.\n\n` +
        `Would you like to recover it?`,
      );

      if (recover) {
        try {
          const downloadResult = await window.electronAPI.xnat.downloadTempFile(
            sessionId, file.name,
          );
          if (!downloadResult.ok || !downloadResult.data) {
            console.error(`[App] Failed to download temp file: ${downloadResult.error}`);
            continue;
          }

          // Convert base64 → ArrayBuffer
          const binaryString = atob(downloadResult.data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          const arrayBuffer = bytes.buffer;

          // Pre-load source images
          await preloadImages(panelInfo.ids);

          // Load as segmentation overlay
          const { segmentationId, firstNonZeroReferencedImageId } =
            await segmentationService.loadDicomSeg(arrayBuffer, panelInfo.ids);
          await segmentationService.addToViewport(panelInfo.pid, segmentationId);
          await jumpViewportToReferencedImage(panelInfo.pid, firstNonZeroReferencedImageId);

          // No origin set — recovered segmentation will create a new scan on first manual save

          console.log(`[App] Recovered auto-save for scan #${sourceScanId} as ${segmentationId}`);

          const segStore = useSegmentationStore.getState();
          if (!segStore.showPanel) segStore.togglePanel();
        } catch (err) {
          console.error(`[App] Failed to load recovered auto-save for scan #${sourceScanId}:`, err);
        }
      } else {
        // User declined — offer to delete the temp file
        const deleteIt = window.confirm(
          `Delete the auto-saved file for scan #${sourceScanId}?`,
        );
        if (deleteIt) {
          await window.electronAPI.xnat.deleteTempFile(sessionId, file.name).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.error('[App] Auto-save recovery check failed:', err);
    // Non-fatal — don't block session loading
  }
}

/**
 * Parse a DICOM SEG ArrayBuffer and extract the Referenced Series Instance UID.
 * This tells us which source series the SEG was created from.
 */
function getReferencedSeriesUID(segArrayBuffer: ArrayBuffer): string | null {
  try {
    const byteArray = new Uint8Array(segArrayBuffer);
    const dataSet = dicomParser.parseDicom(byteArray);

    // Method 1: ReferencedSeriesSequence (0008,1115) → SeriesInstanceUID (0020,000E)
    const refSeriesSeq = dataSet.elements['x00081115'];
    if (refSeriesSeq?.items?.length) {
      const uid = refSeriesSeq.items[0].dataSet?.string('x0020000e');
      if (uid) {
        console.log(`[App] SEG ReferencedSeriesSequence → SeriesInstanceUID: ${uid}`);
        return uid;
      }
    }

    // Method 2: ReferencedFrameOfReferenceSequence (3006,0010) →
    //   RTReferencedStudySequence (3006,0012) →
    //   RTReferencedSeriesSequence (3006,0014) → SeriesInstanceUID (0020,000E)
    const refFrameSeq = dataSet.elements['x30060010'];
    if (refFrameSeq?.items?.length) {
      const studySeq = refFrameSeq.items[0].dataSet?.elements['x30060012'];
      if (studySeq?.items?.length) {
        const seriesSeq = studySeq.items[0].dataSet?.elements['x30060014'];
        if (seriesSeq?.items?.length) {
          const uid = seriesSeq.items[0].dataSet?.string('x0020000e');
          if (uid) {
            console.log(`[App] SEG ReferencedFrameOfReferenceSequence → SeriesInstanceUID: ${uid}`);
            return uid;
          }
        }
      }
    }

    // Method 3: Check the SEG's own SeriesInstanceUID as a last resort
    // (this is the SEG's series, not the source, but log it for debugging)
    const ownSeriesUID = dataSet.string('x0020000e');
    console.log(`[App] SEG own SeriesInstanceUID: ${ownSeriesUID || 'not found'}`);

    // Log available top-level sequence tags for debugging
    const seqTags = Object.keys(dataSet.elements).filter(
      (k) => dataSet.elements[k].items && dataSet.elements[k].items!.length > 0
    );
    console.log(`[App] SEG sequence tags: ${seqTags.join(', ')}`);

    return null;
  } catch (err) {
    console.warn('[App] Failed to parse SEG DICOM header:', err);
    return null;
  }
}

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

      // Load just the first image to get its metadata
      if (!cache.getImageLoadObject(ids[0])) {
        await imageLoader.loadAndCacheImage(ids[0]);
      }

      const seriesMeta = metaData.get('generalSeriesModule', ids[0]) as
        | { seriesInstanceUID?: string } | undefined;

      if (seriesMeta?.seriesInstanceUID === targetSeriesUID) {
        console.log(`[App] Found matching source: scan #${scan.id} (${ids.length} images)`);
        return { scanId: scan.id, imageIds: ids };
      }
    } catch (err) {
      console.warn(`[App] Failed to probe scan #${scan.id}:`, err);
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

  // Wait for viewport to exist and have stack imageIds
  for (let attempts = 0; attempts < 40; attempts++) {
    const vp = viewportService.getViewport(panelId);
    if (vp && vp.getImageIds().length > 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }

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
 * App — Root component for XNAT Viewer.
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
  const [panelImageIds, setPanelImageIds] = useState<Record<string, string[]>>({});
  /** Always-current ref to panelImageIds — avoids stale closures in callbacks
   *  that only depend on [isConnected]. */
  const panelImageIdsRef = useRef(panelImageIds);
  panelImageIdsRef.current = panelImageIds;

  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showBrowser, setShowBrowser] = useState(true);

  // ─── Bookmarks (pinned items & recent sessions) ───────────────
  const [pinnedItems, setPinnedItems] = useState<PinnedItem[]>([]);
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([]);
  const [navigateTo, setNavigateTo] = useState<NavigateToTarget | null>(null);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const bookmarksRef = useRef<HTMLDivElement>(null);

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

  /** Count total loaded images across all panels */
  const totalImages = Object.values(panelImageIds).reduce((sum, ids) => sum + ids.length, 0);

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

    // Sort files by name for consistent ordering
    dicomFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

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
      console.log(`Loaded ${newImageIds.length} DICOM image files into ${targetPanel}`);
      setPanelImageIds((prev) => ({ ...prev, [targetPanel]: newImageIds }));
    }

    // Load DICOM SEG files as segmentation overlays
    if (segFiles.length > 0) {
      // Determine source image IDs — use freshly loaded IDs if we just loaded
      // images in the same drop, otherwise fall back to existing panel images.
      const sourceImageIds = newImageIds.length > 0
        ? newImageIds
        : (panelImageIdsRef.current[targetPanel] ?? []);

      if (sourceImageIds.length === 0) {
        console.warn('[App] Cannot load DICOM SEG — no source images loaded in active panel');
        return;
      }

      // Small delay to let Cornerstone register the source images (if loaded together)
      if (newImageIds.length > 0) {
        await new Promise((r) => setTimeout(r, 200));
      }

      for (const file of segFiles) {
        try {
          const arrayBuffer = await file.arrayBuffer();
          const { segmentationId, firstNonZeroReferencedImageId } =
            await segmentationService.loadDicomSeg(arrayBuffer, sourceImageIds);
          await segmentationService.addToViewport(targetPanel, segmentationId);
          await jumpViewportToReferencedImage(targetPanel, firstNonZeroReferencedImageId);
          console.log(`[App] Loaded DICOM SEG file "${file.name}" as ${segmentationId}`);
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

      // Pre-load source images for metadata
      await preloadImages(sourceImageIds);

      for (const file of rtStructFiles) {
        try {
          const arrayBuffer = await file.arrayBuffer();
          const parsed = rtStructService.parseRtStruct(arrayBuffer);
          const { segmentationId, firstReferencedImageId } =
            await rtStructService.loadRtStructAsContours(parsed, sourceImageIds, targetPanel);
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
        // Wait for the viewport to be fully created and have images loaded
        let attempts = 0;
        while (attempts < 40) {
          const vp = viewportService.getViewport(pending.panelId);
          if (vp && vp.getImageIds().length > 0) break;
          await new Promise((r) => setTimeout(r, 100));
          attempts++;
        }

        // Additional settling time for the rendering pipeline
        await new Promise((r) => setTimeout(r, 300));

        // Pre-load source images (may already be cached)
        await preloadImages(pending.sourceImageIds);

        // Load the SEG
        const { segmentationId, firstNonZeroReferencedImageId } =
          await segmentationService.loadDicomSeg(
            pending.arrayBuffer,
            pending.sourceImageIds,
          );
        await segmentationService.addToViewport(pending.panelId, segmentationId);
        await jumpViewportToReferencedImage(pending.panelId, firstNonZeroReferencedImageId);
        console.log(`[App] Loaded deferred DICOM SEG as ${segmentationId} on ${pending.panelId}`);

        // Track XNAT origin for overwrite-on-save
        if (pending.xnatScanId && pending.sourceScanId) {
          useSegmentationStore.getState().setXnatOrigin(segmentationId, {
            scanId: pending.xnatScanId,
            sourceScanId: pending.sourceScanId,
          });
        }

        // Open segmentation panel
        const segStore = useSegmentationStore.getState();
        if (!segStore.showPanel) segStore.togglePanel();
      } catch (err) {
        console.error('[App] Failed to load deferred DICOM SEG:', err);
      } finally {
        segLoadingPanelRef.current = null;
        setLoading(false);
      }
    };

    loadSeg();
  }, [panelImageIds]);

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

    const targetPanel = useViewerStore.getState().activeViewportId;

    // Ensure XNAT upload context is set (used by SegmentationPanel "Save to XNAT")
    useViewerStore.getState().setXnatContext({
      projectId: context.projectId,
      subjectId: context.subjectId,
      sessionId,
      sessionLabel: context.sessionLabel,
      scanId,
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

        // 1. Download the SEG file first so we can inspect its metadata
        const arrayBuffer = await downloadSegArrayBuffer(sessionId, scanId);
        console.log(`[App] Downloaded SEG file (${arrayBuffer.byteLength} bytes)`);

        // 2. Parse the SEG to find which series it references
        const refSeriesUID = getReferencedSeriesUID(arrayBuffer);

        // 3. Check if matching source images are already loaded in a panel
        let sourceIds: string[] | null = null;
        let segTargetPanel = targetPanel;

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
              }
            }
          }

          // 4b. Fallback to scan ID convention
          if (!sourceIds) {
            foundScanId = getSourceScanId(scanId);
            if (!foundScanId) {
              setLoadError(`Cannot determine source scan for SEG scan #${scanId}`);
              return;
            }
            console.log(`[App] Falling back to scan ID convention: source scan #${foundScanId}`);
            sourceIds = await dicomwebLoader.getScanImageIds(sessionId, foundScanId);
          }

          // At this point sourceIds and foundScanId are guaranteed non-null
          // (either from findSourceScanBySeriesUID or getSourceScanId fallback).
          const resolvedSourceIds = sourceIds;
          const resolvedScanId = foundScanId ?? scanId;

          console.log(`[App] Source scan #${resolvedScanId}: ${resolvedSourceIds.length} images`);
          // Clean up stale segmentations before loading new source images
          segmentationService.removeSegmentationsFromViewport(segTargetPanel);

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
          };
          // Mark panel as having a SEG load in progress BEFORE triggering
          // any React re-renders or viewport recreation. This prevents
          // concurrent regular scan loads from clobbering the segmentation.
          segLoadingPanelRef.current = segTargetPanel;

          setPanelImageIds((prev) => ({ ...prev, [segTargetPanel]: resolvedSourceIds }));
          useViewerStore.getState().setPanelScan(segTargetPanel, resolvedScanId);
          // Don't setLoading(false) here — the deferred useEffect will do it
          return;
        }

        // Source images are already loaded in the panel — load SEG directly.
        // 5. Pre-load source images so metadata is cached
        await preloadImages(sourceIds);

        // 6. Load the SEG as overlay
        const { segmentationId, firstNonZeroReferencedImageId } =
          await segmentationService.loadDicomSeg(arrayBuffer, sourceIds);
        await segmentationService.addToViewport(segTargetPanel, segmentationId);
        await jumpViewportToReferencedImage(segTargetPanel, firstNonZeroReferencedImageId);
        console.log(`[App] Loaded DICOM SEG from XNAT as ${segmentationId} on ${segTargetPanel}`);

        // Track XNAT origin for overwrite-on-save
        const directSourceScanId = getSourceScanId(scanId);
        if (directSourceScanId) {
          useSegmentationStore.getState().setXnatOrigin(segmentationId, {
            scanId,
            sourceScanId: directSourceScanId,
          });
        }

        // 7. Open segmentation panel
        const segStore = useSegmentationStore.getState();
        if (!segStore.showPanel) segStore.togglePanel();
      } else if (isRtStructScan(scan)) {
        // ─── RTSTRUCT scan: load contours as segmentation overlay ──

        // 1. Download the RTSTRUCT file
        const arrayBuffer = await downloadSegArrayBuffer(sessionId, scanId);
        console.log(`[App] Downloaded RTSTRUCT file (${arrayBuffer.byteLength} bytes)`);

        // 2. Parse the RTSTRUCT
        const parsed = rtStructService.parseRtStruct(arrayBuffer);

        // 3. Find source images
        let sourceIds: string[] | null = null;
        let rtTargetPanel = targetPanel;

        if (parsed.referencedSeriesUID) {
          const match = findPanelBySeriesUID(parsed.referencedSeriesUID, panelImageIdsRef.current);
          if (match) {
            console.log(`[App] RTSTRUCT matched to ${match.panelId} via SeriesInstanceUID`);
            sourceIds = match.imageIds;
            rtTargetPanel = match.panelId;
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
                // Load source images into panel, then load RTSTRUCT after settling
                segmentationService.removeSegmentationsFromViewport(rtTargetPanel);
                setPanelImageIds((prev) => ({ ...prev, [rtTargetPanel]: sourceIds! }));
                useViewerStore.getState().setPanelScan(rtTargetPanel, match.scanId);

                // Wait for viewport to settle
                let attempts = 0;
                while (attempts < 40) {
                  const vp = viewportService.getViewport(rtTargetPanel);
                  if (vp && vp.getImageIds().length > 0) break;
                  await new Promise((r) => setTimeout(r, 100));
                  attempts++;
                }
                await new Promise((r) => setTimeout(r, 300));
              }
            }
          }

          if (!sourceIds) {
            setLoadError(`Cannot find source images for RTSTRUCT scan #${scanId}`);
            return;
          }
        }

        // 5. Pre-load source images for metadata
        await preloadImages(sourceIds);

        // 6. Load the RTSTRUCT as contour segmentation
        const { segmentationId, firstReferencedImageId } =
          await rtStructService.loadRtStructAsContours(parsed, sourceIds, rtTargetPanel);
        await jumpViewportToReferencedImage(rtTargetPanel, firstReferencedImageId);
        console.log(`[App] Loaded RTSTRUCT from XNAT as ${segmentationId} on ${rtTargetPanel}`);

        // 7. Open segmentation panel
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

        // Clean up any stale segmentations on this viewport first
        segmentationService.removeSegmentationsFromViewport(targetPanel);

        const ids = await dicomwebLoader.getScanImageIds(sessionId, scanId);

        // Re-check after async: a deferred SEG load may have started while
        // we were fetching image IDs
        if (pendingSegLoadRef.current?.panelId === targetPanel ||
            segLoadingPanelRef.current === targetPanel) {
          console.log(`[App] Skipping regular scan load — SEG load started for ${targetPanel}`);
          return;
        }

        console.log(`Loaded ${ids.length} images from XNAT into ${targetPanel}`);
        setPanelImageIds((prev) => ({ ...prev, [targetPanel]: ids }));
        useViewerStore.getState().setPanelScan(targetPanel, scanId);
      }
    } catch (err) {
      console.error('Scan load failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('different geometry dimensions')) {
        setLoadError(
          `SEG scan #${scanId} has a geometry mismatch with its source scan. ` +
          `This can happen if the scan numbering convention doesn't match. ` +
          `Try loading the correct source scan first, then load the SEG.`
        );
      } else {
        setLoadError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [isConnected, refreshBookmarks]);

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

        // Set XNAT upload context so "Save to XNAT" works in SegmentationPanel
        store.setXnatContext({
          projectId: context.projectId,
          subjectId: context.subjectId,
          sessionId,
          sessionLabel: context.sessionLabel,
          scanId: imagingScans[0]?.id ?? scans[0]?.id ?? '1',
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

        // Fetch imageIds for all assigned panels in parallel
        const loadPromises = Array.from(assignments.entries()).map(
          async ([panelIdx, scan]) => {
            const ids = await dicomwebLoader.getScanImageIds(sessionId, scan.id);
            return { panelIdx, ids, scanId: scan.id };
          }
        );
        const results = await Promise.all(loadPromises);

        // Clean up all existing segmentations from panels we're about to load into
        for (const { panelIdx } of results) {
          segmentationService.removeSegmentationsFromViewport(panelId(panelIdx));
        }

        // Build new panelImageIds map and track scanId→panelId+imageIds mapping
        const newPanelImageIds: Record<string, string[]> = {};
        const scanIdToPanelInfo = new Map<string, { pid: string; ids: string[] }>();

        for (const { panelIdx, ids, scanId } of results) {
          const pid = panelId(panelIdx);
          newPanelImageIds[pid] = ids;
          scanIdToPanelInfo.set(scanId, { pid, ids });
          store.setPanelScan(pid, scanId);
          console.log(`  Panel ${panelIdx} (${pid}): scan #${scanId} → ${ids.length} images`);
        }

        setPanelImageIds(newPanelImageIds);

        // ─── Auto-load SEG scans as overlays ────────────────────────
        if (segScans.length > 0) {
          // Wait for viewports to be fully created after setPanelImageIds.
          // The React re-render destroys and recreates CornerstoneViewport
          // components, so we need to wait for them to settle.
          let attempts = 0;
          while (attempts < 40) {
            const allReady = results.every(({ panelIdx }) => {
              const vp = viewportService.getViewport(panelId(panelIdx));
              return vp && vp.getImageIds().length > 0;
            });
            if (allReady) break;
            await new Promise((r) => setTimeout(r, 100));
            attempts++;
          }
          // Additional settling time
          await new Promise((r) => setTimeout(r, 300));

          // Pre-load all source images so their metadata is cached
          const allImageIds = Array.from(scanIdToPanelInfo.values()).flatMap((p) => p.ids);
          await preloadImages(allImageIds);

          let segLoaded = false;

          for (const segScan of segScans) {
            try {
              // Download the SEG file
              const arrayBuffer = await downloadSegArrayBuffer(sessionId, segScan.id);
              console.log(`[App] Downloaded SEG #${segScan.id} (${arrayBuffer.byteLength} bytes)`);

              // Try matching via Referenced Series UID first
              const refSeriesUID = getReferencedSeriesUID(arrayBuffer);
              let matchedPanel: { pid: string; ids: string[] } | null = null;

              if (refSeriesUID) {
                const match = findPanelBySeriesUID(refSeriesUID, newPanelImageIds);
                if (match) {
                  matchedPanel = { pid: match.panelId, ids: match.imageIds };
                  console.log(`[App] SEG #${segScan.id} matched to ${match.panelId} via SeriesInstanceUID`);
                }
              }

              // Fallback to scan ID convention
              if (!matchedPanel) {
                const sourceScanId = getSourceScanId(segScan.id);
                if (sourceScanId) {
                  const panelInfo = scanIdToPanelInfo.get(sourceScanId);
                  if (panelInfo) {
                    matchedPanel = panelInfo;
                    console.log(`[App] SEG #${segScan.id} matched to ${panelInfo.pid} via scan ID convention (source: ${sourceScanId})`);
                  }
                }
              }

              if (!matchedPanel) {
                console.warn(`[App] Could not find source scan for SEG #${segScan.id}, skipping`);
                continue;
              }

              const { segmentationId, firstNonZeroReferencedImageId } =
                await segmentationService.loadDicomSeg(arrayBuffer, matchedPanel.ids);
              await segmentationService.addToViewport(matchedPanel.pid, segmentationId);
              await jumpViewportToReferencedImage(matchedPanel.pid, firstNonZeroReferencedImageId);

              // Track XNAT origin for overwrite-on-save
              const segSourceScanId = getSourceScanId(segScan.id);
              if (segSourceScanId) {
                useSegmentationStore.getState().setXnatOrigin(segmentationId, {
                  scanId: segScan.id,
                  sourceScanId: segSourceScanId,
                });
              }

              segLoaded = true;
            } catch (err) {
              console.error(`[App] Failed to load SEG #${segScan.id}:`, err);
            }
          }

          if (segLoaded) {
            const segStore = useSegmentationStore.getState();
            if (!segStore.showPanel) segStore.togglePanel();
          }
        }

        // ─── Auto-load RTSTRUCT scans as contour overlays ──────────
        if (rtStructScans.length > 0) {
          // Wait for viewports to be ready (may already be ready from SEG loading above)
          if (segScans.length === 0) {
            let attempts = 0;
            while (attempts < 40) {
              const allReady = results.every(({ panelIdx }) => {
                const vp = viewportService.getViewport(panelId(panelIdx));
                return vp && vp.getImageIds().length > 0;
              });
              if (allReady) break;
              await new Promise((r) => setTimeout(r, 100));
              attempts++;
            }
            await new Promise((r) => setTimeout(r, 300));

            // Pre-load all source images
            const allImageIds = Array.from(scanIdToPanelInfo.values()).flatMap((p) => p.ids);
            await preloadImages(allImageIds);
          }

          let rtLoaded = false;

          for (const rtScan of rtStructScans) {
            try {
              // Download the RTSTRUCT file
              const arrayBuffer = await downloadSegArrayBuffer(sessionId, rtScan.id);
              console.log(`[App] Downloaded RTSTRUCT #${rtScan.id} (${arrayBuffer.byteLength} bytes)`);

              // Parse the RTSTRUCT
              const parsed = rtStructService.parseRtStruct(arrayBuffer);

              // Match to a loaded panel via Referenced Series UID
              let matchedPanel: { pid: string; ids: string[] } | null = null;
              if (parsed.referencedSeriesUID) {
                const match = findPanelBySeriesUID(parsed.referencedSeriesUID, newPanelImageIds);
                if (match) {
                  matchedPanel = { pid: match.panelId, ids: match.imageIds };
                  console.log(`[App] RTSTRUCT #${rtScan.id} matched to ${match.panelId} via SeriesInstanceUID`);
                }
              }

              // Fallback: use the first panel with images
              if (!matchedPanel) {
                const firstEntry = Object.entries(newPanelImageIds).find(([, ids]) => ids.length > 0);
                if (firstEntry) {
                  matchedPanel = { pid: firstEntry[0], ids: firstEntry[1] };
                  console.log(`[App] RTSTRUCT #${rtScan.id} falling back to first panel: ${firstEntry[0]}`);
                }
              }

              if (!matchedPanel) {
                console.warn(`[App] Could not find source images for RTSTRUCT #${rtScan.id}, skipping`);
                continue;
              }

              // Pre-load source images
              await preloadImages(matchedPanel.ids);

              const { segmentationId, firstReferencedImageId } =
                await rtStructService.loadRtStructAsContours(parsed, matchedPanel.ids, matchedPanel.pid);
              await jumpViewportToReferencedImage(matchedPanel.pid, firstReferencedImageId);
              rtLoaded = true;
            } catch (err) {
              console.error(`[App] Failed to load RTSTRUCT #${rtScan.id}:`, err);
            }
          }

          if (rtLoaded) {
            const segStore = useSegmentationStore.getState();
            if (!segStore.showPanel) segStore.togglePanel();
          }
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
    [isConnected, refreshBookmarks],
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
            const ids = await dicomwebLoader.getScanImageIds(storedSessionId, scan.id);
            return { panelIdx, ids };
          }
        );
        const results = await Promise.all(loadPromises);

        // Clean up segmentations from panels that are about to be replaced
        for (const { panelIdx } of results) {
          segmentationService.removeSegmentationsFromViewport(panelId(panelIdx));
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

      if (e.dataTransfer.files.length > 0) {
        loadLocalFiles(e.dataTransfer.files);
      }
    },
    [loadLocalFiles]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
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
      className="h-full flex flex-col"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* Header bar — always visible */}
      <div className="bg-zinc-900 border-b border-zinc-800 flex items-center px-3 gap-2 shrink-0 h-10">
        <XnatLogo className="w-7 h-7 shrink-0" />

        <div className="w-px h-5 bg-zinc-700" />

        {/* Connection status */}
        <ConnectionStatus />

        <div className="w-px h-5 bg-zinc-700" />

        {/* Browse XNAT toggle */}
        <button
          onClick={() => setShowBrowser((v) => !v)}
          className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded whitespace-nowrap transition-colors ${
            showBrowser
              ? 'bg-blue-600 text-white'
              : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white'
          }`}
        >
          <IconFolder className="w-3.5 h-3.5" />
          {showBrowser ? 'Hide Browser' : 'Browse XNAT'}
        </button>

        {/* Local file picker */}
        <label className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-xs font-medium px-2.5 py-1.5 rounded cursor-pointer whitespace-nowrap transition-colors">
          <IconOpenFile className="w-3.5 h-3.5" />
          Open Files
          <input
            type="file"
            multiple
            accept=".dcm,.DCM"
            className="hidden"
            onChange={handleFileInput}
          />
        </label>

        {/* Bookmarks dropdown — pinned items & recent sessions */}
        {(pinnedItems.length > 0 || recentSessions.length > 0) && (
          <div ref={bookmarksRef} className="relative">
            <button
              onClick={() => setShowBookmarks((v) => !v)}
              className={`flex items-center gap-1 text-xs font-medium px-2 py-1.5 rounded whitespace-nowrap transition-colors ${
                showBookmarks
                  ? 'bg-amber-600/20 text-amber-300'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
              }`}
              title="Pinned & Recent"
            >
              <IconPin className="w-3.5 h-3.5" filled={pinnedItems.length > 0} />
              <IconChevronDown className="w-3 h-3" />
            </button>

            {showBookmarks && (
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
        )}

        {/* Spacer pushes status info to the right */}
        <div className="flex-1" />

        {/* Loading / image count / error indicators */}
        {loading && (
          <span className="text-xs text-blue-400 animate-pulse flex items-center gap-1.5">
            <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
              <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
            </svg>
            Loading...
          </span>
        )}
        {totalImages > 0 && !loading && (
          <span className="text-[11px] text-zinc-500 tabular-nums">
            {totalImages} image{totalImages !== 1 ? 's' : ''}
          </span>
        )}
        {loadError && (
          <span className="text-xs text-red-400 truncate max-w-xs" title={loadError}>
            {loadError}
          </span>
        )}

        {/* Active panel indicator */}
        <div className="w-px h-5 bg-zinc-700" />
        <span className="text-[11px] text-zinc-500 tabular-nums">
          {activeViewportId.replace('panel_', 'Panel ')}
        </span>
      </div>

      {/* Main content: optional browser sidebar + viewer */}
      <div className="flex-1 min-h-0 flex relative">
        {/* XNAT Browser sidebar */}
        {showBrowser && (
          <div className="w-72 shrink-0 border-r border-zinc-800 bg-zinc-950 overflow-hidden flex flex-col">
            <XnatBrowser
              onLoadScan={loadFromXnatScan}
              onLoadSession={loadSessionFromXnat}
              navigateTo={navigateTo}
              onNavigateComplete={() => setNavigateTo(null)}
              pinnedItems={pinnedItems}
              onTogglePin={handleTogglePin}
            />
          </div>
        )}

        {/* Viewer area — always show ViewerPage (grid handles empty panels) */}
        <div className="flex-1 min-w-0 relative">
          <ViewerPage
            panelImageIds={panelImageIds}
            onApplyProtocol={handleApplyProtocol}
            onToggleMPR={handleToggleMPR}
            mprSourceImageIds={mprSourceImageIds}
          />

          {/* Drag overlay */}
          {dragOver && (
            <div className="absolute inset-0 bg-blue-900/50 border-2 border-dashed border-blue-400 flex items-center justify-center z-50">
              <p className="text-blue-200 text-xl font-semibold">Drop DICOM files here</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
