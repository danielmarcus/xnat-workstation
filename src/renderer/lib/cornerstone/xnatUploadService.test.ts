/**
 * Unit tests for xnatUploadService — the upload-flow extraction
 * that backs both the legacy SegmentationPanel save menu and the
 * new ContainerListPanel ⋯ menu (Phase 6 / Stage 2B.2).
 *
 * Focuses on the decision tree (no panel context, missing content,
 * existing-save prompt → cancel/overwrite/create-new). The full
 * upload-and-cleanup branch involves ~10 electronAPI calls and
 * three Zustand stores; covered by the e2e smoke test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../stores/segmentationStore', () => ({
  useSegmentationStore: {
    getState: vi.fn(() => ({
      xnatOriginMap: {},
      segmentations: [{ segmentationId: 'seg-1', label: 'Test Seg' }],
      setXnatOrigin: vi.fn(),
      setDicomType: vi.fn(),
      _markClean: vi.fn(),
    })),
  },
}));

vi.mock('../../stores/segmentationManagerStore', () => ({
  useSegmentationManagerStore: {
    getState: vi.fn(() => ({
      recoveredSegIds: {},
      recordLoaded: vi.fn(),
      setLoadStatus: vi.fn(),
      clearDirty: vi.fn(),
      clearRecovered: vi.fn(),
      hasDirtySegmentations: () => false,
    })),
  },
}));

vi.mock('./segmentationService', () => ({
  segmentationService: {
    hasExportableContent: vi.fn(() => true),
  },
}));

vi.mock('../segmentation/segmentationManagerSingleton', () => ({
  segmentationManager: {
    beginManualSave: vi.fn(),
    endManualSave: vi.fn(),
    exportToDicomSeg: vi.fn(async () => 'BASE64_SEG'),
  },
}));

import {
  resetXnatUploadWiring,
  uploadSegmentationToXnat,
  wireXnatUpload,
  type ExistingSavePromptResult,
} from './xnatUploadService';

const electronApiStub = {
  xnat: {
    getScans: vi.fn(async () => [] as Array<{ id: string; seriesDescription?: string }>),
    uploadDicomSeg: vi.fn(async () => ({ ok: true, scanId: '3011' })),
    uploadDicomRtStruct: vi.fn(async () => ({ ok: true, scanId: '4011' })),
    overwriteDicomSeg: vi.fn(async () => ({ ok: true, scanId: '3011' })),
    overwriteDicomRtStruct: vi.fn(async () => ({ ok: true, scanId: '4011' })),
    listTempFiles: vi.fn(async () => ({ ok: true, files: [] })),
    deleteTempFile: vi.fn(async () => ({ ok: true })),
    downloadScanFile: vi.fn(async () => ({ ok: false, error: 'not used' })),
  },
};

beforeEach(() => {
  (window as unknown as { electronAPI?: unknown }).electronAPI = electronApiStub;
  vi.clearAllMocks();
});

afterEach(() => {
  resetXnatUploadWiring();
});

describe('xnatUploadService', () => {
  it('returns "failed" with a notify when no panel XNAT context is wired', async () => {
    const notify = vi.fn();
    wireXnatUpload({
      getPanelXnatContext: () => null,
      getSourceScanId: () => null,
      exportToBase64: vi.fn(),
      promptExisting: vi.fn(),
      notify,
    });

    const outcome = await uploadSegmentationToXnat('seg-1', 'SEG');

    expect(outcome).toBe('failed');
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('No XNAT session context'),
      'error',
    );
  });

  it('returns "failed" with a notify when the segmentation has no exportable content', async () => {
    const segService = await import('./segmentationService');
    (segService.segmentationService.hasExportableContent as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    const notify = vi.fn();
    wireXnatUpload({
      getPanelXnatContext: () => ({
        projectId: 'P', subjectId: 'S', sessionId: 'SESS', sessionLabel: 'L', scanId: '11',
      }),
      getSourceScanId: () => '11',
      exportToBase64: vi.fn(),
      promptExisting: vi.fn(),
      notify,
    });

    const outcome = await uploadSegmentationToXnat('seg-1', 'SEG');

    expect(outcome).toBe('failed');
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('Add at least one painted segment'),
      'error',
    );
  });

  it('returns "cancelled" when the existing-save prompt resolves to cancel', async () => {
    const segStore = await import('../../stores/segmentationStore');
    (segStore.useSegmentationStore.getState as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      xnatOriginMap: { 'seg-1': { scanId: '3011', sourceScanId: '11', projectId: 'P', sessionId: 'SESS' } },
      segmentations: [{ segmentationId: 'seg-1', label: 'Test Seg' }],
      setXnatOrigin: vi.fn(),
      setDicomType: vi.fn(),
      _markClean: vi.fn(),
    });
    const promptExisting = vi.fn(async (): Promise<ExistingSavePromptResult> => ({ action: 'cancel' }));
    const exportToBase64 = vi.fn();
    wireXnatUpload({
      getPanelXnatContext: () => ({
        projectId: 'P', subjectId: 'S', sessionId: 'SESS', sessionLabel: 'L', scanId: '11',
      }),
      getSourceScanId: () => '11',
      exportToBase64,
      promptExisting,
      notify: vi.fn(),
    });

    const outcome = await uploadSegmentationToXnat('seg-1', 'SEG');

    expect(outcome).toBe('cancelled');
    expect(promptExisting).toHaveBeenCalledWith('3011', 'SEG', expect.any(String));
    // Cancellation short-circuits BEFORE export — no base64 generation.
    expect(exportToBase64).not.toHaveBeenCalled();
  });

  it('uploads as new SEG (no existing scan) via electronAPI.xnat.uploadDicomSeg', async () => {
    const exportToBase64 = vi.fn(async () => 'BASE64_PAYLOAD');
    const notify = vi.fn();
    wireXnatUpload({
      getPanelXnatContext: () => ({
        projectId: 'P', subjectId: 'S', sessionId: 'SESS', sessionLabel: 'L', scanId: '11',
      }),
      getSourceScanId: () => '11',
      exportToBase64,
      promptExisting: vi.fn(async () => ({ action: 'cancel' })),
      notify,
    });

    const outcome = await uploadSegmentationToXnat('seg-1', 'SEG');

    expect(outcome).toBe('saved');
    expect(electronApiStub.xnat.uploadDicomSeg).toHaveBeenCalledWith(
      'P', 'S', 'SESS', 'L', '11', 'BASE64_PAYLOAD', 'Test Seg',
    );
    expect(notify).toHaveBeenCalledWith(
      expect.stringMatching(/Uploaded SEG as scan 3011/),
      'success',
    );
  });
});
