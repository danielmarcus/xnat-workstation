import { deidentifyText } from '@shared/diagnostics/deidentify';
import type { DiagnosticsLogEntry, MainDiagnosticsSnapshotResult } from '@shared/types/diagnostics';
import { useConnectionStore } from '../../stores/connectionStore';
import { usePreferencesStore } from '../../stores/preferencesStore';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { useViewerStore } from '../../stores/viewerStore';
import { getRendererLogEntries } from './rendererLogBuffer';

function formatLogLines(label: string, entries: DiagnosticsLogEntry[]): string[] {
  if (entries.length === 0) return [`${label}: (none)`];
  return [
    `${label}:`,
    ...entries.map((entry) => `- [${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}`),
  ];
}

function formatConnectionAge(connectedAt?: number): string {
  if (!connectedAt) return 'n/a';
  const elapsedSec = Math.max(0, Math.floor((Date.now() - connectedAt) / 1000));
  return `${elapsedSec}s`;
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export async function buildIssueReport(userNotes: string): Promise<string> {
  let mainSnapshot: MainDiagnosticsSnapshotResult;
  try {
    if (!window.electronAPI.diagnostics?.getMainSnapshot) {
      mainSnapshot = { ok: false, error: 'diagnostics bridge unavailable' };
    } else {
      mainSnapshot = await window.electronAPI.diagnostics.getMainSnapshot();
    }
  } catch (err) {
    mainSnapshot = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const connection = useConnectionStore.getState();
  const viewer = useViewerStore.getState();
  const segmentation = useSegmentationStore.getState();
  const preferences = usePreferencesStore.getState().preferences;

  const loadedPanels = Object.entries(viewer.panelImageIdsMap)
    .filter(([, ids]) => ids.length > 0)
    .map(([panelId, ids]) => ({ panelId, imageCount: ids.length }));

  const rendererLogs = getRendererLogEntries(160);
  const rendererStdout = rendererLogs.filter((entry) => entry.stream === 'stdout');
  const rendererStderr = rendererLogs.filter((entry) => entry.stream === 'stderr');

  const lines: string[] = [
    'XNAT Workstation Issue Report (De-identified)',
    `Generated: ${new Date().toISOString()}`,
    '',
    'Reporter Notes:',
    userNotes.trim() ? deidentifyText(userNotes.trim()) : '(none provided)',
    '',
    'App State Summary:',
    `- Connection status: ${connection.status}`,
    `- Connected duration: ${formatConnectionAge(connection.connection?.connectedAt)}`,
    `- Active viewport: ${viewer.activeViewportId}`,
    `- Layout: ${viewer.layout}`,
    `- MPR active: ${viewer.mprActive}`,
    `- Loaded panels: ${loadedPanels.length}`,
    `- Segmentations loaded: ${segmentation.segmentations.length}`,
    `- Active segmentation present: ${segmentation.activeSegmentationId ? 'yes' : 'no'}`,
    `- Unsaved changes flag: ${segmentation.hasUnsavedChanges}`,
    '',
    'Loaded Panel Image Counts:',
    ...(loadedPanels.length > 0
      ? loadedPanels.map((panel) => `- ${panel.panelId}: ${panel.imageCount}`)
      : ['(none)']),
    '',
    'Preferences Snapshot (safe subset):',
    formatJson({
      overlay: {
        visible: preferences.overlay.showViewportContextOverlay,
        horizontalRuler: preferences.overlay.showHorizontalRuler,
        verticalRuler: preferences.overlay.showVerticalRuler,
        orientationMarkers: preferences.overlay.showOrientationMarkers,
      },
      annotation: {
        brushSize: preferences.annotation.defaultBrushSize,
        contourThickness: preferences.annotation.defaultContourThickness,
        maskOutlines: preferences.annotation.defaultMaskOutlines,
        autoDisplay: preferences.annotation.autoDisplayAnnotations,
        segmentOpacity: preferences.annotation.defaultSegmentOpacity,
        colorCount: preferences.annotation.defaultColorSequence.length,
      },
      interpolation: preferences.interpolation,
      backup: preferences.backup,
    }),
    '',
  ];

  if (mainSnapshot.ok) {
    lines.push(
      'Main Process Snapshot:',
      formatJson(mainSnapshot.snapshot.app),
      formatJson(mainSnapshot.snapshot.runtime),
      formatJson(mainSnapshot.snapshot.system),
      formatJson(mainSnapshot.snapshot.process),
      '',
      ...formatLogLines('Main stdout (recent)', mainSnapshot.snapshot.logs.stdout),
      '',
      ...formatLogLines('Main stderr (recent)', mainSnapshot.snapshot.logs.stderr),
      '',
    );
  } else {
    lines.push(
      'Main Process Snapshot:',
      `- failed to collect: ${deidentifyText(mainSnapshot.error)}`,
      '',
    );
  }

  lines.push(
    ...formatLogLines('Renderer stdout (recent)', rendererStdout),
    '',
    ...formatLogLines('Renderer stderr (recent)', rendererStderr),
    '',
    'End of Report',
  );

  return lines.flat().join('\n');
}
