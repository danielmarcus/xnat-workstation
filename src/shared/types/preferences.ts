import type { HotkeyMap } from './hotkeys';

export type OverlayCornerId = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
export type HexColor = `#${string}`;

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

export interface AnnotationToolPreferences {
  defaultBrushSize: number;
  defaultContourThickness: number;
  defaultMaskOutlines: boolean;
  defaultSegmentOpacity: number;
  defaultColorSequence: HexColor[];
}

export interface PreferencesV1 {
  hotkeys: {
    overrides: HotkeyMap;
  };
  overlay: OverlayPreferences;
  annotation: AnnotationToolPreferences;
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

export const DEFAULT_SEGMENT_COLOR_SEQUENCE: HexColor[] = [
  '#DC3232',
  '#32C832',
  '#3264DC',
  '#E6C828',
  '#C832C8',
  '#32C8C8',
  '#F08C28',
  '#9650C8',
  '#32DC82',
  '#FF8282',
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
  annotation: {
    defaultBrushSize: 5,
    defaultContourThickness: 2,
    defaultMaskOutlines: true,
    defaultSegmentOpacity: 0.5,
    defaultColorSequence: DEFAULT_SEGMENT_COLOR_SEQUENCE,
  },
};
