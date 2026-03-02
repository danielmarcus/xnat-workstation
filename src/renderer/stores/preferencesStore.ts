import type { HotkeyAction, HotkeyBinding } from '@shared/types/hotkeys';
import {
  ALL_OVERLAY_FIELD_KEYS,
  DEFAULT_OVERLAY_CORNERS,
  DEFAULT_PREFERENCES,
  DEFAULT_SEGMENT_COLOR_SEQUENCE,
  type AnnotationToolPreferences,
  type HexColor,
  DEFAULT_INTERPOLATION_PREFERENCES,
  DEFAULT_BACKUP_PREFERENCES,
  type BackupPreferences,
  type InterpolationAlgorithm,
  type InterpolationPreferences,
  type OverlayCornerId,
  type OverlayFieldKey,
  type OverlayPreferences,
  type PreferencesV1,
} from '@shared/types/preferences';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface PreferencesStore {
  preferences: PreferencesV1;
  setHotkeyOverride: (action: HotkeyAction, bindings: HotkeyBinding[]) => void;
  clearHotkeyOverride: (action: HotkeyAction) => void;
  resetHotkeys: () => void;
  setShowViewportContextOverlay: (enabled: boolean) => void;
  setShowOverlayHorizontalRuler: (enabled: boolean) => void;
  setShowOverlayVerticalRuler: (enabled: boolean) => void;
  setShowOverlayOrientationMarkers: (enabled: boolean) => void;
  setOverlayCornerField: (corner: OverlayCornerId, field: OverlayFieldKey, enabled: boolean) => void;
  setAnnotationBrushSize: (size: number) => void;
  setAnnotationContourThickness: (size: number) => void;
  setAnnotationMaskOutlines: (enabled: boolean) => void;
  setAnnotationAutoDisplay: (enabled: boolean) => void;
  setAnnotationSegmentOpacity: (opacity: number) => void;
  setAnnotationColorSequence: (colors: string[]) => void;
  // ─── Interpolation ─────────────────────────────────────
  setInterpolationEnabled: (enabled: boolean) => void;
  setInterpolationAlgorithm: (algorithm: InterpolationAlgorithm) => void;
  setLinearThreshold: (threshold: number) => void;
  // ─── Backup ─────────────────────────────────────────────
  setBackupEnabled: (enabled: boolean) => void;
  setBackupIntervalSeconds: (seconds: number) => void;
  resetAll: () => void;
}

const OVERLAY_FIELD_SET = new Set<OverlayFieldKey>(ALL_OVERLAY_FIELD_KEYS);
const HEX_COLOR_PATTERN = /^#?([0-9a-fA-F]{6})$/;

function cloneDefaultCorners(): Record<OverlayCornerId, OverlayFieldKey[]> {
  return {
    topLeft: [...DEFAULT_OVERLAY_CORNERS.topLeft],
    topRight: [...DEFAULT_OVERLAY_CORNERS.topRight],
    bottomLeft: [...DEFAULT_OVERLAY_CORNERS.bottomLeft],
    bottomRight: [...DEFAULT_OVERLAY_CORNERS.bottomRight],
  };
}

function cloneDefaultColorSequence(): HexColor[] {
  return [...DEFAULT_SEGMENT_COLOR_SEQUENCE];
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sanitizeHexColor(value: unknown): HexColor | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(HEX_COLOR_PATTERN);
  if (!match) return null;
  return (`#${match[1].toUpperCase()}`) as HexColor;
}

function sanitizeColorSequence(value: unknown): HexColor[] {
  if (!Array.isArray(value)) return cloneDefaultColorSequence();
  const seen = new Set<HexColor>();
  const out: HexColor[] = [];
  for (const entry of value) {
    const color = sanitizeHexColor(entry);
    if (!color) continue;
    if (seen.has(color)) continue;
    seen.add(color);
    out.push(color);
    if (out.length >= 32) break;
  }
  return out.length > 0 ? out : cloneDefaultColorSequence();
}

