/**
 * Metadata Store — holds DICOM overlay metadata per panel.
 *
 * Updated on each STACK_NEW_IMAGE event by the CornerstoneViewport component
 * via metadataService.getOverlayData(). Keyed by panelId (e.g. 'panel_0').
 */
import { create } from 'zustand';
import type { OverlayMetadata } from '@shared/types/dicom';
import { EMPTY_OVERLAY } from '@shared/types/dicom';

interface MetadataStore {
  overlays: Record<string, OverlayMetadata>;
  _updateOverlay: (panelId: string, data: OverlayMetadata) => void;
  _clearOverlay: (panelId: string) => void;
  _reset: () => void;
}

export const useMetadataStore = create<MetadataStore>((set) => ({
  overlays: {},

  _updateOverlay: (panelId, data) =>
    set((s) => ({
      overlays: { ...s.overlays, [panelId]: data },
    })),

  _clearOverlay: (panelId) =>
    set((s) => {
      const { [panelId]: _, ...rest } = s.overlays;
      return { overlays: rest };
    }),

  _reset: () => set({ overlays: {} }),
}));
