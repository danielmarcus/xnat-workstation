import type { HotkeyMap } from './hotkeys';
import {
  DEFAULT_UPDATE_PREFERENCES,
  type UpdatePreferences,
} from './updater';

export { DEFAULT_UPDATE_PREFERENCES };
export type { UpdatePreferences };

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
  autoDisplayAnnotations: boolean;
  defaultSegmentOpacity: number;
  defaultColorSequence: HexColor[];
  scissors: ScissorPreferences;
}

export type ScissorStrategyMode = 'erase' | 'fill';

export interface ScissorPreferences {
  defaultStrategy: ScissorStrategyMode;
  previewEnabled: boolean;
  previewColor: HexColor;
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

// ─── Backup Preferences ─────────────────────────────────────────

export interface BackupPreferences {
  /** Whether local file backup is enabled */
  enabled: boolean;
  /** Backup interval in seconds (minimum 5, maximum 300) */
  intervalSeconds: number;
}

export const DEFAULT_BACKUP_PREFERENCES: BackupPreferences = {
  enabled: true,
  intervalSeconds: 10,
};

// ─── Deletion Preferences ───────────────────────────────────────

export interface DeletionPreferences {
  /** When deleting from XNAT, copy the DICOM file to a session resource first */
  trashOnServerDelete: boolean;
  /** Session resource name used for trashed files (e.g. 'trash') */
  trashResourceName: string;
}

export const DEFAULT_DELETION_PREFERENCES: DeletionPreferences = {
  trashOnServerDelete: false,
  trashResourceName: 'trash',
};

// ─── Multi-Viewport ──────────────────────────────────────

/**
 * Multi-viewport annotation rewrite (see docs/multiviewport-annotation-design.md).
 * Phase 0+ behavior is gated on `enabled`. While disabled, the legacy code
 * paths run unchanged. Removed at the end of Phase 6 once the rewrite is the
 * only path.
 */
export interface MultiViewportPreferences {
  /** Master switch for the multi-viewport rewrite. Default `false` until the rewrite is verified end-to-end. */
  enabled: boolean;
  /**
   * Master toggle for cross-series rendering (requirements §A2b/§D11).
   *
   * When `true` (default), structures classified as A2b — same FoR, different
   * series, anatomy presumed consistent (e.g., T1 + T2 of one MR exam) —
   * render on the sibling series' viewport with the D9 visual flag.
   *
   * When `false`, all cross-series rendering (both A2b and A2c) is suppressed;
   * only native (A2a) structures render. The list panel still lists
   * cross-series structures with the appropriate indicator (D7.4).
   *
   * Note: A2c (breath-hold / 4D-CT phase) is *off by default* even when this
   * toggle is `true` — the user must opt in per-structure-set via the list
   * panel (Phase 3 work). This master toggle is the global kill switch above
   * that per-container opt-in.
   */
  crossSeriesRendering: boolean;
}

export const DEFAULT_MULTIVIEWPORT_PREFERENCES: MultiViewportPreferences = {
  enabled: false,
  crossSeriesRendering: true,
};

// ─── Top-level Preferences ──────────────────────────────────────

export interface PreferencesV1 {
  hotkeys: {
    overrides: HotkeyMap;
  };
  overlay: OverlayPreferences;
  annotation: AnnotationToolPreferences;
  updates: UpdatePreferences;
  interpolation: InterpolationPreferences;
  backup: BackupPreferences;
  deletion: DeletionPreferences;
  multiViewport: MultiViewportPreferences;
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
    autoDisplayAnnotations: true,
    defaultSegmentOpacity: 0.5,
    defaultColorSequence: DEFAULT_SEGMENT_COLOR_SEQUENCE,
    scissors: {
      defaultStrategy: 'erase',
      previewEnabled: false,
      previewColor: '#FFFFFF',
    },
  },
  updates: { ...DEFAULT_UPDATE_PREFERENCES },
  interpolation: { ...DEFAULT_INTERPOLATION_PREFERENCES },
  backup: { ...DEFAULT_BACKUP_PREFERENCES },
  deletion: { ...DEFAULT_DELETION_PREFERENCES },
  multiViewport: { ...DEFAULT_MULTIVIEWPORT_PREFERENCES },
};
