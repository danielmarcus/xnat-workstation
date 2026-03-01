import type { HotkeyMap } from './hotkeys';

export type OverlayCornerId = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';

export type OverlayFieldKey =
  | 'orientationSelector'
  | 'subjectLabel'
  | 'sessionLabel'
  | 'patientName'
  | 'patientId'
  | 'studyDate'
  | 'institutionName'
  | 'seriesDescription'
  | 'scanId'
  | 'imageIndex'
  | 'sliceLocation'
  | 'sliceThickness'
  | 'windowLevel'
  | 'zoom'
  | 'dimensions'
  | 'rotation'
  | 'flip'
  | 'invert'
  | 'crosshair';

export interface OverlayPreferences {
  showViewportContextOverlay: boolean;
  showHorizontalRuler: boolean;
  showVerticalRuler: boolean;
  showOrientationMarkers: boolean;
  corners: Record<OverlayCornerId, OverlayFieldKey[]>;
}

export interface PreferencesV1 {
  hotkeys: {
    overrides: HotkeyMap;
  };
  overlay: OverlayPreferences;
}

export const DEFAULT_OVERLAY_CORNERS: Record<OverlayCornerId, OverlayFieldKey[]> = {
  topLeft: ['orientationSelector', 'subjectLabel', 'sessionLabel', 'studyDate'],
  topRight: ['institutionName', 'seriesDescription', 'scanId'],
  bottomLeft: ['imageIndex', 'sliceLocation', 'sliceThickness', 'windowLevel'],
  bottomRight: ['zoom', 'dimensions', 'rotation', 'flip', 'invert', 'crosshair'],
};

export const ALL_OVERLAY_FIELD_KEYS: OverlayFieldKey[] = [
  'orientationSelector',
  'subjectLabel',
  'sessionLabel',
  'patientName',
  'patientId',
  'studyDate',
  'institutionName',
  'seriesDescription',
  'scanId',
  'imageIndex',
  'sliceLocation',
  'sliceThickness',
  'windowLevel',
  'zoom',
  'dimensions',
  'rotation',
  'flip',
  'invert',
  'crosshair',
];

export const DEFAULT_PREFERENCES: PreferencesV1 = {
  hotkeys: {
    overrides: {},
  },
  overlay: {
    showViewportContextOverlay: true,
    showHorizontalRuler: true,
    showVerticalRuler: true,
    showOrientationMarkers: true,
    corners: DEFAULT_OVERLAY_CORNERS,
  },
};
