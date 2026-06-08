/**
 * Segment visibility + lock controls for segmentationService.
 *
 * Extracted verbatim from segmentationService.ts (P1.8e decomposition, pure
 * extraction — no logic change). These operations read/write Cornerstone3D's
 * per-viewport segment visibility + lock state (multi-layer-group aware) and
 * re-sync the Zustand store. They hold no module mutable state of their own.
 *
 * The two service-specific dependencies (syncSegmentations, the lock-query
 * helper) are injected via {@link createVisibilityControls}, matching the
 * dependency-injection convention of the other segmentationService/* modules.
 * The service delegates its public methods to the returned controls so its
 * public API is unchanged.
 */
import { getEnabledElementByViewportId } from '@cornerstonejs/core';
import {
  segmentation as csSegmentation,
  Enums as ToolEnums,
  utilities as csToolUtilities,
} from '@cornerstonejs/tools';
import * as mlg from '../multiLayerGroup';
import { useSegmentationStore } from '../../../stores/segmentationStore';
import { useSegmentationManagerStore } from '../../../stores/segmentationManagerStore';

export interface VisibilityDeps {
  /** Rebuild segmentation summaries and push to the store. */
  syncSegmentations(): void;
  /** Whether the given segment is locked (multi-layer group aware). */
  isSegmentLocked(segmentationId: string, segmentIndex: number): boolean;
}

export interface VisibilityControls {
  toggleSegmentVisibility(viewportId: string, segmentationId: string, segmentIndex: number): void;
  setSegmentVisibility(viewportId: string, segmentationId: string, segmentIndex: number, visible: boolean): void;
  toggleSegmentLocked(segmentationId: string, segmentIndex: number): void;
  getSegmentVisibility(viewportId: string, segmentationId: string, segmentIndex: number): boolean;
  getSegmentLocked(segmentationId: string, segmentIndex: number): boolean;
  isActiveSegmentLocked(): boolean;
}

