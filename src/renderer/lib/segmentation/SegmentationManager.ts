/**
 * SegmentationManager — single orchestrator for all segmentation side-effects.
 *
 * This is the ONLY module allowed to call segmentationService.addToViewport(),
 * segmentationService.loadDicomSeg(), segmentationService.removeSegmentationsFromViewport(),
 * csSegmentation.* activation calls, and autosave/temp actions.
 *
 * All segmentation UI interactions go through this manager as "intents"
 * (e.g., userChangedSegmentColor, requestShowOverlays). The manager owns
 * the epoch/cancellation logic, presentation state cache, dirty tracking,
 * and deterministic viewport readiness via viewportReadyService.
 */

import { viewportReadyService } from '../cornerstone/viewportReadyService';
import { segmentationService } from '../cornerstone/segmentationService';
import { rtStructService } from '../cornerstone/rtStructService';
import { useSegmentationManagerStore } from '../../stores/segmentationManagerStore';
import { useSegmentationStore } from '../../stores/segmentationStore';

/** Dependencies injected from App.tsx to avoid circular imports */
export interface ManagerDeps {
  setPanelImageIds: (panelId: string, imageIds: string[]) => void;
  getPanelImageIds: (panelId: string) => string[];
  preloadImages: (imageIds: string[]) => Promise<void>;
  downloadScanFile: (sessionId: string, scanId: string) => Promise<ArrayBuffer>;
  getScanImageIds: (sessionId: string, scanId: string) => Promise<string[]>;
}

export class SegmentationManager {
  private deps: ManagerDeps | null = null;
  private disposed = false;

  /**
   * Initialize the manager with injected dependencies. Call once after
   * Cornerstone services are initialized.
   */
  initialize(deps: ManagerDeps): void {
    this.deps = deps;
    this.disposed = false;
    console.log('[SegmentationManager] Initialized');
  }

  /**
   * Clean up subscriptions and state. Call on unmount.
   */
  dispose(): void {
    this.disposed = true;
    this.deps = null;
    useSegmentationManagerStore.getState().reset();
    console.log('[SegmentationManager] Disposed');
  }

  // ─── Panel lifecycle ──────────────────────────────────────────

  /**
   * Called when a panel's imageIds change (new source scan loaded).
   * Captures the epoch so all async operations can check for staleness.
   */
  onPanelImagesChanged(panelId: string, sourceScanId: string | null, epoch: number): void {
    useSegmentationManagerStore.getState().setPanelSourceScan(panelId, sourceScanId, epoch);
  }

  // ─── Viewport cleanup ──────────────────────────────────────────

  /**
   * Remove all segmentation representations from a viewport (detach only, not delete).
   * Called before loading new source images into a panel.
   */
  removeSegmentationsFromViewport(panelId: string): void {
    segmentationService.removeSegmentationsFromViewport(panelId);
  }

  // ─── Scan-click segmentation load helpers (Phase 6) ────────────

  /**
   * Load a DICOM SEG from a pre-downloaded ArrayBuffer and attach to a viewport.
   * Used by App.tsx for both the direct and deferred SEG load paths.
   *
   * Returns the segmentation ID so the caller can track XNAT origin, etc.
   */
  async loadSegFromArrayBuffer(
    panelId: string,
    arrayBuffer: ArrayBuffer,
    sourceImageIds: string[],
    options?: { label?: string; epoch?: number },
  ): Promise<{ segmentationId: string; firstNonZeroReferencedImageId: string | null }> {
    if (!this.deps) throw new Error('SegmentationManager not initialized');

    // Pre-load source images for metadata
    await this.deps.preloadImages(sourceImageIds);

    // Wait for viewport to be ready if epoch provided
    if (options?.epoch !== undefined) {
      await viewportReadyService.whenReady(panelId, options.epoch);
    }

    let segmentationId: string;
    let firstNonZeroReferencedImageId: string | null = null;

    segmentationService.beginSegLoad();
    try {
      const result = await segmentationService.loadDicomSeg(arrayBuffer, sourceImageIds);
      segmentationId = result.segmentationId;
      firstNonZeroReferencedImageId = result.firstNonZeroReferencedImageId;
      await segmentationService.addToViewport(panelId, segmentationId);
    } finally {
      segmentationService.endSegLoad();
    }

    // Override label if provided
    if (options?.label) {
      segmentationService.setLabel(segmentationId, options.label);
    }

    // Wait two rAF cycles for render pipeline to settle, then clean dirty state
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    useSegmentationStore.getState()._markClean();

    return { segmentationId, firstNonZeroReferencedImageId };
  }