function makeDefaultPreferences(): PreferencesV1 {
  return {
    hotkeys: {
      overrides: {},
    },
    overlay: {
      showViewportContextOverlay: DEFAULT_PREFERENCES.overlay.showViewportContextOverlay,
      showHorizontalRuler: DEFAULT_PREFERENCES.overlay.showHorizontalRuler,
      showVerticalRuler: DEFAULT_PREFERENCES.overlay.showVerticalRuler,
      showOrientationMarkers: DEFAULT_PREFERENCES.overlay.showOrientationMarkers,
      corners: cloneDefaultCorners(),
    },
    annotation: {
      defaultBrushSize: DEFAULT_PREFERENCES.annotation.defaultBrushSize,
      defaultContourThickness: DEFAULT_PREFERENCES.annotation.defaultContourThickness,
      defaultMaskOutlines: DEFAULT_PREFERENCES.annotation.defaultMaskOutlines,
      autoDisplayAnnotations: DEFAULT_PREFERENCES.annotation.autoDisplayAnnotations,
      defaultSegmentOpacity: DEFAULT_PREFERENCES.annotation.defaultSegmentOpacity,
      defaultColorSequence: cloneDefaultColorSequence(),
    },
    interpolation: { ...DEFAULT_INTERPOLATION_PREFERENCES },
    backup: { ...DEFAULT_BACKUP_PREFERENCES },
  };
}

function sanitizeOverlayFields(fields: unknown): OverlayFieldKey[] {
  if (!Array.isArray(fields)) return [];
  const seen = new Set<OverlayFieldKey>();
  const out: OverlayFieldKey[] = [];
  for (const value of fields) {
    if (typeof value !== 'string') continue;
    if (!OVERLAY_FIELD_SET.has(value as OverlayFieldKey)) continue;
    const field = value as OverlayFieldKey;
    if (seen.has(field)) continue;
    seen.add(field);
    out.push(field);
  }
  return out;
}

function mergeOverlayPreferences(current: OverlayPreferences, incoming: unknown): OverlayPreferences {
  if (!incoming || typeof incoming !== 'object') {
    return {
      ...current,
      corners: cloneDefaultCorners(),
    };
  }

  const candidate = incoming as Partial<OverlayPreferences> & { showRuler?: unknown };
  const incomingCorners = (candidate.corners ?? {}) as Partial<Record<OverlayCornerId, unknown>>;
  const hasCorner = (corner: OverlayCornerId) =>
    Object.prototype.hasOwnProperty.call(incomingCorners, corner);
  const legacyShowRuler =
    typeof candidate.showRuler === 'boolean'
      ? candidate.showRuler
      : null;

  return {
    showViewportContextOverlay:
      typeof candidate.showViewportContextOverlay === 'boolean'
        ? candidate.showViewportContextOverlay
        : current.showViewportContextOverlay,
    showHorizontalRuler:
      typeof candidate.showHorizontalRuler === 'boolean'
        ? candidate.showHorizontalRuler
        : (legacyShowRuler ?? current.showHorizontalRuler),
    showVerticalRuler:
      typeof candidate.showVerticalRuler === 'boolean'
        ? candidate.showVerticalRuler
        : (legacyShowRuler ?? current.showVerticalRuler),
    showOrientationMarkers:
      typeof candidate.showOrientationMarkers === 'boolean'
        ? candidate.showOrientationMarkers
        : current.showOrientationMarkers,
    corners: {
      topLeft: hasCorner('topLeft')
        ? sanitizeOverlayFields(incomingCorners.topLeft)
        : [...current.corners.topLeft],
      topRight: hasCorner('topRight')
        ? sanitizeOverlayFields(incomingCorners.topRight)
        : [...current.corners.topRight],
      bottomLeft: hasCorner('bottomLeft')
        ? sanitizeOverlayFields(incomingCorners.bottomLeft)
        : [...current.corners.bottomLeft],
      bottomRight: hasCorner('bottomRight')
        ? sanitizeOverlayFields(incomingCorners.bottomRight)
        : [...current.corners.bottomRight],
    },
  };
}