export function createVisibilityControls(deps: VisibilityDeps): VisibilityControls {
  const isMultiLayerGroup = mlg.isMultiLayerGroup;
  const resolveSubSegId = mlg.resolveSubSegId;
  const { syncSegmentations } = deps;

  function toggleSegmentVisibility(
    viewportId: string,
    segmentationId: string,
    segmentIndex: number,
  ): void {
    // ─── Multi-layer group path ─────────────────────────────
    if (isMultiLayerGroup(segmentationId)) {
      const subSegId = resolveSubSegId(segmentationId, segmentIndex);
      if (!subSegId) return;
      // Read current visibility from sub-seg's segment index 1
      let currentVisible = true;
      const vpIds = csSegmentation.state.getViewportIdsWithSegmentation(subSegId);
      if (vpIds.length > 0) {
        try {
          currentVisible = csSegmentation.config.visibility.getSegmentIndexVisibility(
            vpIds[0],
            { segmentationId: subSegId, type: ToolEnums.SegmentationRepresentations.Labelmap },
            1,
          );
        } catch {
          // default visible
        }
      }
      const newVisible = !currentVisible;
      for (const vpId of vpIds) {
        try {
          csSegmentation.config.visibility.setSegmentIndexVisibility(
            vpId,
            { segmentationId: subSegId, type: ToolEnums.SegmentationRepresentations.Labelmap },
            1,
            newVisible,
          );
        } catch {
          // ignore
        }
      }
      syncSegmentations();
      for (const vpId of vpIds) {
        try {
          csToolUtilities.segmentation.triggerSegmentationRender(vpId);
          const enabledElement = getEnabledElementByViewportId(vpId) as any;
          enabledElement?.viewport?.render?.();
        } catch {
          // Best effort
        }
      }
      return;
    }

    // ─── Legacy path ────────────────────────────────────────
    let currentVisible = true;
    try {
      currentVisible = csSegmentation.config.visibility.getSegmentIndexVisibility(
        viewportId,
        { segmentationId, type: ToolEnums.SegmentationRepresentations.Labelmap },
        segmentIndex,
      );
    } catch {
      try {
        currentVisible = csSegmentation.config.visibility.getSegmentIndexVisibility(
          viewportId,
          { segmentationId, type: ToolEnums.SegmentationRepresentations.Contour },
          segmentIndex,
        );
      } catch {
        // default visible
      }
    }

    const newVisible = !currentVisible;

    try {
      csSegmentation.config.visibility.setSegmentIndexVisibility(
        viewportId,
        { segmentationId, type: ToolEnums.SegmentationRepresentations.Labelmap },
        segmentIndex,
        newVisible,
      );
    } catch {
      // May not have labelmap representation
    }

    try {
      csSegmentation.config.visibility.setSegmentIndexVisibility(
        viewportId,
        { segmentationId, type: ToolEnums.SegmentationRepresentations.Contour },
        segmentIndex,
        newVisible,
      );
    } catch {
      // May not have contour representation
    }

    syncSegmentations();
    try {
      csToolUtilities.segmentation.triggerSegmentationRender(viewportId);
      const enabledElement = getEnabledElementByViewportId(viewportId) as any;
      enabledElement?.viewport?.render?.();
    } catch {
      // Best effort render kick
    }
  }

  /**
   * Set visibility for an individual segment on a viewport.
   */
  function setSegmentVisibility(
    viewportId: string,
    segmentationId: string,
    segmentIndex: number,
    visible: boolean,
  ): void {
    // ─── Multi-layer group path ─────────────────────────────
    if (isMultiLayerGroup(segmentationId)) {
      const subSegId = resolveSubSegId(segmentationId, segmentIndex);
      if (!subSegId) return;
      const vpIds = csSegmentation.state.getViewportIdsWithSegmentation(subSegId);
      for (const vpId of vpIds) {
        try {
          csSegmentation.config.visibility.setSegmentIndexVisibility(
            vpId,
            { segmentationId: subSegId, type: ToolEnums.SegmentationRepresentations.Labelmap },
            1,
            visible,
          );
        } catch {
          // ignore
        }
      }
      syncSegmentations();
      for (const vpId of vpIds) {
        try {
          csToolUtilities.segmentation.triggerSegmentationRender(vpId);
          const enabledElement = getEnabledElementByViewportId(vpId) as any;
          enabledElement?.viewport?.render?.();
        } catch {
          // Best effort
        }
      }
      return;
    }

    // ─── Legacy path ────────────────────────────────────────
    try {
      csSegmentation.config.visibility.setSegmentIndexVisibility(
        viewportId,
        { segmentationId, type: ToolEnums.SegmentationRepresentations.Labelmap },
        segmentIndex,
        visible,
      );
    } catch {
      // May not have labelmap representation
    }

    try {
      csSegmentation.config.visibility.setSegmentIndexVisibility(
        viewportId,
        { segmentationId, type: ToolEnums.SegmentationRepresentations.Contour },
        segmentIndex,
        visible,
      );
    } catch {
      // May not have contour representation
    }

    syncSegmentations();
    try {
      csToolUtilities.segmentation.triggerSegmentationRender(viewportId);
      const enabledElement = getEnabledElementByViewportId(viewportId) as any;
      enabledElement?.viewport?.render?.();
    } catch {
      // Best effort render kick
    }
  }

  /**
   * Toggle lock for a segment (locked segments can't be painted over).
   */
  function toggleSegmentLocked(segmentationId: string, segmentIndex: number): void {
    // ─── Multi-layer group path ─────────────────────────────
    if (isMultiLayerGroup(segmentationId)) {
      const subSegId = resolveSubSegId(segmentationId, segmentIndex);
      if (!subSegId) return;
      const isLocked = csSegmentation.segmentLocking.isSegmentIndexLocked(subSegId, 1);
      const newLocked = !isLocked;
      csSegmentation.segmentLocking.setSegmentIndexLocked(subSegId, 1, newLocked);
      // Update metadata
      const meta = mlg.getSegmentMetaMap(segmentationId)?.get(segmentIndex);
      if (meta) meta.locked = newLocked;
      // Update presentation cache BEFORE sync so syncSegmentations reads the correct value
      useSegmentationManagerStore.getState().setPresentation(segmentationId, segmentIndex, { locked: newLocked });
      syncSegmentations();
      return;
    }

    // ─── Legacy path ────────────────────────────────────────
    const isLocked = csSegmentation.segmentLocking.isSegmentIndexLocked(
      segmentationId,
      segmentIndex,
    );
    const newLocked = !isLocked;
    csSegmentation.segmentLocking.setSegmentIndexLocked(
      segmentationId,
      segmentIndex,
      newLocked,
    );
    // Update presentation cache BEFORE sync so syncSegmentations reads the correct value
    useSegmentationManagerStore.getState().setPresentation(segmentationId, segmentIndex, { locked: newLocked });
    syncSegmentations();
  }

  /**
   * Read the current visibility state of a segment from Cornerstone.
   * Tries Labelmap representation first, then Contour. Defaults to true.
   */
  function getSegmentVisibility(
    viewportId: string,
    segmentationId: string,
    segmentIndex: number,
  ): boolean {
    if (isMultiLayerGroup(segmentationId)) {
      const subSegId = resolveSubSegId(segmentationId, segmentIndex);
      if (!subSegId) return true;
      const vpIds = csSegmentation.state.getViewportIdsWithSegmentation(subSegId);
      if (vpIds.length === 0) return true;
      try {
        return csSegmentation.config.visibility.getSegmentIndexVisibility(
          vpIds[0],
          { segmentationId: subSegId, type: ToolEnums.SegmentationRepresentations.Labelmap },
          1,
        );
      } catch {
        return true;
      }
    }

    try {
      return csSegmentation.config.visibility.getSegmentIndexVisibility(
        viewportId,
        { segmentationId, type: ToolEnums.SegmentationRepresentations.Labelmap },
        segmentIndex,
      );
    } catch {
      try {
        return csSegmentation.config.visibility.getSegmentIndexVisibility(
          viewportId,
          { segmentationId, type: ToolEnums.SegmentationRepresentations.Contour },
          segmentIndex,
        );
      } catch {
        return true; // default visible
      }
    }
  }

  /**
   * Read the current lock state of a segment from Cornerstone.
   */
  function getSegmentLocked(segmentationId: string, segmentIndex: number): boolean {
    return deps.isSegmentLocked(segmentationId, segmentIndex);
  }

  /**
   * Check whether the currently active segment is locked.
   * Returns true if the active segmentation + active segment index are locked.
   */
  function isActiveSegmentLocked(): boolean {
    const segStore = useSegmentationStore.getState();
    const activeSegId = segStore.activeSegmentationId;
    const activeSegIdx = segStore.activeSegmentIndex;
    if (!activeSegId || !activeSegIdx || activeSegIdx <= 0) return false;
    return getSegmentLocked(activeSegId, activeSegIdx);
  }

  return {
    toggleSegmentVisibility,
    setSegmentVisibility,
    toggleSegmentLocked,
    getSegmentVisibility,
    getSegmentLocked,
    isActiveSegmentLocked,
  };
}