  /**
   * Load a DICOM RTSTRUCT from a pre-downloaded ArrayBuffer and attach to a viewport.
   * Used by App.tsx for RTSTRUCT scan click path.
   */
  async loadRtStructFromArrayBuffer(
    panelId: string,
    arrayBuffer: ArrayBuffer,
    sourceImageIds: string[],
    options?: { label?: string; epoch?: number },
  ): Promise<{ segmentationId: string; firstReferencedImageId: string | null }> {
    if (!this.deps) throw new Error('SegmentationManager not initialized');

    // Pre-load source images for metadata
    await this.deps.preloadImages(sourceImageIds);

    // Wait for viewport to be ready if epoch provided
    if (options?.epoch !== undefined) {
      await viewportReadyService.whenReady(panelId, options.epoch);
    }

    segmentationService.beginSegLoad();
    let segmentationId: string;
    let firstReferencedImageId: string | null = null;
    try {
      const parsed = rtStructService.parseRtStruct(arrayBuffer);
      const result = await rtStructService.loadRtStructAsContours(parsed, sourceImageIds, panelId);
      segmentationId = result.segmentationId;
      firstReferencedImageId = result.firstReferencedImageId;
    } finally {
      segmentationService.endSegLoad();
    }

    // Override label if provided
    if (options?.label) {
      segmentationService.setLabel(segmentationId, options.label);
    }

    // Wait two rAF cycles for render pipeline to settle, then clean dirty state
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    useSegmentationStore.getState()._markClean();

    return { segmentationId, firstReferencedImageId };
  }

  /**
   * Check if a segmentation exists in Cornerstone state.
   */
  segmentationExists(segmentationId: string): boolean {
    return segmentationService.segmentationExists(segmentationId);
  }

  /**
   * Begin a SEG load transaction (blocks autosave).
   */
  beginSegLoad(): void {
    segmentationService.beginSegLoad();
  }

  /**
   * End a SEG load transaction (unblocks autosave).
   */
  endSegLoad(): void {
    segmentationService.endSegLoad();
  }

  // ─── Overlay management ─────────────────────────────────────────

