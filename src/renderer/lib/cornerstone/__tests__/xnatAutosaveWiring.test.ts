// @vitest-environment jsdom
// composeXnatTransport reads window.electronAPI, so this suite needs a DOM env
// (the cornerstone __tests__ glob otherwise defaults to node).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * xnatAutosaveWiring — pure container assembly + end-to-end composition over a
 * FAKE electronAPI. No live server, no real upload.
 *
 * segmentationService / rtStructService are mocked so importing the wiring module
 * under test does NOT pull in the Cornerstone dicom-image-loader worker (which
 * can't initialize in the node test env). buildSerializedContainer is verified
 * purely via injected deps; composeXnatTransport is verified against the real
 * transportSaver + transportStore, but the segmentationService setters and the
 * DICOM exporters are mock fns — no Cornerstone runs.
 */
vi.mock('../segmentationService', () => ({
  segmentationService: {
    getPreferredDicomType: vi.fn(() => 'SEG'),
    exportToDicomSeg: vi.fn(async () => 'SEG_BASE64'),
    setSaveTransport: vi.fn(),
    setConflictResolver: vi.fn(),
    setXnatAutosaveEnabled: vi.fn(),
    flushContainerSave: vi.fn(async () => undefined),
  },
}));
vi.mock('../rtStructService', () => ({
  rtStructService: {
    exportToRtStruct: vi.fn(async () => 'RTSTRUCT_BASE64'),
  },
}));

import {
  buildSerializedContainer,
  composeXnatTransport,
  _resetXnatTransportComposition,
  type BuildSerializedContainerDeps,
} from '../xnatAutosaveWiring';
import { segmentationService } from '../segmentationService';
import { useSegmentationStore } from '../../../stores/segmentationStore';
import { useViewerStore } from '../../../stores/viewerStore';
import { useTransportStore } from '../../../stores/transportStore';

function makeDeps(overrides: Partial<BuildSerializedContainerDeps> = {}): BuildSerializedContainerDeps {
  return {
    kindOf: () => 'SEG',
    exportSeg: vi.fn(async () => 'SEG_BASE64'),
    exportRtStruct: vi.fn(async () => 'RTSTRUCT_BASE64'),
    originOf: () => ({ projectId: 'P1', sessionId: 'E1', sourceScanId: '4', scanId: '3004' }),
    viewerContextOf: () => ({ subjectId: 'SUBJ1', sessionLabel: 'EXP_LABEL' }),
    ...overrides,
  };
}

describe('buildSerializedContainer (pure)', () => {
  it('routes a SEG container to exportSeg and assembles SourceIdentity from origin + viewer context', async () => {
    const exportSeg = vi.fn(async () => 'SEG_BASE64');
    const exportRtStruct = vi.fn(async () => 'RTSTRUCT_BASE64');
    const deps = makeDeps({ kindOf: () => 'SEG', exportSeg, exportRtStruct });

    const result = await buildSerializedContainer('c1', deps);

    expect(exportSeg).toHaveBeenCalledWith('c1');
    expect(exportRtStruct).not.toHaveBeenCalled();
    expect(result).toEqual({
      containerId: 'c1',
      kind: 'SEG',
      base64: 'SEG_BASE64',
      source: {
        projectId: 'P1',
        subjectId: 'SUBJ1',
        sessionId: 'E1',
        sessionLabel: 'EXP_LABEL',
        sourceScanId: '4',
        scanId: '3004',
      },
    });
  });

  it('routes an RTSTRUCT container to exportRtStruct', async () => {
    const exportSeg = vi.fn(async () => 'SEG_BASE64');
    const exportRtStruct = vi.fn(async () => 'RTSTRUCT_BASE64');
    const deps = makeDeps({ kindOf: () => 'RTSTRUCT', exportSeg, exportRtStruct });

    const result = await buildSerializedContainer('roi1', deps);

    expect(exportRtStruct).toHaveBeenCalledWith('roi1');
    expect(exportSeg).not.toHaveBeenCalled();
    expect(result?.kind).toBe('RTSTRUCT');
    expect(result?.base64).toBe('RTSTRUCT_BASE64');
  });

  it('returns null (no save target) when origin is unknown — and never exports', async () => {
    const exportSeg = vi.fn(async () => 'SEG_BASE64');
    const exportRtStruct = vi.fn(async () => 'RTSTRUCT_BASE64');
    const deps = makeDeps({ originOf: () => undefined, exportSeg, exportRtStruct });

    const result = await buildSerializedContainer('orphan', deps);

    expect(result).toBeNull();
    expect(exportSeg).not.toHaveBeenCalled();
    expect(exportRtStruct).not.toHaveBeenCalled();
  });

  it('tolerates missing viewer context (subjectId empty, sessionLabel undefined)', async () => {
    const deps = makeDeps({ viewerContextOf: () => ({}) });
    const result = await buildSerializedContainer('c1', deps);
    expect(result?.source.subjectId).toBe('');
    expect(result?.source.sessionLabel).toBeUndefined();
  });
});

describe('composeXnatTransport (end-to-end over a FAKE electronAPI)', () => {
  const hadElectronApi = Object.prototype.hasOwnProperty.call(globalThis, 'window')
    && 'electronAPI' in (window as any);
  const realElectronApi = hadElectronApi ? (window as any).electronAPI : undefined;

  beforeEach(() => {
    _resetXnatTransportComposition();
    useTransportStore.getState().reset();
    useSegmentationStore.setState({ xnatOriginMap: {} } as any, false);
    vi.mocked(segmentationService.setSaveTransport).mockClear();
    vi.mocked(segmentationService.setConflictResolver).mockClear();
    vi.mocked(segmentationService.getPreferredDicomType).mockReturnValue('SEG');
    vi.mocked(segmentationService.exportToDicomSeg).mockResolvedValue('SEG_BASE64');
  });

  afterEach(() => {
    if (realElectronApi === undefined) {
      delete (window as any).electronAPI;
    } else {
      (window as any).electronAPI = realElectronApi;
    }
  });

  it('no-ops (no throw) when window.electronAPI.xnat is absent', () => {
    delete (window as any).electronAPI;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => composeXnatTransport()).not.toThrow();
    expect(warn).toHaveBeenCalled();
    expect(segmentationService.setSaveTransport).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('wires a real round-trip: serialize → fake upload → ok outcome + version token in transportStore', async () => {
    const uploadDicomSeg = vi.fn(async () => ({ ok: true, scanId: '3004', versionToken: 'v1' }));
    (window as any).electronAPI = {
      xnat: {
        uploadDicomSeg,
        uploadDicomRtStruct: vi.fn(),
        overwriteDicomSeg: vi.fn(async () => ({ ok: true, scanId: '3004', versionToken: 'v2' })),
        overwriteDicomRtStruct: vi.fn(),
      },
    };

    // Seed an origin so buildSerializedContainer can resolve a save target.
    // No persisted container scanId (empty) → first-save UPLOAD path, which is
    // where the assembled SourceIdentity flows into the upload call.
    useSegmentationStore.setState(
      { xnatOriginMap: { c1: { scanId: '', sourceScanId: '4', projectId: 'P1', sessionId: 'E1' } } } as any,
      false,
    );
    useViewerStore.setState(
      { xnatContext: { projectId: 'P1', subjectId: 'SUBJ1', sessionId: 'E1', sessionLabel: 'EXP', scanId: '4' } } as any,
      false,
    );

    composeXnatTransport();

    // Capture the transport fn installed via setSaveTransport (no autosave runs).
    const installed = vi.mocked(segmentationService.setSaveTransport).mock.calls[0]?.[0];
    expect(installed).toBeTypeOf('function');
    expect(segmentationService.setConflictResolver).toHaveBeenCalled();

    const outcome = await installed!('c1');
    expect(outcome).toEqual({ ok: true });
    expect(uploadDicomSeg).toHaveBeenCalledTimes(1);
    // The fake upload received the assembled SourceIdentity fields.
    expect(uploadDicomSeg).toHaveBeenCalledWith('P1', 'SUBJ1', 'E1', 'EXP', '4', 'SEG_BASE64', undefined);

    const entry = useTransportStore.getState().entries.c1;
    expect(entry.versionToken).toBe('v1');
  });

  it('is idempotent — a second compose does not re-install the transport', () => {
    (window as any).electronAPI = {
      xnat: {
        uploadDicomSeg: vi.fn(async () => ({ ok: true, scanId: '3004', versionToken: 'v1' })),
        uploadDicomRtStruct: vi.fn(),
        overwriteDicomSeg: vi.fn(),
        overwriteDicomRtStruct: vi.fn(),
      },
    };

    composeXnatTransport();
    composeXnatTransport();

    expect(segmentationService.setSaveTransport).toHaveBeenCalledTimes(1);
  });
});
