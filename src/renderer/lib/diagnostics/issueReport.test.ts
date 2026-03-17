import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MainDiagnosticsSnapshot } from '@shared/types/diagnostics';
import { useConnectionStore } from '../../stores/connectionStore';
import { usePreferencesStore } from '../../stores/preferencesStore';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { useViewerStore } from '../../stores/viewerStore';
import { buildIssueReport } from './issueReport';
import { getRendererLogEntries } from './rendererLogBuffer';

vi.mock('./rendererLogBuffer', () => ({
  getRendererLogEntries: vi.fn(),
}));

const mockedGetRendererLogEntries = vi.mocked(getRendererLogEntries);

const baseMainSnapshot: MainDiagnosticsSnapshot = {
  generatedAt: '2026-03-06T12:00:00.000Z',
  app: {
    name: 'XNAT Workstation',
    version: '0.5.2',
    isPackaged: false,
    pid: 120,
    uptimeSec: 22,
    windowCount: 1,
  },
  runtime: {
    electron: '40.2.1',
    chrome: '132.0.0',
    node: '20.0.0',
    v8: '12.0',
    platform: 'darwin',
    arch: 'arm64',
  },
  system: {
    osType: 'Darwin',
    osRelease: '24.4.0',
    osVersion: 'macOS',
    cpuModel: 'Mock CPU',
    cpuCount: 8,
    totalMemoryMB: 16384,
    freeMemoryMB: 4096,
    loadAverage: [0.1, 0.2, 0.3],
    hostnameFingerprint: 'abc123def456',
  },
  process: {
    rssMB: 320,
    heapUsedMB: 128,
    heapTotalMB: 256,
    externalMB: 8,
    argv: ['xnat'],
  },
  logs: {
    stdout: [
      {
        timestamp: '2026-03-06T11:59:58.000Z',
        source: 'main',
        stream: 'stdout',
        level: 'info',
        message: 'main started',
      },
    ],
    stderr: [
      {
        timestamp: '2026-03-06T11:59:59.000Z',
        source: 'main',
        stream: 'stderr',
        level: 'error',
        message: 'main warning',
      },
    ],
  },
};

function resetStores(): void {
  useConnectionStore.setState(useConnectionStore.getInitialState(), true);
  useViewerStore.setState(useViewerStore.getInitialState(), true);
  useSegmentationStore.setState(useSegmentationStore.getInitialState(), true);
  usePreferencesStore.setState(usePreferencesStore.getInitialState(), true);
}

describe('buildIssueReport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-06T12:00:00.000Z'));
    resetStores();
    mockedGetRendererLogEntries.mockReset();
    mockedGetRendererLogEntries.mockReturnValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds a de-identified report with store summaries and log sections', async () => {
    useConnectionStore.setState({
      status: 'connected',
      connection: { connectedAt: Date.now() - 12000 } as any,
      error: null,
    });
    useViewerStore.setState({
      activeViewportId: 'panel_0',
      layout: '2x1',
      mprActive: true,
      panelImageIdsMap: { panel_0: ['img:1', 'img:2'], panel_1: [] },
    });
    useSegmentationStore.setState({
      segmentations: [
        { segmentationId: 'seg-1', label: 'Seg 1', segments: [], isActive: true },
      ],
      activeSegmentationId: 'seg-1',
      hasUnsavedChanges: true,
    });
    usePreferencesStore.setState((state) => ({
      preferences: {
        ...state.preferences,
        overlay: {
          ...state.preferences.overlay,
          showViewportContextOverlay: false,
          showHorizontalRuler: false,
          showVerticalRuler: true,
          showOrientationMarkers: false,
        },
      },
    }));

    mockedGetRendererLogEntries.mockReturnValue([
      {
        timestamp: '2026-03-06T11:59:56.000Z',
        source: 'renderer',
        stream: 'stdout',
        level: 'info',
        message: 'renderer loaded',
      },
      {
        timestamp: '2026-03-06T11:59:57.000Z',
        source: 'renderer',
        stream: 'stderr',
        level: 'error',
        message: 'renderer warning',
      },
    ]);

    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        diagnostics: {
          getMainSnapshot: vi.fn(async () => ({ ok: true as const, snapshot: baseMainSnapshot })),
        },
      } as any,
    });

    const report = await buildIssueReport(
      'Contact me: dev@example.com Authorization: Bearer super-secret-token',
    );

    expect(report).toContain('XNAT Workstation Issue Report (De-identified)');
    expect(report).toContain('Connection status: connected');
    expect(report).toContain('Connected duration: 12s');
    expect(report).toContain('Loaded panels: 1');
    expect(report).toContain('- panel_0: 2');
    expect(report).not.toContain('panel_1:');
    expect(report).toContain('<email-redacted>');
    expect(report).toContain('Authorization: Bearer <token-redacted>');
    expect(report).toContain('Main stdout (recent):');
    expect(report).toContain('main started');
    expect(report).toContain('Renderer stderr (recent):');
    expect(report).toContain('renderer warning');
    expect(report).toContain('"visible": false');
    expect(report).toContain('End of Report');
  });

  it('handles unavailable diagnostics bridge without throwing', async () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {} as any,
    });

    const report = await buildIssueReport('');

    expect(report).toContain('Main Process Snapshot:');
    expect(report).toContain('- failed to collect: diagnostics bridge unavailable');
    expect(report).toContain('Renderer stdout (recent): (none)');
    expect(report).toContain('Renderer stderr (recent): (none)');
  });

  it('redacts thrown diagnostics errors from main bridge calls', async () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        diagnostics: {
          getMainSnapshot: vi.fn(async () => {
            throw new Error('fetch failed at https://xnat.example.org/data/archive?auth=abc123');
          }),
        },
      } as any,
    });

    const report = await buildIssueReport('notes');

    expect(report).toContain('failed to collect: fetch failed at');
    expect(report).toContain('https://<host-redacted>/data/archive/...?<query-redacted>');
    expect(report).not.toContain('xnat.example.org');
    expect(report).not.toContain('auth=abc123');
  });

  it('redacts returned error payloads when diagnostics call fails cleanly', async () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        diagnostics: {
          getMainSnapshot: vi.fn(async () => ({
            ok: false as const,
            error: 'failure for user john@example.com at /Users/dan/secret',
          })),
        },
      } as any,
    });

    const report = await buildIssueReport('notes');

    expect(report).toContain('failed to collect:');
    expect(report).toContain('<email-redacted>');
    expect(report).toContain('/Users/<user>/secret');
    expect(report).not.toContain('john@example.com');
    expect(report).not.toContain('/Users/dan/secret');
  });
});
