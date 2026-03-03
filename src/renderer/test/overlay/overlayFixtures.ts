import type { OverlayMetadata } from '@shared/types/dicom';
import type { OverlayPreferences } from '@shared/types/preferences';

export const OVERLAY_TEST_PANEL_ID = 'panel_0';

export const OVERLAY_METADATA_FIXTURE: OverlayMetadata = {
  patientName: 'DOE^JANE',
  patientId: 'P12345',
  studyDate: '2026-03-03',
  institutionName: 'Embark Imaging',
  seriesDescription: 'CT Chest',
  seriesNumber: '12',
  sliceLocation: '42.5',
  sliceThickness: '1.0',
  rows: 512,
  columns: 512,
};

export const OVERLAY_PREFS_ALL_ON: Partial<OverlayPreferences> = {
  showViewportContextOverlay: true,
  showHorizontalRuler: true,
  showVerticalRuler: true,
  showOrientationMarkers: true,
};

export const OVERLAY_PREFS_ALL_OFF: Partial<OverlayPreferences> = {
  showViewportContextOverlay: false,
  showHorizontalRuler: false,
  showVerticalRuler: false,
  showOrientationMarkers: false,
};
