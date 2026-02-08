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
import { IconFolder, IconOpenFile, XnatLogo } from './components/icons';
import { volumeService } from './lib/cornerstone/volumeService';
import { segmentationService } from './lib/cornerstone/segmentationService';
import { viewportService } from './lib/cornerstone/viewportService';
import { imageLoader, cache, metaData } from '@cornerstonejs/core';
import * as dicomParser from 'dicom-parser';

/** DICOM SEG SOP Class UID */
const SEG_SOP_CLASS_UID = '1.2.840.10008.5.1.4.1.1.66.4';

/** Check if a scan is a DICOM SEG scan based on XNAT type metadata */
function isSegScan(scan: XnatScan): boolean {
  return scan.type?.toUpperCase() === 'SEG';
}

/**
 * Extract the source scan ID from a SEG scan ID using the 30xx convention.
 * e.g., "3004" → "4", "3012" → "12", "3104" → "4" (prefix 31)
 * Returns null if the scan ID doesn't follow the convention.
 */
function getSourceScanId(segScanId: string): string | null {
  const match = segScanId.match(/^(\d{2,})(\d{2})$/);
  if (!match) return null;
  const prefix = parseInt(match[1], 10);
  if (prefix >= 30 && prefix < 100) return String(parseInt(match[2], 10));
  return null;
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
  // Only check non-SEG scans
  const candidates = scans.filter((s) => s.type?.toUpperCase() !== 'SEG');
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
  // Convert base64 → ArrayBuffer
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
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showBrowser, setShowBrowser] = useState(true);

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
  } | null>(null);

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

    // Separate DICOM SEG files from regular image files.
    // We peek at the SOP Class UID tag (0008,0016) in each file.
    const regularFiles: File[] = [];
    const segFiles: File[] = [];

    for (const file of dicomFiles) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const byteArray = new Uint8Array(arrayBuffer);
        // Parse just enough to read the SOP Class UID (stop before pixel data)
        const dataSet = dicomParser.parseDicom(byteArray, { untilTag: 'x7fe00010' });
        const sopClassUid = dataSet.string('x00080016');

        if (sopClassUid === SEG_SOP_CLASS_UID) {
          segFiles.push(file);
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
        : (panelImageIds[targetPanel] ?? []);

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
          const segId = await segmentationService.loadDicomSeg(arrayBuffer, sourceImageIds);
          await segmentationService.addToViewport(targetPanel, segId, true);
          console.log(`[App] Loaded DICOM SEG file "${file.name}" as ${segId}`);
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
  }, [panelImageIds]);

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
        const segId = await segmentationService.loadDicomSeg(
          pending.arrayBuffer,
          pending.sourceImageIds,
        );
        await segmentationService.addToViewport(pending.panelId, segId, true);
        console.log(`[App] Loaded deferred DICOM SEG as ${segId} on ${pending.panelId}`);

        // Open segmentation panel
        const segStore = useSegmentationStore.getState();
        if (!segStore.showPanel) segStore.togglePanel();
      } catch (err) {
        console.error('[App] Failed to load deferred DICOM SEG:', err);
      } finally {
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
    context: { projectId: string; subjectId: string; sessionLabel: string },
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
          const match = findPanelBySeriesUID(refSeriesUID, panelImageIds);
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

          console.log(`[App] Source scan #${foundScanId}: ${sourceIds.length} images`);
          // Clean up stale segmentations before loading new source images
          segmentationService.removeSegmentationsFromViewport(segTargetPanel);

          // Defer the SEG loading: store the pending load info and let the
          // useEffect process it after the viewport has been recreated with
          // the new source images. This prevents the race condition where
          // setPanelImageIds triggers viewport destruction that removes our
          // segmentation.
          console.log(`[App] Deferring SEG load until viewport settles with new source images`);
          pendingSegLoadRef.current = {
            panelId: segTargetPanel,
            arrayBuffer,
            sourceImageIds: sourceIds!,
          };

          setPanelImageIds((prev) => ({ ...prev, [segTargetPanel]: sourceIds! }));
          useViewerStore.getState().setPanelScan(segTargetPanel, foundScanId!);
          // Don't setLoading(false) here — the deferred useEffect will do it
          return;
        }

        // Source images are already loaded in the panel — load SEG directly.
        // 5. Pre-load source images so metadata is cached
        await preloadImages(sourceIds);

        // 6. Load the SEG as overlay
        const segId = await segmentationService.loadDicomSeg(arrayBuffer, sourceIds);
        await segmentationService.addToViewport(segTargetPanel, segId, true);
        console.log(`[App] Loaded DICOM SEG from XNAT as ${segId} on ${segTargetPanel}`);

        // 7. Open segmentation panel
        const segStore = useSegmentationStore.getState();
        if (!segStore.showPanel) segStore.togglePanel();
      } else {
        // ─── Regular scan: load as image stack ────────────────────
        // Clean up any stale segmentations on this viewport first
        segmentationService.removeSegmentationsFromViewport(targetPanel);

        const ids = await dicomwebLoader.getScanImageIds(sessionId, scanId);
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
  }, [isConnected]);

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
      context: { projectId: string; subjectId: string; sessionLabel: string },
    ) => {
      if (!isConnected) return;

      try {
        setLoading(true);
        setLoadError(null);

        // Separate SEG scans from imaging scans
        const imagingScans = scans.filter((s) => !isSegScan(s));
        const segScans = scans.filter((s) => isSegScan(s));

        if (segScans.length > 0) {
          console.log(`[App] Found ${segScans.length} SEG scan(s) — will auto-load as overlays`);
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

              const segId = await segmentationService.loadDicomSeg(arrayBuffer, matchedPanel.ids);
              await segmentationService.addToViewport(matchedPanel.pid, segId, true);
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
      } catch (err) {
        console.error('Session load failed:', err);
        setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [isConnected],
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
            <XnatBrowser onLoadScan={loadFromXnatScan} onLoadSession={loadSessionFromXnat} />
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
