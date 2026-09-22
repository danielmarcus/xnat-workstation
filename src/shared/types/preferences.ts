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

export interface ScissorPreferences {
  previewEnabled: boolean;
  previewColor: HexColor;
}

// ─── Interpolation Preferences ───────────────────────────────────


/**
 * Between-slice interpolation — CONTOURS ONLY.
 *
 * Labelmap (voxel) interpolation was removed: Cornerstone provides none, so it was a
 * bespoke implementation that ran automatically on every brush stroke and, through a
 * sign error in its distance field, unioned the two drawn slices onto every slice
 * between them rather than interpolating. Cornerstone's own InterpolationManager is
 * contour-only, and it exposes no algorithm choice — `interpolate(viewportData)` takes
 * no options — so `algorithm` and `linearThreshold` went with it.
 */
export interface InterpolationPreferences {
  /** Whether between-slice interpolation is enabled for contour tools. */
  enabled: boolean;
}

export const DEFAULT_INTERPOLATION_PREFERENCES: InterpolationPreferences = {
  enabled: true,
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

// ─── Top-level Preferences ──────────────────────────────────────


// ─── Annotations side panel ─────────────────────────────────────

/**
 * Width of the Annotations side panel (spec §4.1). Drag-resizable from a handle on the
 * panel's left edge, persisted so the user's working width survives a reload.
 *
 * Ported from MV-Phase 7.3c (`9dc2fba` / `b0233d6`), which was built on the abandoned
 * `multiviewport-annotation` branch and never reached main — the annotation rebuild
 * restarted on a new panel and the behaviour was not re-implemented. The default was
 * 400; the rebuilt panel hardcoded `w-72` (288px), which is why tool labels clip.
 */
export interface AnnotationPanelPreferences {
  /** Current panel width in CSS pixels. Clamped to [MIN, MAX]. */
  width: number;
}

export const ANNOTATION_PANEL_MIN_WIDTH = 140;
export const ANNOTATION_PANEL_MAX_WIDTH = 600;
export const ANNOTATION_PANEL_DEFAULT_WIDTH = 400;

/**
 * Narrow-mode thresholds. Below COMPACT_ADD the three create-button labels collapse to
 * icon-only; below COMPACT_TOOLS the toolbox collapses to icon-only as well (spec §4.1).
 * Between DEFAULT and COMPACT_TOOLS labels simply ellipsize.
 */
export const ANNOTATION_PANEL_COMPACT_ADD_WIDTH = 270;
export const ANNOTATION_PANEL_COMPACT_TOOLS_WIDTH = 210;

export const DEFAULT_ANNOTATION_PANEL_PREFERENCES: AnnotationPanelPreferences = {
  width: ANNOTATION_PANEL_DEFAULT_WIDTH,
};

export function clampAnnotationPanelWidth(width: number): number {
  if (!Number.isFinite(width)) return ANNOTATION_PANEL_DEFAULT_WIDTH;
  return Math.max(ANNOTATION_PANEL_MIN_WIDTH, Math.min(ANNOTATION_PANEL_MAX_WIDTH, Math.round(width)));
}

export interface PreferencesV1 {
  /**
   * Schema revision of the STORED payload, used for one-shot resets on upgrade.
   *
   * Separate from zustand-persist's own `version`, which cannot help here: it only
   * migrates when the stored value carries a numeric `version`, and every payload
   * written before 2026-09-21 has none. Absent or < 1 means "written before the
   * shape-tool mode preference did anything".
   */
  schemaVersion: number;
  hotkeys: {
    overrides: HotkeyMap;
  };
  overlay: OverlayPreferences;
  annotation: AnnotationToolPreferences;
  annotationPanel: AnnotationPanelPreferences;
  updates: UpdatePreferences;
  interpolation: InterpolationPreferences;
  backup: BackupPreferences;
  deletion: DeletionPreferences;
  /**
   * Opt-in (default OFF): when true, annotation edits autosave back to XNAT via
   * the real upload transport. When false (default), the in-memory/E2E stub
   * transport stays in place and NOTHING writes to the server. This is the
   * CNDA-facing safety switch — see useXnatAutosaveOptIn / composeXnatTransport.
   * Optional for back-compat with persisted prefs that predate this flag.
   */
  xnatAutosaveEnabled?: boolean;
  /**
   * Debounce interval (seconds) for XNAT auto-save — how long after the last edit
   * a container is saved to the server. Independent of the local-backup cadence.
   * Optional for back-compat; defaults to 10s.
   */
  xnatAutosaveIntervalSeconds?: number;
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

export const CURRENT_PREFERENCES_SCHEMA = 1;

export const DEFAULT_PREFERENCES: PreferencesV1 = {
  schemaVersion: CURRENT_PREFERENCES_SCHEMA,
  hotkeys: {
    overrides: {},
  },
  annotationPanel: { ...DEFAULT_ANNOTATION_PANEL_PREFERENCES },
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
      previewEnabled: false,
      previewColor: '#FFFFFF',
    },
  },
  updates: { ...DEFAULT_UPDATE_PREFERENCES },
  interpolation: { ...DEFAULT_INTERPOLATION_PREFERENCES },
  backup: { ...DEFAULT_BACKUP_PREFERENCES },
  deletion: { ...DEFAULT_DELETION_PREFERENCES },
  // CNDA safety: server autosave defaults OFF. Nothing writes to XNAT until the
  // user opts in via Settings.
  xnatAutosaveEnabled: false,
  xnatAutosaveIntervalSeconds: 10,
};
