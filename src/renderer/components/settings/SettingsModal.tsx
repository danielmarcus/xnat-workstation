import { useEffect, useMemo, useState } from 'react';
import type { HotkeyAction, HotkeyBinding, HotkeyModifiers } from '@shared/types/hotkeys';
import type {
  OverlayCornerId,
  OverlayFieldKey,
  InterpolationAlgorithm,
  ScissorStrategyMode,
} from '@shared/types/preferences';
import type { UpdateStatus } from '@shared/types';
import {
  INTERPOLATION_ALGORITHM_LABELS,
  INTERPOLATION_ALGORITHM_DESCRIPTIONS,
} from '@shared/types/preferences';
import { DEFAULT_HOTKEY_MAP } from '../../lib/hotkeys/defaultHotkeyMap';
import { usePreferencesStore } from '../../stores/preferencesStore';
import { useViewerStore } from '../../stores/viewerStore';
import { backupService } from '../../lib/backup/backupService';
import type { BackupSessionSummary } from '@shared/types/backup';
import { buildIssueReport } from '../../lib/diagnostics/issueReport';
import { IconClose } from '../icons';

declare const __APP_VERSION__: string;
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

type SettingsTab = 'hotkeys' | 'overlay' | 'annotation' | 'updates' | 'interpolation' | 'backup' | 'issue' | 'about';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  /** Called when the user clicks "Recover" for a backup session. Returns a Promise that resolves when recovery is complete. */
  onRecover?: (sessionId: string) => Promise<void> | void;
  /** Initial tab to open when the modal opens (e.g. 'backup'). */
  initialTab?: string;
}

const TAB_ITEMS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'hotkeys', label: 'Hotkeys' },
  { id: 'overlay', label: 'Overlay' },
  { id: 'annotation', label: 'Annotation' },
  { id: 'updates', label: 'Updates' },
  { id: 'interpolation', label: 'Interpolation' },
  { id: 'backup', label: 'File Backup' },
  { id: 'issue', label: 'Issue Report' },
];

const DOC_ITEMS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'about', label: 'About' },
];

const CORNER_OPTIONS: Array<{
  corner: OverlayCornerId;
  label: string;
  fields: Array<{ key: OverlayFieldKey; label: string }>;
}> = [
  {
    corner: 'topLeft',
    label: 'Top Left',
    fields: [
      { key: 'orientationSelector', label: 'Orientation control' },
      { key: 'subjectLabel', label: 'Subject label' },
      { key: 'sessionLabel', label: 'Session label' },
      { key: 'patientName', label: 'Patient name' },
      { key: 'patientId', label: 'Patient ID' },
      { key: 'studyDate', label: 'Study date' },
    ],
  },
  {
    corner: 'topRight',
    label: 'Top Right',
    fields: [
      { key: 'institutionName', label: 'Institution' },
      { key: 'seriesDescription', label: 'Series description' },
      { key: 'scanId', label: 'Scan ID' },
      { key: 'patientName', label: 'Patient name' },
      { key: 'patientId', label: 'Patient ID' },
      { key: 'studyDate', label: 'Study date' },
    ],
  },
  {
    corner: 'bottomLeft',
    label: 'Bottom Left',
    fields: [
      { key: 'imageIndex', label: 'Image index' },
      { key: 'sliceLocation', label: 'Slice location' },
      { key: 'sliceThickness', label: 'Slice thickness' },
      { key: 'windowLevel', label: 'Window / Level' },
      { key: 'crosshair', label: 'Crosshair coordinates' },
    ],
  },
  {
    corner: 'bottomRight',
    label: 'Bottom Right',
    fields: [
      { key: 'zoom', label: 'Zoom' },
      { key: 'dimensions', label: 'Image dimensions' },
      { key: 'rotation', label: 'Rotation' },
      { key: 'flip', label: 'Flip state' },
      { key: 'invert', label: 'Invert state' },
      { key: 'windowLevel', label: 'Window / Level' },
      { key: 'crosshair', label: 'Crosshair coordinates' },
    ],
  },
];