  /**
   * Request that specific overlays be shown on a panel.
   * Manager handles: load if needed, await viewport ready, attach, reconcile.
   *
   * This is the core reconcile method. It:
   * 1. Captures the epoch to detect staleness
   * 2. Downloads + parses each overlay (SEG/RTSTRUCT) that isn't already loaded
   * 3. Awaits viewport readiness
   * 4. Attaches loaded overlays to the viewport
   * 5. Restores cached presentation state (colors, visibility, lock)
   * 6. Aborts silently if epoch becomes stale at any point
   */
  async requestShowOverlaysForSourceScan(
    panelId: string,
    sourceScanId: string,
    overlayDescriptors: Array<{ type: 'SEG' | 'RTSTRUCT'; scanId: string; sessionId: string; label?: string }>,
  ): Promise<void> {
    if (this.disposed || !this.deps) return;
    const deps = this.deps;
    const store = useSegmentationManagerStore.getState;

    // Capture epoch at start for staleness checks
    const epochAtStart = store().panelState[panelId]?.epoch ?? viewportReadyService.getEpoch(panelId);

    // Record desired overlays
    store().setDesiredOverlays(panelId, overlayDescriptors.map((d) => d.scanId));

    for (const descriptor of overlayDescriptors) {
      if (this.disposed || this.isEpochStale(panelId, epochAtStart)) return;

      const { type, scanId, sessionId, label } = descriptor;

      // Skip if already loaded for this source scan
      const loaded = store().loadedBySourceScan[sourceScanId]?.[scanId];
      if (loaded) {
        console.log(`[SegmentationManager] Overlay ${scanId} already loaded for source ${sourceScanId}`);
        continue;
      }

      // Skip if currently loading
      const status = store().loadStatus[scanId];
      if (status === 'loading') {
        console.log(`[SegmentationManager] Overlay ${scanId} is already loading — skipping`);
        continue;
      }

      store().setLoadStatus(scanId, 'loading');

      try {
        // Download the file
        const arrayBuffer = await deps.downloadScanFile(sessionId, scanId);
        if (this.disposed || this.isEpochStale(panelId, epochAtStart)) return;

        // Pre-load source images for metadata
        const sourceImageIds = deps.getPanelImageIds(panelId);
        await deps.preloadImages(sourceImageIds);
        if (this.disposed || this.isEpochStale(panelId, epochAtStart)) return;

        // Wait for viewport to be ready
        await viewportReadyService.whenReady(panelId, epochAtStart);
        if (this.disposed || this.isEpochStale(panelId, epochAtStart)) return;

        // Load + attach based on type
        let segmentationId: string;

        segmentationService.beginSegLoad();
        try {
          if (type === 'SEG') {
            const result = await segmentationService.loadDicomSeg(arrayBuffer, sourceImageIds);
            segmentationId = result.segmentationId;
            await segmentationService.addToViewport(panelId, segmentationId);
          } else {
            // RTSTRUCT
            const parsed = rtStructService.parseRtStruct(arrayBuffer);
            const result = await rtStructService.loadRtStructAsContours(parsed, sourceImageIds, panelId);
            segmentationId = result.segmentationId;
          }
        } finally {
          segmentationService.endSegLoad();
        }

        if (this.disposed || this.isEpochStale(panelId, epochAtStart)) return;

        // Override label if provided
        if (label) {
          segmentationService.setLabel(segmentationId, label);
        }

        // Record loaded
        store().recordLoaded(sourceScanId, scanId, {
          segmentationId,
          loadedAt: Date.now(),
        });
        store().setLoadStatus(scanId, 'loaded');

        // Restore cached presentation state if any
        this.restorePresentationState(segmentationId);

        // Wait two rAF cycles for render pipeline to settle, then clean dirty state
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        if (!this.disposed) {
          useSegmentationStore.getState()._markClean();
        }

        console.log(`[SegmentationManager] Loaded ${type} overlay ${scanId} → ${segmentationId} on ${panelId}`);
      } catch (err) {
        console.error(`[SegmentationManager] Failed to load overlay ${scanId}:`, err);
        store().setLoadStatus(scanId, 'error');
      }
    }
  }

  // ─── User interactions (intents from SegmentationPanel) ────────

  /**
   * User selected a segmentation in the panel — activate it on viewport.
   * Updates Cornerstone active segmentation + segment index, and ensures
   * the contour representation exists so contour tools keep working.
   */
  userSelectedSegmentation(
    viewportId: string,
    segmentationId: string,
    segmentIndex: number,
  ): void {
    useSegmentationStore.getState().setActiveSegmentation(segmentationId);
    segmentationService.setActiveSegmentIndex(segmentationId, segmentIndex);
    segmentationService.activateOnViewport(viewportId, segmentationId);
  }

  /**
   * User changed a segment's color via color picker.
   * Updates CS state + persists in managerStore presentation cache.
   */
  userChangedSegmentColor(
    segmentationId: string,
    segmentIndex: number,
    color: [number, number, number, number],
  ): void {
    // Update Cornerstone
    segmentationService.setSegmentColor(segmentationId, segmentIndex, color);

    // Cache in managerStore for preservation across viewport recreation
    useSegmentationManagerStore.getState().setPresentation(segmentationId, segmentIndex, { color });
  }

  /**
   * User toggled segment visibility.
   */
  userToggledVisibility(viewportId: string, segmentationId: string, segmentIndex: number): void {
    // Toggle in Cornerstone
    segmentationService.toggleSegmentVisibility(viewportId, segmentationId, segmentIndex);

    // Read current state and cache it
    // (toggleSegmentVisibility doesn't return the new state, so we infer it)
    const current = useSegmentationManagerStore.getState().presentation[segmentationId]?.visibility[segmentIndex];
    const newVisible = current === undefined ? false : !current;
    useSegmentationManagerStore.getState().setPresentation(segmentationId, segmentIndex, { visible: newVisible });
  }

  /**
   * User toggled segment lock.
   */
  userToggledLock(segmentationId: string, segmentIndex: number): void {
    segmentationService.toggleSegmentLocked(segmentationId, segmentIndex);

    const current = useSegmentationManagerStore.getState().presentation[segmentationId]?.locked[segmentIndex];
    const newLocked = current === undefined ? true : !current;
    useSegmentationManagerStore.getState().setPresentation(segmentationId, segmentIndex, { locked: newLocked });
  }