function mergeAnnotationPreferences(current: AnnotationToolPreferences, incoming: unknown): AnnotationToolPreferences {
  if (!incoming || typeof incoming !== 'object') {
    return {
      ...current,
      defaultColorSequence: [...current.defaultColorSequence],
    };
  }

  const candidate = incoming as Partial<AnnotationToolPreferences>;

  return {
    defaultBrushSize:
      typeof candidate.defaultBrushSize === 'number' && Number.isFinite(candidate.defaultBrushSize)
        ? clampNumber(Math.round(candidate.defaultBrushSize), 1, 100)
        : current.defaultBrushSize,
    defaultContourThickness:
      typeof candidate.defaultContourThickness === 'number' && Number.isFinite(candidate.defaultContourThickness)
        ? clampNumber(Math.round(candidate.defaultContourThickness), 1, 8)
        : current.defaultContourThickness,
    defaultMaskOutlines:
      typeof candidate.defaultMaskOutlines === 'boolean'
        ? candidate.defaultMaskOutlines
        : current.defaultMaskOutlines,
    autoDisplayAnnotations:
      typeof candidate.autoDisplayAnnotations === 'boolean'
        ? candidate.autoDisplayAnnotations
        : current.autoDisplayAnnotations,
    defaultSegmentOpacity:
      typeof candidate.defaultSegmentOpacity === 'number' && Number.isFinite(candidate.defaultSegmentOpacity)
        ? clampNumber(candidate.defaultSegmentOpacity, 0, 1)
        : current.defaultSegmentOpacity,
    defaultColorSequence:
      Object.prototype.hasOwnProperty.call(candidate, 'defaultColorSequence')
        ? sanitizeColorSequence(candidate.defaultColorSequence)
        : [...current.defaultColorSequence],
  };
}

