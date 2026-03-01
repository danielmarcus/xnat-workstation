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

// ─── Interpolation Preferences ───────────────────────────────────

export type InterpolationAlgorithm = 'sdf' | 'morphological' | 'nearestSlice' | 'linear';

export interface InterpolationPreferences {
  /** Whether between-slice interpolation is enabled */
  enabled: boolean;
  /** Which interpolation algorithm to use */
  algorithm: InterpolationAlgorithm;
  /** Blend threshold for the 'linear' algorithm (0–1, default 0.5). Lower = more aggressive fill. */
  linearThreshold: number;
}

export const DEFAULT_INTERPOLATION_PREFERENCES: InterpolationPreferences = {
  enabled: true,
  algorithm: 'morphological',
  linearThreshold: 0.5,
};

export const INTERPOLATION_ALGORITHM_LABELS: Record<InterpolationAlgorithm, string> = {
  sdf: 'Signed Distance Field (SDF)',
  morphological: 'Morphological (Raya-Udupa)',
  nearestSlice: 'Nearest Slice',
  linear: 'Linear Blend',
};

export const INTERPOLATION_ALGORITHM_DESCRIPTIONS: Record<InterpolationAlgorithm, string> = {
  sdf: 'Blends signed Euclidean distance fields between anchor slices. Tends to produce conservative (smaller) regions.',
  morphological: 'Classic medical image interpolation. Interpolates inside-distance fields for better volume preservation and shape handling.',
  nearestSlice: 'Copies the nearest painted slice. Fast, no blending artifacts, but produces staircase boundaries.',
  linear: 'Blends pixel values linearly between anchors. Adjustable threshold controls fill aggressiveness.',
};

// ─── Top-level Preferences ──────────────────────────────────────

export interface PreferencesV1 {
  hotkeys: {
    overrides: HotkeyMap;
  };
  overlay: OverlayPreferences;
  interpolation: InterpolationPreferences;
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
  interpolation: { ...DEFAULT_INTERPOLATION_PREFERENCES },
};