function formatActionLabel(action: HotkeyAction): string {
  return action
    .replace(/\./g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function formatBinding(binding: HotkeyBinding): string {
  const mods: string[] = [];
  if (binding.modifiers?.ctrl) mods.push('Ctrl');
  if (binding.modifiers?.shift) mods.push('Shift');
  if (binding.modifiers?.alt) mods.push('Alt');
  if (binding.modifiers?.meta) mods.push('Meta');
  const key = binding.key === ' ' ? 'Space' : binding.key;
  mods.push(key);
  return mods.join('+');
}

function formatBindings(bindings?: HotkeyBinding[]): string {
  if (!bindings || bindings.length === 0) return 'None';
  return bindings.map((binding) => formatBinding(binding)).join(', ');
}

function normalizeKeyInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const lowered = trimmed.toLowerCase();
  if (lowered === 'space' || lowered === 'spacebar') return ' ';
  if (lowered === 'escape') return 'Escape';
  if (lowered === 'tab') return 'Tab';
  if (trimmed.length === 1) return trimmed.toLowerCase();
  return trimmed;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function normalizeHexColor(value: string): string | null {
  const match = value.trim().match(/^#?([0-9a-fA-F]{6})$/);
  if (!match) return null;
  return `#${match[1].toUpperCase()}`;
}

function parseColorSequenceInput(input: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of input.split(',')) {
    const color = normalizeHexColor(token);
    if (!color) continue;
    if (seen.has(color)) continue;
    seen.add(color);
    out.push(color);
  }
  return out;
}

function bindingToDraft(binding: HotkeyBinding): { key: string; modifiers: Required<HotkeyModifiers> } {
  return {
    key: binding.key === ' ' ? 'Space' : binding.key,
    modifiers: {
      ctrl: !!binding.modifiers?.ctrl,
      shift: !!binding.modifiers?.shift,
      alt: !!binding.modifiers?.alt,
      meta: !!binding.modifiers?.meta,
    },
  };
}

function formatUpdateStatus(status: UpdateStatus | null): string {
  if (!status) return 'Loading updater status...';
  switch (status.phase) {
    case 'disabled':
      return 'Automatic update checks are disabled.';
    case 'idle':
      return 'Automatic update checks are enabled.';
    case 'checking':
      return 'Checking for updates...';
    case 'available':
      return status.availableVersion
        ? `Update ${status.availableVersion} is available.`
        : 'An update is available.';
    case 'downloading':
      return status.downloadProgressPercent === null
        ? 'Downloading update...'
        : `Downloading update... ${Math.round(status.downloadProgressPercent)}%`;
    case 'downloaded':
      return status.downloadedVersion
        ? `Update ${status.downloadedVersion} is ready to install.`
        : 'An update is ready to install.';
    case 'upToDate':
      return 'You are running the latest version.';
    case 'unsupported':
      return 'Auto-update is only available in packaged builds.';
    case 'error':
      return status.error ? `Update error: ${status.error}` : 'Update check failed.';
    default:
      return status.message ?? 'Updater status unavailable.';
  }
}

export default function SettingsModal({ open, onClose, onRecover, initialTab }: SettingsModalProps) {
  const overrides = usePreferencesStore((s) => s.preferences.hotkeys.overrides);
  const overlayPrefs = usePreferencesStore((s) => s.preferences.overlay);
  const annotationPrefs = usePreferencesStore((s) => s.preferences.annotation);
  const updatePrefs = usePreferencesStore((s) => s.preferences.updates);
  const interpPrefs = usePreferencesStore((s) => s.preferences.interpolation);
  const setHotkeyOverride = usePreferencesStore((s) => s.setHotkeyOverride);
  const clearHotkeyOverride = usePreferencesStore((s) => s.clearHotkeyOverride);
  const resetHotkeys = usePreferencesStore((s) => s.resetHotkeys);
  const setShowViewportContextOverlay = usePreferencesStore((s) => s.setShowViewportContextOverlay);
  const setShowOverlayHorizontalRuler = usePreferencesStore((s) => s.setShowOverlayHorizontalRuler);
  const setShowOverlayVerticalRuler = usePreferencesStore((s) => s.setShowOverlayVerticalRuler);
  const setShowOverlayOrientationMarkers = usePreferencesStore((s) => s.setShowOverlayOrientationMarkers);
  const setOverlayCornerField = usePreferencesStore((s) => s.setOverlayCornerField);
  const setAnnotationBrushSize = usePreferencesStore((s) => s.setAnnotationBrushSize);
  const setAnnotationContourThickness = usePreferencesStore((s) => s.setAnnotationContourThickness);
  const setAnnotationMaskOutlines = usePreferencesStore((s) => s.setAnnotationMaskOutlines);
  const setAnnotationAutoDisplay = usePreferencesStore((s) => s.setAnnotationAutoDisplay);
  const setAnnotationSegmentOpacity = usePreferencesStore((s) => s.setAnnotationSegmentOpacity);
  const setAnnotationColorSequence = usePreferencesStore((s) => s.setAnnotationColorSequence);
  const setScissorDefaultStrategy = usePreferencesStore((s) => s.setScissorDefaultStrategy);
  const setScissorPreviewEnabled = usePreferencesStore((s) => s.setScissorPreviewEnabled);
  const setScissorPreviewColor = usePreferencesStore((s) => s.setScissorPreviewColor);
  const setUpdateChecksEnabled = usePreferencesStore((s) => s.setUpdateChecksEnabled);
  const setUpdateAutoDownloadEnabled = usePreferencesStore((s) => s.setUpdateAutoDownloadEnabled);
  const setInterpolationEnabled = usePreferencesStore((s) => s.setInterpolationEnabled);
  const setInterpolationAlgorithm = usePreferencesStore((s) => s.setInterpolationAlgorithm);
  const setLinearThreshold = usePreferencesStore((s) => s.setLinearThreshold);
  const backupPrefs = usePreferencesStore((s) => s.preferences.backup);
  const setBackupEnabled = usePreferencesStore((s) => s.setBackupEnabled);
  const setBackupIntervalSeconds = usePreferencesStore((s) => s.setBackupIntervalSeconds);
  const deletionPrefs = usePreferencesStore((s) => s.preferences.deletion);
  const setTrashOnServerDelete = usePreferencesStore((s) => s.setTrashOnServerDelete);
  const setTrashResourceName = usePreferencesStore((s) => s.setTrashResourceName);
  const resetAll = usePreferencesStore((s) => s.resetAll);

  // ─── Backup tab state ──────────────────────────────────────
  const [backupSessions, setBackupSessions] = useState<BackupSessionSummary[]>([]);
  const [backupCachePath, setBackupCachePath] = useState<string>('');
  const [backupLoading, setBackupLoading] = useState(false);
  const [recoveringSession, setRecoveringSession] = useState<string | null>(null);
  const currentSessionId = useViewerStore((s) => s.sessionId);

  const actionOptions = useMemo(() => {
    const all = new Set<HotkeyAction>(Object.keys(DEFAULT_HOTKEY_MAP) as HotkeyAction[]);
    for (const key of Object.keys(overrides) as HotkeyAction[]) {
      all.add(key);
    }
    return Array.from(all).sort();
  }, [overrides]);

  const [activeTab, setActiveTab] = useState<SettingsTab>('hotkeys');

  // Switch to initialTab when it changes (e.g. banner link opens to 'backup')
  useEffect(() => {
    if (initialTab && open) {
      setActiveTab(initialTab as SettingsTab);
    }
  }, [initialTab, open]);

  const [selectedAction, setSelectedAction] = useState<HotkeyAction | null>(null);
  const [draftKey, setDraftKey] = useState('');
  const [draftModifiers, setDraftModifiers] = useState<Required<HotkeyModifiers>>({
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
  });
  const [colorSequenceDraft, setColorSequenceDraft] = useState('');

  // Confirm-delete dialog state (replaces native window.confirm)
  const [confirmDeleteSession, setConfirmDeleteSession] = useState<{ sessionId: string; label: string } | null>(null);
  const [issueNotes, setIssueNotes] = useState('');
  const [issueReport, setIssueReport] = useState('');
  const [issueLoading, setIssueLoading] = useState(false);
  const [issueCopyStatus, setIssueCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmDeleteSession) {
          setConfirmDeleteSession(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (activeTab !== 'issue' || !open) return;
    let cancelled = false;
    setIssueLoading(true);
    buildIssueReport(issueNotes)
      .then((report) => {
        if (!cancelled) setIssueReport(report);
      })
      .catch((err) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setIssueReport(`Failed to generate issue report: ${msg}`);
        }
      })
      .finally(() => {
        if (!cancelled) setIssueLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, open]);

  useEffect(() => {
    if (activeTab !== 'updates' || !open) return;
    const updaterApi = window.electronAPI?.updater;
    if (!updaterApi) {
      setUpdateStatus(null);
      return;
    }

    let cancelled = false;
    updaterApi.getState()
      .then((status) => {
        if (!cancelled) setUpdateStatus(status);
      })
      .catch((error) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setUpdateStatus({
          phase: 'error',
          currentVersion: 'unknown',
          enabled: updatePrefs.enabled,
          autoDownload: updatePrefs.autoDownload,
          isPackaged: false,
          availableVersion: null,
          downloadedVersion: null,
          downloadProgressPercent: null,
          lastCheckedAt: null,
          message: 'Failed to load updater state.',
          error: message,
        });
      });

    const unsubscribe = updaterApi.onStatus((status) => {
      if (!cancelled) setUpdateStatus(status);
    }) ?? (() => {});

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [activeTab, open, updatePrefs.autoDownload, updatePrefs.enabled]);

  useEffect(() => {
    if (!actionOptions.length) return;
    if (!selectedAction || !actionOptions.includes(selectedAction)) {
      setSelectedAction(actionOptions[0]);
    }
  }, [actionOptions, selectedAction]);

  useEffect(() => {
    if (!selectedAction) return;
    const firstBinding =
      overrides[selectedAction]?.[0]
      ?? DEFAULT_HOTKEY_MAP[selectedAction]?.[0];
    if (!firstBinding) {
      setDraftKey('');
      setDraftModifiers({ ctrl: false, shift: false, alt: false, meta: false });
      return;
    }
    const draft = bindingToDraft(firstBinding);
    setDraftKey(draft.key);
    setDraftModifiers(draft.modifiers);
  }, [overrides, selectedAction]);

  useEffect(() => {
    setColorSequenceDraft(annotationPrefs.defaultColorSequence.join(', '));
  }, [annotationPrefs.defaultColorSequence]);

  // Load backup sessions and cache path when the backup tab is activated
  useEffect(() => {
    if (activeTab !== 'backup' || !open) return;
    let cancelled = false;
    setBackupLoading(true);
    Promise.all([
      backupService.listAllBackups(),
      window.electronAPI.backup.getCachePath(),
    ]).then(([sessions, pathResult]) => {
      if (cancelled) return;
      setBackupSessions(sessions);
      setBackupCachePath(pathResult.ok ? (pathResult.path ?? '') : '');
      console.log('[Settings] Backup sessions:', sessions.map((s) => s.sessionId), 'currentSessionId:', useViewerStore.getState().sessionId);
    }).catch(() => {
      if (!cancelled) setBackupSessions([]);
    }).finally(() => {
      if (!cancelled) setBackupLoading(false);
    });
    return () => { cancelled = true; };
  }, [activeTab, open]);

  const overrideEntries = useMemo(
    () => Object.entries(overrides) as Array<[HotkeyAction, HotkeyBinding[]]>,
    [overrides],
  );

  const selectedDefaultBindings = selectedAction ? DEFAULT_HOTKEY_MAP[selectedAction] : undefined;
  const selectedOverrideBindings = selectedAction ? overrides[selectedAction] : undefined;

  const applySelectedOverride = () => {
    if (!selectedAction) return;
    const normalizedKey = normalizeKeyInput(draftKey);
    if (!normalizedKey) return;

    const modifiers: HotkeyModifiers = {};
    if (draftModifiers.ctrl) modifiers.ctrl = true;
    if (draftModifiers.shift) modifiers.shift = true;
    if (draftModifiers.alt) modifiers.alt = true;
    if (draftModifiers.meta) modifiers.meta = true;
    const hasModifiers = Object.keys(modifiers).length > 0;

    setHotkeyOverride(selectedAction, [{ key: normalizedKey, modifiers: hasModifiers ? modifiers : undefined }]);
  };

  const loadOverrideIntoEditor = (action: HotkeyAction, bindings: HotkeyBinding[]) => {
    setSelectedAction(action);
    const first = bindings[0];
    if (!first) return;
    const draft = bindingToDraft(first);
    setDraftKey(draft.key);
    setDraftModifiers(draft.modifiers);
  };

  const applyColorSequence = () => {
    const parsed = parseColorSequenceInput(colorSequenceDraft);
    if (parsed.length === 0) return;
    setAnnotationColorSequence(parsed);
  };

  const refreshIssueReport = async () => {
    setIssueLoading(true);
    try {
      const report = await buildIssueReport(issueNotes);
      setIssueReport(report);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setIssueReport(`Failed to generate issue report: ${msg}`);
    } finally {
      setIssueLoading(false);
    }
  };

  const copyIssueReport = async () => {
    if (!issueReport && !issueNotes.trim()) return;
    try {
      const latestReport = await buildIssueReport(issueNotes);
      setIssueReport(latestReport);
      await navigator.clipboard.writeText(latestReport);
      setIssueCopyStatus('copied');
      window.setTimeout(() => setIssueCopyStatus('idle'), 2000);
    } catch {
      setIssueCopyStatus('error');
      window.setTimeout(() => setIssueCopyStatus('idle'), 3000);
    }
  };

  const checkForUpdatesNow = async () => {
    const updaterApi = window.electronAPI?.updater;
    if (!updaterApi) return;
    setUpdateBusy(true);
    try {
      const result = await updaterApi.checkForUpdates();
      setUpdateStatus(result.status);
    } finally {
      setUpdateBusy(false);
    }
  };

  const installDownloadedUpdate = async () => {
    const updaterApi = window.electronAPI?.updater;
    if (!updaterApi) return;
    setUpdateBusy(true);
    try {
      await updaterApi.quitAndInstall();
    } finally {
      setUpdateBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close settings"
        className="absolute inset-0 bg-zinc-950/70"
        onClick={onClose}
      />

      <div className="relative w-full max-w-4xl h-[min(80vh,560px)] bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden flex">
        <div className="w-40 border-r border-zinc-800 p-2 bg-zinc-950/50">
          <div className="px-2 py-2 text-[11px] uppercase tracking-wide text-zinc-500">Settings</div>
          <div className="space-y-1">
            {TAB_ITEMS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`w-full text-left px-2.5 py-2 rounded text-xs transition-colors ${
                  activeTab === tab.id
                    ? 'bg-blue-600/20 text-blue-300'
                    : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="px-2 py-2 mt-2 text-[11px] uppercase tracking-wide text-zinc-500 border-t border-zinc-800 pt-3">Documentation</div>
          <div className="space-y-1">
            {DOC_ITEMS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`w-full text-left px-2.5 py-2 rounded text-xs transition-colors ${
                  activeTab === tab.id
                    ? 'bg-blue-600/20 text-blue-300'
                    : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 min-w-0 flex flex-col">
          <div className="h-11 shrink-0 border-b border-zinc-800 px-4 flex items-center justify-between">
            <h2 className="text-sm font-medium text-zinc-100">Preferences</h2>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              title="Close"
            >
              <IconClose className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {activeTab === 'hotkeys' && (
              <>
                <div className="text-xs text-zinc-400">
                  Override hotkeys per action. Overrides are persisted locally and merged on app startup.
                </div>

                <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 space-y-3">
                  <div className="grid gap-2 md:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-[11px] text-zinc-500">Action</span>
                      <select
                        value={selectedAction ?? ''}
                        onChange={(e) => setSelectedAction(e.target.value as HotkeyAction)}
                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200"
                      >
                        {actionOptions.map((action) => (
                          <option key={action} value={action}>{formatActionLabel(action)}</option>
                        ))}
                      </select>
                    </label>

                    <label className="space-y-1">
                      <span className="text-[11px] text-zinc-500">Key</span>
                      <input
                        value={draftKey}
                        onChange={(e) => setDraftKey(e.target.value)}
                        placeholder="e.g. w, Escape, Space"
                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200"
                      />
                    </label>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    {(['ctrl', 'shift', 'alt', 'meta'] as const).map((mod) => (
                      <label key={mod} className="flex items-center gap-1.5 text-[11px] text-zinc-400 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={draftModifiers[mod]}
                          onChange={(e) => setDraftModifiers((prev) => ({ ...prev, [mod]: e.target.checked }))}
                          className="w-3 h-3 rounded border-zinc-600 bg-zinc-800 accent-blue-500"
                        />
                        <span>{mod.toUpperCase()}</span>
                      </label>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={applySelectedOverride}
                      disabled={!selectedAction || !normalizeKeyInput(draftKey)}
                      className="px-2.5 py-1.5 rounded bg-blue-600 text-white text-xs hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Set Override
                    </button>
                    <button
                      type="button"
                      onClick={() => selectedAction && clearHotkeyOverride(selectedAction)}
                      disabled={!selectedAction || !selectedOverrideBindings}
                      className="px-2.5 py-1.5 rounded bg-zinc-800 text-zinc-200 text-xs hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Clear Selected
                    </button>
                    <button
                      type="button"
                      onClick={resetHotkeys}
                      className="px-2.5 py-1.5 rounded bg-zinc-800 text-zinc-200 text-xs hover:bg-zinc-700 transition-colors"
                    >
                      Reset Hotkeys
                    </button>
                  </div>

                  {selectedAction && (
                    <div className="text-[11px] text-zinc-500 space-y-0.5">
                      <div>Default: <span className="text-zinc-400">{formatBindings(selectedDefaultBindings)}</span></div>
                      <div>Override: <span className="text-zinc-400">{formatBindings(selectedOverrideBindings)}</span></div>
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                  <h3 className="text-xs font-medium text-zinc-300 mb-2">Current Overrides</h3>
                  {overrideEntries.length === 0 ? (
                    <div className="text-[11px] text-zinc-500">No hotkey overrides configured.</div>
                  ) : (
                    <div className="space-y-2">
                      {overrideEntries.map(([action, bindings]) => (
                        <div
                          key={action}
                          className="flex items-center justify-between gap-3 rounded border border-zinc-800 bg-zinc-900/60 px-2.5 py-2"
                        >
                          <div className="min-w-0">
                            <div className="text-[11px] text-zinc-300 truncate">{formatActionLabel(action)}</div>
                            <div className="text-[11px] text-zinc-500 truncate">{formatBindings(bindings)}</div>
                          </div>
                          <div className="shrink-0 flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => loadOverrideIntoEditor(action, bindings)}
                              className="px-2 py-1 rounded text-[11px] bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => clearHotkeyOverride(action)}
                              className="px-2 py-1 rounded text-[11px] bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors"
                            >
                              Clear
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {activeTab === 'overlay' && (
              <>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={overlayPrefs.showViewportContextOverlay}
                      onChange={(e) => setShowViewportContextOverlay(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-zinc-600 bg-zinc-800 accent-blue-500"
                    />
                    <span className="text-xs text-zinc-300">Show viewport context overlay</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={overlayPrefs.showHorizontalRuler}
                      onChange={(e) => setShowOverlayHorizontalRuler(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-zinc-600 bg-zinc-800 accent-blue-500"
                    />
                    <span className="text-xs text-zinc-300">Show horizontal ruler</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={overlayPrefs.showVerticalRuler}
                      onChange={(e) => setShowOverlayVerticalRuler(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-zinc-600 bg-zinc-800 accent-blue-500"
                    />
                    <span className="text-xs text-zinc-300">Show vertical ruler</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={overlayPrefs.showOrientationMarkers}
                      onChange={(e) => setShowOverlayOrientationMarkers(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-zinc-600 bg-zinc-800 accent-blue-500"
                    />
                    <span className="text-xs text-zinc-300">Show A/P and L/R indicators</span>
                  </label>
                  <p className="text-[11px] text-zinc-500">
                    Configure exactly which context fields render in each overlay corner.
                  </p>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  {CORNER_OPTIONS.map((cornerOption) => (
                    <div
                      key={cornerOption.corner}
                      className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3"
                    >
                      <h3 className="text-xs font-medium text-zinc-300 mb-2">{cornerOption.label}</h3>
                      <div className="space-y-1.5">
                        {cornerOption.fields.map((field) => {
                          const checked = overlayPrefs.corners[cornerOption.corner]?.includes(field.key) ?? false;
                          return (
                            <label key={field.key} className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) =>
                                  setOverlayCornerField(
                                    cornerOption.corner,
                                    field.key,
                                    e.target.checked,
                                  )
                                }
                                className="w-3 h-3 rounded border-zinc-600 bg-zinc-800 accent-blue-500"
                              />
                              <span className="text-[11px] text-zinc-400">{field.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {activeTab === 'annotation' && (
              <>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs text-zinc-300">Default brush size</label>
                      <span className="text-[11px] text-zinc-400 tabular-nums">{annotationPrefs.defaultBrushSize}px</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={50}
                      value={annotationPrefs.defaultBrushSize}
                      onChange={(e) => setAnnotationBrushSize(parseInt(e.target.value, 10) || 1)}
                      className="w-full h-1 bg-zinc-700 rounded-full appearance-none cursor-pointer accent-blue-500"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs text-zinc-300">Default contour thickness</label>
                      <span className="text-[11px] text-zinc-400 tabular-nums">{annotationPrefs.defaultContourThickness}px</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={8}
                      value={annotationPrefs.defaultContourThickness}
                      onChange={(e) => setAnnotationContourThickness(parseInt(e.target.value, 10) || 1)}
                      className="w-full h-1 bg-zinc-700 rounded-full appearance-none cursor-pointer accent-emerald-500"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs text-zinc-300">Default segment opacity</label>
                      <span className="text-[11px] text-zinc-400 tabular-nums">
                        {Math.round(annotationPrefs.defaultSegmentOpacity * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={annotationPrefs.defaultSegmentOpacity}
                      onChange={(e) => setAnnotationSegmentOpacity(parseFloat(e.target.value))}
                      className="w-full h-1 bg-zinc-700 rounded-full appearance-none cursor-pointer accent-blue-500"
                    />
                  </div>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={annotationPrefs.defaultMaskOutlines}
                      onChange={(e) => setAnnotationMaskOutlines(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-zinc-600 bg-zinc-800 accent-blue-500"
                    />
                    <span className="text-xs text-zinc-300">Default display mask outlines</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={annotationPrefs.autoDisplayAnnotations}
                      onChange={(e) => setAnnotationAutoDisplay(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-zinc-600 bg-zinc-800 accent-blue-500"
                    />
                    <span className="text-xs text-zinc-300">Automatically display annotations</span>
                  </label>
                </div>

                <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 space-y-3">
                  <div className="text-xs text-zinc-300">Default color sequence</div>
                  <div className="flex flex-wrap gap-1.5">
                    {annotationPrefs.defaultColorSequence.map((color) => (
                      <div
                        key={color}
                        className="w-5 h-5 rounded border border-zinc-700"
                        style={{ backgroundColor: color }}
                        title={color}
                      />
                    ))}
                  </div>
                  <label className="space-y-1 block">
                    <span className="text-[11px] text-zinc-500">Comma-separated hex colors</span>
                    <input
                      value={colorSequenceDraft}
                      onChange={(e) => setColorSequenceDraft(e.target.value)}
                      placeholder="#DC3232, #32C832, #3264DC"
                      className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200"
                    />
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={applyColorSequence}
                      disabled={parseColorSequenceInput(colorSequenceDraft).length === 0}
                      className="px-2.5 py-1.5 rounded bg-zinc-800 text-zinc-200 text-xs hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Apply Sequence
                    </button>
                  </div>
                </div>

                <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 space-y-3">
                  <div className="text-xs text-zinc-300">Scissors</div>
                  <label className="space-y-1 block">
                    <span className="text-[11px] text-zinc-500">Default scissors mode</span>
                    <select
                      aria-label="Default scissors mode"
                      value={annotationPrefs.scissors.defaultStrategy}
                      onChange={(e) =>
                        setScissorDefaultStrategy(e.target.value as ScissorStrategyMode)
                      }
                      className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200"
                    >
                      <option value="erase">Erase inside</option>
                      <option value="fill">Fill inside</option>
                    </select>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={annotationPrefs.scissors.previewEnabled}
                      onChange={(e) => setScissorPreviewEnabled(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-zinc-600 bg-zinc-800 accent-blue-500"
                    />
                    <span className="text-xs text-zinc-300">Enable scissors preview</span>
                  </label>

                  <label className="space-y-1 block">
                    <span className="text-[11px] text-zinc-500">Preview color</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        aria-label="Preview color"
                        value={annotationPrefs.scissors.previewColor}
                        onChange={(e) => setScissorPreviewColor(e.target.value)}
                        className="h-8 w-12 rounded border border-zinc-700 bg-zinc-800"
                      />
                      <div className="text-[11px] text-zinc-400 font-mono">
                        {annotationPrefs.scissors.previewColor}
                      </div>
                    </div>
                  </label>

                  <p className="text-[11px] text-zinc-500">
                    Hold Shift while using a scissors tool to temporarily toggle to the alternate mode.
                  </p>
                </div>
              </>
            )}

            {activeTab === 'updates' && (
              <>
                <div className="text-xs text-zinc-400">
                  Configure background update checks for packaged releases. Manual checks are always available.
                </div>

                <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 space-y-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded border border-zinc-800 bg-zinc-900/60 px-3 py-2">
                      <div className="text-[11px] text-zinc-500">Current version</div>
                      <div className="text-sm text-zinc-100 font-mono">
                        {updateStatus?.currentVersion ?? 'Loading...'}
                      </div>
                    </div>
                    <div className="rounded border border-zinc-800 bg-zinc-900/60 px-3 py-2">
                      <div className="text-[11px] text-zinc-500">Last checked</div>
                      <div className="text-sm text-zinc-100">
                        {updateStatus?.lastCheckedAt
                          ? new Date(updateStatus.lastCheckedAt).toLocaleString()
                          : 'Not checked yet'}
                      </div>
                    </div>
                  </div>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={updatePrefs.enabled}
                      onChange={(e) => setUpdateChecksEnabled(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-zinc-600 bg-zinc-800 accent-blue-500"
                    />
                    <span className="text-xs text-zinc-300">Enable automatic update checks</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={updatePrefs.autoDownload}
                      onChange={(e) => setUpdateAutoDownloadEnabled(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-zinc-600 bg-zinc-800 accent-blue-500"
                    />
                    <span className="text-xs text-zinc-300">Download updates automatically when found</span>
                  </label>

                  <div className="rounded border border-zinc-800 bg-zinc-900/60 px-3 py-2 space-y-1">
                    <div className="text-[11px] text-zinc-500">Status</div>
                    <div className="text-xs text-zinc-200">{formatUpdateStatus(updateStatus)}</div>
                    {updateStatus?.availableVersion && (
                      <div className="text-[11px] text-zinc-400">
                        Available version: <span className="font-mono">{updateStatus.availableVersion}</span>
                      </div>
                    )}
                    {updateStatus?.error && (
                      <div className="text-[11px] text-red-400">{updateStatus.error}</div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void checkForUpdatesNow()}
                      disabled={updateBusy}
                      className="px-2.5 py-1.5 rounded bg-zinc-800 text-zinc-200 text-xs hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {updateBusy && updateStatus?.phase === 'checking' ? 'Checking...' : 'Check Now'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void installDownloadedUpdate()}
                      disabled={updateBusy || updateStatus?.phase !== 'downloaded'}
                      className="px-2.5 py-1.5 rounded bg-blue-600 text-white text-xs hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Restart and Install
                    </button>
                  </div>

                  <p className="text-[11px] text-zinc-500">
                    Automatic updates require packaged builds published with update metadata. Development builds will report that updates are unavailable.
                  </p>
                </div>
              </>
            )}

            {activeTab === 'interpolation' && (
              <>
                <div className="text-xs text-zinc-400">
                  Configure between-slice interpolation for labelmap segmentations. When enabled,
                  painting on two or more separated slices will automatically fill the gap slices
                  using the selected algorithm.
                </div>

                <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 space-y-4">
                  {/* Enable toggle */}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={interpPrefs.enabled}
                      onChange={(e) => setInterpolationEnabled(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-zinc-600 bg-zinc-800 accent-blue-500"
                    />
                    <span className="text-xs text-zinc-300">Enable between-slice interpolation</span>
                  </label>

                  {/* Algorithm selector */}
                  <label className="space-y-1">
                    <span className="text-[11px] text-zinc-500">Algorithm</span>
                    <select
                      value={interpPrefs.algorithm}
                      onChange={(e) =>
                        setInterpolationAlgorithm(e.target.value as InterpolationAlgorithm)
                      }
                      disabled={!interpPrefs.enabled}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 disabled:opacity-50"
                    >
                      {(Object.keys(INTERPOLATION_ALGORITHM_LABELS) as InterpolationAlgorithm[]).map(
                        (algo) => (
                          <option key={algo} value={algo}>
                            {INTERPOLATION_ALGORITHM_LABELS[algo]}
                          </option>
                        ),
                      )}
                    </select>
                  </label>

                  {/* Algorithm description */}
                  <p className="text-[11px] text-zinc-500 leading-relaxed">
                    {INTERPOLATION_ALGORITHM_DESCRIPTIONS[interpPrefs.algorithm]}
                  </p>

                  {/* Linear threshold — only shown for 'linear' algorithm */}
                  {interpPrefs.algorithm === 'linear' && (
                    <div className="space-y-1.5">
                      <label className="text-[11px] text-zinc-500 block">
                        Blend Threshold: {interpPrefs.linearThreshold.toFixed(2)}
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={interpPrefs.linearThreshold}
                        onChange={(e) => setLinearThreshold(parseFloat(e.target.value))}
                        disabled={!interpPrefs.enabled}
                        className="w-full h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-500 disabled:opacity-50"
                      />
                      <div className="flex justify-between text-[10px] text-zinc-600">
                        <span>0.0 (aggressive fill)</span>
                        <span>1.0 (conservative)</span>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {activeTab === 'backup' && (
              <>
                <div className="text-xs text-zinc-400">
                  Configure local file backup for segmentations. When enabled, all unsaved
                  segmentation changes are periodically written to a local cache, allowing
                  recovery if the app closes unexpectedly.
                </div>

                <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 space-y-4">
                  {/* Enable toggle */}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={backupPrefs.enabled}
                      onChange={(e) => setBackupEnabled(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-zinc-600 bg-zinc-800 accent-blue-500"
                    />
                    <span className="text-xs text-zinc-300">Enable local file backup</span>
                  </label>

                  {/* Frequency slider */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs text-zinc-300">Backup frequency</label>
                      <span className="text-[11px] text-zinc-400 tabular-nums">
                        {backupPrefs.intervalSeconds}s
                      </span>
                    </div>
                    <input
                      type="range"
                      min={5}
                      max={120}
                      step={5}
                      value={backupPrefs.intervalSeconds}
                      onChange={(e) => setBackupIntervalSeconds(parseInt(e.target.value, 10))}
                      disabled={!backupPrefs.enabled}
                      className="w-full h-1 bg-zinc-700 rounded-full appearance-none cursor-pointer accent-blue-500 disabled:opacity-50"
                    />
                    <div className="flex justify-between text-[10px] text-zinc-600 mt-0.5">
                      <span>5s</span>
                      <span>120s</span>
                    </div>
                  </div>

                  {/* Cache location */}
                  {backupCachePath && (
                    <div className="space-y-1">
                      <div className="text-[11px] text-zinc-500">Cache location</div>
                      <div className="text-[11px] text-zinc-400 font-mono bg-zinc-900/80 rounded px-2 py-1.5 break-all select-text">
                        {backupCachePath}
                      </div>
                    </div>
                  )}
                </div>

                {/* Server deletion settings */}
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 space-y-4">
                  <div className="text-xs text-zinc-400">
                    When deleting annotations from XNAT, optionally archive the DICOM file
                    to a session resource folder before removing the scan.
                  </div>

                  {/* Trash toggle */}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={deletionPrefs.trashOnServerDelete}
                      onChange={(e) => setTrashOnServerDelete(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-zinc-600 bg-zinc-800 accent-blue-500"
                    />
                    <span className="text-xs text-zinc-300">Archive to session resource before deleting</span>
                  </label>

                  {/* Resource name */}
                  {deletionPrefs.trashOnServerDelete && (
                    <div>
                      <label className="text-xs text-zinc-300 block mb-1">Resource folder name</label>
                      <input
                        type="text"
                        value={deletionPrefs.trashResourceName}
                        onChange={(e) => setTrashResourceName(e.target.value)}
                        placeholder="trash"
                        className="w-full text-xs text-zinc-200 bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 outline-none focus:border-blue-500 transition-colors"
                      />
                      <div className="text-[10px] text-zinc-600 mt-1">
                        Files will be copied to the session&apos;s <span className="font-mono">{deletionPrefs.trashResourceName || 'trash'}</span> resource.
                      </div>
                    </div>
                  )}
                </div>

                {/* Cached backups list — grouped by server */}
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-medium text-zinc-300">Cached Backups</h3>
                    <button
                      type="button"
                      onClick={() => {
                        setBackupLoading(true);
                        backupService.listAllBackups().then(setBackupSessions).catch(() => setBackupSessions([])).finally(() => setBackupLoading(false));
                      }}
                      className="px-2 py-1 rounded text-[11px] bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors"
                    >
                      Refresh
                    </button>
                  </div>

                  {backupLoading ? (
                    <div className="text-[11px] text-zinc-500">Loading...</div>
                  ) : backupSessions.length === 0 ? (
                    <div className="text-[11px] text-zinc-500">No cached backup files.</div>
                  ) : (
                    <div className="space-y-4">
                      {(() => {
                        // Group sessions by server URL
                        const byServer = new Map<string, typeof backupSessions>();
                        for (const s of backupSessions) {
                          const key = s.serverUrl || 'Unknown Server';
                          if (!byServer.has(key)) byServer.set(key, []);
                          byServer.get(key)!.push(s);
                        }
                        return Array.from(byServer.entries()).map(([serverUrl, sessions]) => (
                          <div key={serverUrl} className="space-y-2">
                            <div className="text-[11px] text-zinc-400 font-medium truncate" title={serverUrl}>
                              {serverUrl}
                            </div>
                            <div className="space-y-1.5 pl-2 border-l border-zinc-800">
                              {sessions.map((session) => {
                                const displayLabel = [
                                  session.projectId && `Project: ${session.projectId}`,
                                  session.subjectLabel && `Subject: ${session.subjectLabel}`,
                                  (session.sessionLabel && session.sessionLabel !== session.sessionId)
                                    ? `Session: ${session.sessionLabel}`
                                    : `Session: ${session.sessionId}`,
                                ].filter(Boolean).join('  \u00B7  ');

                                // Build XNAT web URL for this session
                                const xnatSessionUrl = serverUrl && serverUrl !== 'Unknown Server'
                                  ? `${serverUrl.replace(/\/$/, '')}/data/experiments/${session.sessionId}?format=html`
                                  : null;

                                return (
                                  <div
                                    key={session.sessionId}
                                    className="rounded border border-zinc-800 bg-zinc-900/60 px-2.5 py-2 space-y-1"
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="min-w-0">
                                        <div className="text-[11px] text-zinc-300 leading-relaxed">
                                          {displayLabel}
                                        </div>
                                        <div className="text-[10px] text-zinc-500 flex flex-wrap gap-x-2 mt-0.5">
                                          <span>{session.entryCount} file{session.entryCount !== 1 ? 's' : ''}</span>
                                          <span>{formatBytes(session.totalSizeBytes)}</span>
                                          <span>Last: {new Date(session.lastUpdated).toLocaleString()}</span>
                                        </div>
                                      </div>
                                      <div className="shrink-0 flex items-center gap-1.5">
                                        {onRecover && (
                                          <button
                                            type="button"
                                            disabled={recoveringSession === session.sessionId}
                                            onClick={async () => {
                                              setRecoveringSession(session.sessionId);
                                              try {
                                                await onRecover(session.sessionId);
                                              } finally {
                                                setRecoveringSession(null);
                                                onClose();
                                              }
                                            }}
                                            className="px-2 py-1 rounded text-[11px] bg-green-900/50 text-green-300 hover:bg-green-900/70 transition-colors disabled:opacity-50"

                                          >
                                            {recoveringSession === session.sessionId ? 'Recovering...' : 'Recover'}
                                          </button>
                                        )}
                                        {xnatSessionUrl && (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              window.electronAPI.shell.openExternal(xnatSessionUrl);
                                            }}
                                            className="px-2 py-1 rounded text-[11px] bg-zinc-800 text-blue-300 hover:bg-zinc-700 hover:text-blue-200 transition-colors"

                                          >
                                            Open
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const label = session.sessionLabel && session.sessionLabel !== session.sessionId
                                              ? session.sessionLabel
                                              : session.sessionId;
                                            setConfirmDeleteSession({ sessionId: session.sessionId, label });
                                          }}
                                          className="px-2 py-1 rounded text-[11px] bg-red-900/40 text-red-300 hover:bg-red-900/60 transition-colors"
                                        >
                                          Delete
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ));
                      })()}
                    </div>
                  )}
                </div>
              </>
            )}

            {activeTab === 'about' && (
              <div className="space-y-4">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5 space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-100">XNAT Workstation</h3>
                    <p className="text-xs text-zinc-500 mt-1">Version {APP_VERSION}</p>
                  </div>
                  <p className="text-xs text-zinc-300 leading-relaxed">
                    XNAT Workstation is provided with the XNAT project with contributions from{' '}
                    <button
                      type="button"
                      onClick={() => window.electronAPI.shell.openExternal('https://www.mir.wustl.edu/research/research-centers/computational-imaging-research-center-circ/labs/marcus-lab/')}
                      className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
                    >
                      Washington University
                    </button>
                    {' '}and{' '}
                    <button
                      type="button"
                      onClick={() => window.electronAPI.shell.openExternal('https://www.embarklabs.ai')}
                      className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
                    >
                      Embark Labs
                    </button>
                    .
                  </p>
                  <p className="text-xs text-zinc-300 leading-relaxed">
                    Email{' '}
                    <button
                      type="button"
                      onClick={() => window.electronAPI.shell.openExternal('mailto:info@xnat.org')}
                      className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
                    >
                      info@xnat.org
                    </button>
                    {' '}if you'd like to get in touch.
                  </p>
                </div>
              </div>
            )}

            {activeTab === 'issue' && (
              <>
                <div className="text-xs text-zinc-400">
                  Generate a de-identified report for support emails. The report includes app/runtime state,
                  system details, and recent main/renderer stdout/stderr logs with sensitive values redacted.
                </div>

                <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 space-y-3">
                  <label className="space-y-1 block">
                    <span className="text-[11px] text-zinc-500">Optional notes for developers</span>
                    <textarea
                      value={issueNotes}
                      onChange={(e) => setIssueNotes(e.target.value)}
                      placeholder="Describe what happened, expected behavior, and reproduction steps..."
                      rows={4}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 resize-y"
                    />
                  </label>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void refreshIssueReport()}
                      disabled={issueLoading}
                      className="px-2.5 py-1.5 rounded bg-zinc-800 text-zinc-200 text-xs hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {issueLoading ? 'Refreshing...' : 'Refresh Report'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void copyIssueReport()}
                      disabled={!issueReport}
                      className="px-2.5 py-1.5 rounded bg-blue-600 text-white text-xs hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Copy Report
                    </button>
                    {issueCopyStatus === 'copied' && (
                      <span className="text-[11px] text-emerald-400">Copied</span>
                    )}
                    {issueCopyStatus === 'error' && (
                      <span className="text-[11px] text-red-400">Copy failed</span>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                  <div className="text-[11px] text-zinc-500 mb-2">Copy/paste this into an email:</div>
                  <textarea
                    readOnly
                    value={issueReport}
                    className="w-full h-72 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[11px] text-zinc-300 font-mono leading-relaxed resize-y"
                  />
                </div>
              </>
            )}
          </div>

          <div className="h-12 shrink-0 border-t border-zinc-800 px-4 flex items-center justify-end">
            <button
              type="button"
              onClick={resetAll}
              className="px-2.5 py-1.5 rounded bg-zinc-800 text-zinc-200 text-xs hover:bg-zinc-700 transition-colors"
            >
              Reset All Preferences
            </button>
          </div>
        </div>
      </div>

      {/* Styled confirm-delete dialog (replaces native window.confirm) */}
      {confirmDeleteSession && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 rounded-xl">
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-5 max-w-sm mx-4">
            <h3 className="text-sm font-semibold text-zinc-100 mb-2">Delete Backup</h3>
            <p className="text-xs text-zinc-400 mb-4">
              Delete all backup files for <strong className="text-zinc-200">{confirmDeleteSession.label}</strong>? This cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteSession(null)}
                className="px-3 py-1.5 rounded text-xs bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const sid = confirmDeleteSession.sessionId;
                  setConfirmDeleteSession(null);
                  backupService.deleteSessionBackups(sid).then(() => {
                    setBackupSessions((prev) => prev.filter((s) => s.sessionId !== sid));
                  }).catch((err) => {
                    console.error('[Settings] Failed to delete backup session:', err);
                  });
                }}
                className="px-3 py-1.5 rounded text-xs bg-red-900/60 text-red-200 hover:bg-red-900/80 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