export const usePreferencesStore = create<PreferencesStore>()(
  persist(
    (set) => ({
      preferences: makeDefaultPreferences(),

      setHotkeyOverride: (action, bindings) =>
        set((state) => ({
          preferences: {
            ...state.preferences,
            hotkeys: {
              ...state.preferences.hotkeys,
              overrides: {
                ...state.preferences.hotkeys.overrides,
                [action]: bindings,
              },
            },
          },
        })),

      clearHotkeyOverride: (action) =>
        set((state) => {
          const { [action]: _removed, ...nextOverrides } = state.preferences.hotkeys.overrides;
          return {
            preferences: {
              ...state.preferences,
              hotkeys: {
                ...state.preferences.hotkeys,
                overrides: nextOverrides,
              },
            },
          };
        }),

      resetHotkeys: () =>
        set((state) => ({
          preferences: {
            ...state.preferences,
            hotkeys: {
              ...state.preferences.hotkeys,
              overrides: {},
            },
          },
        })),

      setShowViewportContextOverlay: (enabled) =>
        set((state) => ({
          preferences: {
            ...state.preferences,
            overlay: {
              ...state.preferences.overlay,
              showViewportContextOverlay: enabled,
            },
          },
        })),

      setShowOverlayHorizontalRuler: (enabled) =>
        set((state) => ({
          preferences: {
            ...state.preferences,
            overlay: {
              ...state.preferences.overlay,
              showHorizontalRuler: enabled,
            },
          },
        })),

      setShowOverlayVerticalRuler: (enabled) =>
        set((state) => ({
          preferences: {
            ...state.preferences,
            overlay: {
              ...state.preferences.overlay,
              showVerticalRuler: enabled,
            },
          },
        })),

      setShowOverlayOrientationMarkers: (enabled) =>
        set((state) => ({
          preferences: {
            ...state.preferences,
            overlay: {
              ...state.preferences.overlay,
              showOrientationMarkers: enabled,
            },
          },
        })),

      setOverlayCornerField: (corner, field, enabled) =>
        set((state) => {
          const existing = state.preferences.overlay.corners[corner] ?? [];
          const hasField = existing.includes(field);
          const nextFields = enabled
            ? (hasField ? existing : [...existing, field])
            : existing.filter((entry) => entry !== field);

          return {
            preferences: {
              ...state.preferences,
              overlay: {
                ...state.preferences.overlay,
                corners: {
                  ...state.preferences.overlay.corners,
                  [corner]: nextFields,
                },
              },
            },
          };
        }),

      setAnnotationBrushSize: (size) =>
        set((state) => ({
          preferences: {
            ...state.preferences,
            annotation: {
              ...state.preferences.annotation,
              defaultBrushSize: clampNumber(Math.round(size), 1, 100),
            },
          },
        })),

      setAnnotationContourThickness: (size) =>
        set((state) => ({
          preferences: {
            ...state.preferences,
            annotation: {
              ...state.preferences.annotation,
              defaultContourThickness: clampNumber(Math.round(size), 1, 8),
            },
          },
        })),

      setAnnotationMaskOutlines: (enabled) =>
        set((state) => ({
          preferences: {
            ...state.preferences,
            annotation: {
              ...state.preferences.annotation,
              defaultMaskOutlines: enabled,
            },
          },
        })),

      setAnnotationAutoDisplay: (enabled) =>
        set((state) => ({
          preferences: {
            ...state.preferences,
            annotation: {
              ...state.preferences.annotation,
              autoDisplayAnnotations: enabled,
            },
          },
        })),

      setAnnotationSegmentOpacity: (opacity) =>
        set((state) => ({
          preferences: {
            ...state.preferences,
            annotation: {
              ...state.preferences.annotation,
              defaultSegmentOpacity: clampNumber(opacity, 0, 1),
            },
          },
        })),

      setAnnotationColorSequence: (colors) =>
        set((state) => ({
          preferences: {
            ...state.preferences,
            annotation: {
              ...state.preferences.annotation,
              defaultColorSequence: sanitizeColorSequence(colors),
            },
          },
        })),

      // ─── Interpolation ────────────────────────────────────

      setInterpolationEnabled: (enabled) =>
        set((state) => ({
          preferences: {
            ...state.preferences,
            interpolation: { ...state.preferences.interpolation, enabled },
          },
        })),

      setInterpolationAlgorithm: (algorithm) =>
        set((state) => ({
          preferences: {
            ...state.preferences,
            interpolation: { ...state.preferences.interpolation, algorithm },
          },
        })),

      setLinearThreshold: (threshold) =>
        set((state) => ({
          preferences: {
            ...state.preferences,
            interpolation: {
              ...state.preferences.interpolation,
              linearThreshold: Math.max(0, Math.min(1, threshold)),
            },
          },
        })),

      // ─── Backup ──────────────────────────────────────────

      setBackupEnabled: (enabled) =>
        set((state) => ({
          preferences: {
            ...state.preferences,
            backup: { ...state.preferences.backup, enabled },
          },
        })),

      setBackupIntervalSeconds: (seconds) =>
        set((state) => ({
          preferences: {
            ...state.preferences,
            backup: {
              ...state.preferences.backup,
              intervalSeconds: clampNumber(Math.round(seconds), 5, 300),
            },
          },
        })),

      resetAll: () =>
        set({
          preferences: makeDefaultPreferences(),
        }),
    }),
    {
      name: 'xnat-viewer:preferences',
      partialize: (state) => ({
        preferences: state.preferences,
      }),
      merge: (persisted, current) => {
        const base = current as PreferencesStore;
        const incoming = (persisted as Partial<PreferencesStore>)?.preferences;
        if (!incoming) return base;

        // Merge interpolation preferences with defaults as fallback
        const incomingInterp = (incoming as Partial<PreferencesV1>).interpolation;
        const mergedInterpolation: InterpolationPreferences = {
          enabled:
            typeof incomingInterp?.enabled === 'boolean'
              ? incomingInterp.enabled
              : base.preferences.interpolation.enabled,
          algorithm:
            incomingInterp?.algorithm &&
            ['sdf', 'morphological', 'nearestSlice', 'linear'].includes(incomingInterp.algorithm)
              ? incomingInterp.algorithm
              : base.preferences.interpolation.algorithm,
          linearThreshold:
            typeof incomingInterp?.linearThreshold === 'number'
              ? Math.max(0, Math.min(1, incomingInterp.linearThreshold))
              : base.preferences.interpolation.linearThreshold,
        };

        // Merge backup preferences with defaults as fallback
        const incomingBackup = (incoming as Partial<PreferencesV1>).backup;
        const mergedBackup: BackupPreferences = {
          enabled:
            typeof incomingBackup?.enabled === 'boolean'
              ? incomingBackup.enabled
              : base.preferences.backup.enabled,
          intervalSeconds:
            typeof incomingBackup?.intervalSeconds === 'number' && Number.isFinite(incomingBackup.intervalSeconds)
              ? clampNumber(Math.round(incomingBackup.intervalSeconds), 5, 300)
              : base.preferences.backup.intervalSeconds,
        };

        return {
          ...base,
          preferences: {
            hotkeys: {
              overrides: incoming.hotkeys?.overrides ?? base.preferences.hotkeys.overrides,
            },
            overlay: mergeOverlayPreferences(base.preferences.overlay, incoming.overlay),
            annotation: mergeAnnotationPreferences(base.preferences.annotation, incoming.annotation),
            interpolation: mergedInterpolation,
            backup: mergedBackup,
          },
        };
      },
    },
  ),
);
