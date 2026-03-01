import type { HotkeyAction, HotkeyBinding } from '@shared/types/hotkeys';
import {
  ALL_OVERLAY_FIELD_KEYS,
  DEFAULT_OVERLAY_CORNERS,
  DEFAULT_PREFERENCES,
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
  resetAll: () => void;
}

const OVERLAY_FIELD_SET = new Set<OverlayFieldKey>(ALL_OVERLAY_FIELD_KEYS);

function cloneDefaultCorners(): Record<OverlayCornerId, OverlayFieldKey[]> {
  return {
    topLeft: [...DEFAULT_OVERLAY_CORNERS.topLeft],
    topRight: [...DEFAULT_OVERLAY_CORNERS.topRight],
    bottomLeft: [...DEFAULT_OVERLAY_CORNERS.bottomLeft],
    bottomRight: [...DEFAULT_OVERLAY_CORNERS.bottomRight],
  };
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

        return {
          ...base,
          preferences: {
            hotkeys: {
              overrides: incoming.hotkeys?.overrides ?? base.preferences.hotkeys.overrides,
            },
            overlay: mergeOverlayPreferences(base.preferences.overlay, incoming.overlay),
          },
        };
      },
    },
  ),
);
