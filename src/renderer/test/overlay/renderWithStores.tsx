import type { ReactElement } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { DEFAULT_PREFERENCES, type OverlayPreferences } from '@shared/types/preferences';
import { EMPTY_OVERLAY, type OverlayMetadata } from '@shared/types/dicom';
import { useMetadataStore } from '../../stores/metadataStore';
import { usePreferencesStore } from '../../stores/preferencesStore';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { useViewerStore } from '../../stores/viewerStore';

interface OverlayRenderSeed {
  panelId: string;
  metadata?: Partial<OverlayMetadata>;
  viewport?: Partial<{
    totalImages: number;
    imageIndex: number;
    requestedImageIndex: number | null;
    windowWidth: number;
    windowCenter: number;
    zoomPercent: number;
    rotation: number;
    flipH: boolean;
    flipV: boolean;
    invert: boolean;
    imageWidth: number;
    imageHeight: number;
  }>;
  panelImageIds?: string[];
  overlayPrefs?: Partial<OverlayPreferences>;
  legacyShowOverlay?: boolean;
  panelSubjectLabel?: string;
  panelSessionLabel?: string;
  panelScanId?: string;
}

function resetStores(): void {
  useMetadataStore.setState(useMetadataStore.getInitialState(), true);
  usePreferencesStore.setState(usePreferencesStore.getInitialState(), true);
  useSegmentationStore.setState(useSegmentationStore.getInitialState(), true);
  useViewerStore.setState(useViewerStore.getInitialState(), true);
}

export function renderWithOverlayStores(
  ui: ReactElement,
  seed: OverlayRenderSeed,
): RenderResult {
  resetStores();

  const basePrefs = usePreferencesStore.getState().preferences;
  usePreferencesStore.setState({
    ...usePreferencesStore.getState(),
    preferences: {
      ...basePrefs,
      overlay: {
        ...DEFAULT_PREFERENCES.overlay,
        ...basePrefs.overlay,
        ...(seed.overlayPrefs ?? {}),
      },
    },
  });

  useSegmentationStore.setState({
    ...useSegmentationStore.getState(),
    showViewportContextOverlay: seed.legacyShowOverlay ?? true,
  });

  useMetadataStore.setState({
    ...useMetadataStore.getState(),
    overlays: {
      [seed.panelId]: {
        ...EMPTY_OVERLAY,
        ...(seed.metadata ?? {}),
      },
    },
  });

  const viewer = useViewerStore.getState();
  useViewerStore.setState({
    ...viewer,
    viewports: {
      [seed.panelId]: {
        viewportId: seed.panelId,
        imageIndex: 0,
        requestedImageIndex: null,
        totalImages: 1,
        windowWidth: 400,
        windowCenter: 40,
        zoomPercent: 100,
        rotation: 0,
        flipH: false,
        flipV: false,
        invert: false,
        imageWidth: 512,
        imageHeight: 512,
        ...(seed.viewport ?? {}),
      },
    },
    panelImageIdsMap: {
      [seed.panelId]: seed.panelImageIds ?? ['wadouri:https://example.org/wado?objectUID=1.2.3'],
    },
    panelOrientationMap: {
      [seed.panelId]: 'STACK',
    },
    panelNativeOrientationMap: {
      [seed.panelId]: 'AXIAL',
    },
    panelSubjectLabelMap: {
      [seed.panelId]: seed.panelSubjectLabel ?? 'SUBJ-001',
    },
    panelSessionLabelMap: {
      [seed.panelId]: seed.panelSessionLabel ?? 'SESSION-1',
    },
    panelScanMap: {
      [seed.panelId]: seed.panelScanId ?? '7',
    },
  });

  return render(ui);
}