  /**
   * Create a new empty segmentation on the active panel.
   * Returns the new segmentation ID.
   */
  async createNewSegmentation(
    viewportId: string,
    sourceImageIds: string[],
    label?: string,
  ): Promise<string> {
    const segId = await segmentationService.createStackSegmentation(sourceImageIds, label);
    await segmentationService.addToViewport(viewportId, segId);
    return segId;
  }

  /**
   * Add a new segment to an existing segmentation.
   * Returns the new segment index.
   */
  addSegment(segmentationId: string, label: string): number {
    const nextIndex = segmentationService.addSegment(segmentationId, label);
    segmentationService.setActiveSegmentIndex(segmentationId, nextIndex);
    return nextIndex;
  }

  /**
   * Remove an entire segmentation from Cornerstone state.
   */
  removeSegmentation(segmentationId: string): void {
    segmentationService.removeSegmentation(segmentationId);
  }

  /**
   * Remove a single segment from a segmentation.
   */
  removeSegment(segmentationId: string, segmentIndex: number): void {
    segmentationService.removeSegment(segmentationId, segmentIndex);
  }

  /**
   * Rename a segmentation (the top-level label).
   */
  renameSegmentation(segmentationId: string, newLabel: string): void {
    segmentationService.renameSegmentation(segmentationId, newLabel);
  }

  /**
   * Rename an individual segment within a segmentation.
   */
  renameSegment(segmentationId: string, segmentIndex: number, newLabel: string): void {
    segmentationService.renameSegment(segmentationId, segmentIndex, newLabel);
  }

  /**
   * Export a segmentation as DICOM SEG (base64-encoded).
   */
  async exportToDicomSeg(segmentationId: string): Promise<string> {
    return segmentationService.exportToDicomSeg(segmentationId);
  }

  /**
   * Cancel any pending auto-save timer.
   */
  cancelAutoSave(): void {
    segmentationService.cancelAutoSave();
  }

  // ─── Dirty tracking ───────────────────────────────────────────

  /**
   * Mark a segmentation as dirty (has unsaved changes).
   * Called after brush paint or edit operations.
   */
  markDirty(segmentationId: string): void {
    useSegmentationManagerStore.getState().markDirty(segmentationId);
  }

  /**
   * Check if any segmentation has unsaved changes.
   */
  hasDirtySegmentations(): boolean {
    return useSegmentationManagerStore.getState().hasDirtySegmentations();
  }

  // ─── Internal helpers ─────────────────────────────────────────

  /**
   * Restore cached presentation state (colors, visibility, lock) to a
   * segmentation. Called after loading/attaching overlays to preserve
   * user customizations across viewport recreation.
   */
  private restorePresentationState(segmentationId: string): void {
    const cached = useSegmentationManagerStore.getState().presentation[segmentationId];
    if (!cached) return;

    // Restore colors
    for (const [idxStr, rgba] of Object.entries(cached.color)) {
      const idx = Number(idxStr);
      segmentationService.setSegmentColor(segmentationId, idx, rgba);
    }

    // Restore visibility — need viewport IDs to call toggleSegmentVisibility
    const viewportIds = segmentationService.getViewportIdsForSegmentation(segmentationId);
    for (const [idxStr, visible] of Object.entries(cached.visibility)) {
      if (!visible) {
        const idx = Number(idxStr);
        // toggleSegmentVisibility toggles, so only call if currently visible
        // and we want it hidden. Since we just loaded, segments default to visible.
        for (const vpId of viewportIds) {
          segmentationService.toggleSegmentVisibility(vpId, segmentationId, idx);
        }
      }
    }

    // Restore lock state
    for (const [idxStr, locked] of Object.entries(cached.locked)) {
      if (locked) {
        const idx = Number(idxStr);
        segmentationService.toggleSegmentLocked(segmentationId, idx);
      }
    }

    console.log(`[SegmentationManager] Restored presentation state for ${segmentationId}`);
  }

  /**
   * Check if an async operation's epoch is still current. If not, the
   * operation should abort silently.
   */
  private isEpochStale(panelId: string, epochAtStart: number): boolean {
    const current = viewportReadyService.getEpoch(panelId);
    if (epochAtStart < current) {
      console.debug(
        `[SegmentationManager] Stale epoch for ${panelId}: started at ${epochAtStart}, now ${current}`
      );
      return true;
    }
    return false;
  }
}
