import { afterEach, describe, expect, it, vi } from 'vitest';
import { createXnatUploadApi, type XnatUploadElectronApi } from '../cornerstone/xnatUploadApi';
import {
  downloadDerivedScanFile,
  forgetDerivedScanFiles,
  setXnatScanApi,
  type ScanFileResult,
} from './scanApi';

function fakeScanApi(files: Record<string, string>) {
  const downloadScanFile = vi.fn(async (_sessionId: string, scanId: string): Promise<ScanFileResult> =>
    files[scanId] !== undefined ? { ok: true, data: new TextEncoder().encode(files[scanId]) } : { ok: false, error: 'scan missing' });
  setXnatScanApi({ getScans: async () => [], downloadScanFile });
  return downloadScanFile;
}

const text = (buffer: ArrayBuffer) => new TextDecoder().decode(buffer);

afterEach(() => setXnatScanApi(null));

describe('downloadDerivedScanFile', () => {
  it('decodes the file and throws when the download fails', async () => {
    fakeScanApi({ '11': 'ABC' });
    expect(Array.from(new Uint8Array(await downloadDerivedScanFile('S1', '11')))).toEqual([65, 66, 67]);
    await expect(downloadDerivedScanFile('S1', '12')).rejects.toThrow('scan missing');
  });

  it('returns only the bytes the IPC result views, not the rest of its buffer', async () => {
    const backing = new TextEncoder().encode('xxSEGyy');
    setXnatScanApi({ getScans: async () => [], downloadScanFile: async () => ({ ok: true, data: backing.subarray(2, 5) }) });
    expect(text(await downloadDerivedScanFile('S1', '3004'))).toBe('SEG');
  });

  it('downloads a file once for every caller, concurrent or later, and gives each its own copy', async () => {
    const download = fakeScanApi({ '3004': 'SEG' });

    const [first, second] = await Promise.all([
      downloadDerivedScanFile('S1', '3004'),
      downloadDerivedScanFile('S1', '3004'),
    ]);
    const later = await downloadDerivedScanFile('S1', '3004');

    expect(download).toHaveBeenCalledTimes(1);
    expect([text(first), text(second), text(later)]).toEqual(['SEG', 'SEG', 'SEG']);
    expect(first).not.toBe(second);
    expect(second).not.toBe(later);
  });

  it('keeps sessions apart', async () => {
    const download = fakeScanApi({ '3004': 'SEG' });
    await downloadDerivedScanFile('S1', '3004');
    await downloadDerivedScanFile('S2', '3004');
    expect(download).toHaveBeenCalledTimes(2);
  });

  it('does not keep a failed download', async () => {
    const files: Record<string, string> = {};
    const download = fakeScanApi(files);
    await expect(downloadDerivedScanFile('S1', '3004')).rejects.toThrow('scan missing');
    files['3004'] = 'SEG';
    expect(text(await downloadDerivedScanFile('S1', '3004'))).toBe('SEG');
    expect(download).toHaveBeenCalledTimes(2);
  });

  it('downloads again after its session is forgotten, and only that session', async () => {
    const files: Record<string, string> = { '3004': 'old' };
    const download = fakeScanApi(files);
    await downloadDerivedScanFile('S1', '3004');
    await downloadDerivedScanFile('S2', '3004');

    files['3004'] = 'new';
    forgetDerivedScanFiles('S1');

    expect(text(await downloadDerivedScanFile('S1', '3004'))).toBe('new');
    expect(text(await downloadDerivedScanFile('S2', '3004'))).toBe('old');
    expect(download).toHaveBeenCalledTimes(3);
  });

  it('downloads again after a new scan API is installed', async () => {
    fakeScanApi({ '3004': 'first' });
    await downloadDerivedScanFile('S1', '3004');
    fakeScanApi({ '3004': 'second' });
    expect(text(await downloadDerivedScanFile('S1', '3004'))).toBe('second');
  });
});

describe('writes through the upload API', () => {
  const ok = { ok: true, scanId: '3004', versionToken: 'sha1:x' };
  const overwrite = { sessionId: 'S1', targetScanId: '3004', dicomBase64: 'AA==', baseVersionToken: 'sha1:old' };
  const upload = { projectId: 'P', subjectId: 'SUB', sessionId: 'S1', sessionLabel: 'L', sourceScanId: '4', dicomBase64: 'AA==' };

  function uploadApi(overrides: Partial<XnatUploadElectronApi>) {
    const unexpected = () => Promise.reject(new Error('unexpected call'));
    return createXnatUploadApi({
      uploadDicomSeg: unexpected,
      uploadDicomRtStruct: unexpected,
      uploadDicomSr: unexpected,
      overwriteDicomSeg: unexpected,
      overwriteDicomRtStruct: unexpected,
      overwriteDicomSr: unexpected,
      getScanVersion: unexpected,
      ...overrides,
    });
  }

  it.each([
    ['overwriteSeg', 'overwriteDicomSeg'],
    ['overwriteRtStruct', 'overwriteDicomRtStruct'],
    ['overwriteSr', 'overwriteDicomSr'],
  ] as const)('%s makes the next download of the session fetch the new file', async (method, channel) => {
    const files: Record<string, string> = { '3004': 'before' };
    fakeScanApi(files);
    expect(text(await downloadDerivedScanFile('S1', '3004'))).toBe('before');

    const api = uploadApi({ [channel]: vi.fn(async () => { files['3004'] = 'after'; return ok; }) });
    await api[method](overwrite);

    expect(text(await downloadDerivedScanFile('S1', '3004'))).toBe('after');
  });

  it.each([
    ['uploadSeg', 'uploadDicomSeg'],
    ['uploadRtStruct', 'uploadDicomRtStruct'],
    ['uploadSr', 'uploadDicomSr'],
  ] as const)('%s makes the next download of the session fetch the new file', async (method, channel) => {
    const files: Record<string, string> = { '3004': 'deleted earlier' };
    fakeScanApi(files);
    await downloadDerivedScanFile('S1', '3004');

    const api = uploadApi({ [channel]: vi.fn(async () => { files['3004'] = 'uploaded'; return ok; }) });
    await api[method](upload);

    expect(text(await downloadDerivedScanFile('S1', '3004'))).toBe('uploaded');
  });

  it('a failed overwrite also makes the next download fetch the file', async () => {
    const files: Record<string, string> = { '3004': 'before' };
    const download = fakeScanApi(files);
    await downloadDerivedScanFile('S1', '3004');

    const api = uploadApi({ overwriteDicomSeg: vi.fn(async () => ({ ok: false, error: 'XNAT API error: 500' })) });
    await api.overwriteSeg(overwrite);

    await downloadDerivedScanFile('S1', '3004');
    expect(download).toHaveBeenCalledTimes(2);
  });
});
