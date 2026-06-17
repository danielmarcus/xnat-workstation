import { describe, expect, it, vi } from 'vitest';
import {
  createXnatUploadApi,
  type XnatUploadElectronApi,
} from '../xnatUploadApi';

/**
 * xnatUploadApi (Transport TR5, renderer side) — verifies the wrapper's REAL
 * mapping logic from IPC results to the `XnatUploadApi` contract. The electronAPI
 * is a plain in-memory fake (canned IPC results, NO real calls, NO live server),
 * so this exercises the success/scanId/versionToken pass-through and the
 * conflict / transient / permanent classification — not a stub.
 */

const UPLOAD_ARGS = {
  projectId: 'P',
  subjectId: 'S',
  sessionId: 'E1',
  sessionLabel: 'SESS_LABEL',
  sourceScanId: '4',
  dicomBase64: 'QUFBQQ==',
} as const;

const OVERWRITE_ARGS = {
  sessionId: 'E1',
  targetScanId: '3004',
  dicomBase64: 'QkJCQg==',
  baseVersionToken: 'sha1:old',
  seriesDescription: 'Liver',
} as const;

/** Build a fake electronAPI.xnat slice; override only the method under test. */
function fakeApi(overrides: Partial<XnatUploadElectronApi>): XnatUploadElectronApi {
  const reject = () => Promise.reject(new Error('unexpected call'));
  return {
    uploadDicomSeg: overrides.uploadDicomSeg ?? reject,
    uploadDicomRtStruct: overrides.uploadDicomRtStruct ?? reject,
    uploadDicomSr: overrides.uploadDicomSr ?? reject,
    overwriteDicomSeg: overrides.overwriteDicomSeg ?? reject,
    overwriteDicomRtStruct: overrides.overwriteDicomRtStruct ?? reject,
    overwriteDicomSr: overrides.overwriteDicomSr ?? reject,
    getScanVersion: overrides.getScanVersion ?? reject,
  };
}

describe('createXnatUploadApi', () => {
  describe('uploadSeg', () => {
    it('first save → ok with scanId + versionToken (passed through from IPC)', async () => {
      const uploadDicomSeg = vi.fn().mockResolvedValue({
        ok: true,
        url: 'https://xnat/data/.../scans/3004',
        scanId: '3004',
        versionToken: 'sha1:abc123',
      });
      const api = createXnatUploadApi(fakeApi({ uploadDicomSeg }));

      const res = await api.uploadSeg(UPLOAD_ARGS);

      expect(res).toEqual({ ok: true, scanId: '3004', versionToken: 'sha1:abc123' });
      // Real wrapper forwards positional IPC args in order.
      expect(uploadDicomSeg).toHaveBeenCalledWith('P', 'S', 'E1', 'SESS_LABEL', '4', 'QUFBQQ==', undefined);
    });

    it('success missing versionToken → permanent error (does not fabricate a token)', async () => {
      const api = createXnatUploadApi(
        fakeApi({ uploadDicomSeg: vi.fn().mockResolvedValue({ ok: true, scanId: '3004' }) }),
      );
      const res = await api.uploadSeg(UPLOAD_ARGS);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.kind).toBe('permanent');
    });

    it('transient failure (network) → { ok:false, kind:"transient" }', async () => {
      const api = createXnatUploadApi(
        fakeApi({
          uploadDicomSeg: vi.fn().mockResolvedValue({ ok: false, error: 'network error: fetch failed' }),
        }),
      );
      const res = await api.uploadSeg(UPLOAD_ARGS);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.kind).toBe('transient');
        expect(res.conflict).toBeUndefined();
      }
    });

    it('thrown IPC call → transient (safe to retry)', async () => {
      const api = createXnatUploadApi(
        fakeApi({ uploadDicomSeg: vi.fn().mockRejectedValue(new Error('IPC channel closed')) }),
      );
      const res = await api.uploadSeg(UPLOAD_ARGS);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.kind).toBe('transient');
    });

    it('permanent failure (4xx) → { ok:false, kind:"permanent" }', async () => {
      const api = createXnatUploadApi(
        fakeApi({
          uploadDicomSeg: vi.fn().mockResolvedValue({
            ok: false,
            error: 'Permission denied: you do not have write access to this project',
          }),
        }),
      );
      const res = await api.uploadSeg(UPLOAD_ARGS);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.kind).toBe('permanent');
    });

    it('permanent failure (403 status in message) → permanent', async () => {
      const api = createXnatUploadApi(
        fakeApi({
          uploadDicomSeg: vi.fn().mockResolvedValue({
            ok: false,
            error: 'Failed to create SEG scan 3004: 403 Forbidden',
          }),
        }),
      );
      const res = await api.uploadSeg(UPLOAD_ARGS);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.kind).toBe('permanent');
    });
  });

  describe('overwriteSeg', () => {
    it('overwrite success → ok with new versionToken', async () => {
      const overwriteDicomSeg = vi.fn().mockResolvedValue({
        ok: true,
        url: 'https://xnat/.../scans/3004',
        scanId: '3004',
        versionToken: 'sha1:def456',
      });
      const api = createXnatUploadApi(fakeApi({ overwriteDicomSeg }));

      const res = await api.overwriteSeg(OVERWRITE_ARGS);

      expect(res).toEqual({ ok: true, scanId: '3004', versionToken: 'sha1:def456' });
      // The series description (user label) flows through to the overwrite IPC.
      expect(overwriteDicomSeg).toHaveBeenCalledWith('E1', '3004', 'QkJCQg==', 'Liver');
    });

    it('overwrite conflict (409) → { ok:false, conflict:true, serverVersionToken }', async () => {
      const api = createXnatUploadApi(
        fakeApi({
          overwriteDicomSeg: vi.fn().mockResolvedValue({
            ok: false,
            error: 'Failed to overwrite SEG in scan 3004: 409 Conflict',
            conflict: true,
            serverVersionToken: 'sha1:server-newer',
          }),
        }),
      );
      const res = await api.overwriteSeg(OVERWRITE_ARGS);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.conflict).toBe(true);
        expect(res.serverVersionToken).toBe('sha1:server-newer');
        // A conflict is NOT classified as transient/permanent.
        expect(res.kind).toBeUndefined();
      }
    });

    it('overwrite conflict detected from a 409 marker even without explicit conflict flag', async () => {
      const api = createXnatUploadApi(
        fakeApi({
          overwriteDicomSeg: vi.fn().mockResolvedValue({
            ok: false,
            error: 'Failed to overwrite SEG in scan 3004: 409 version conflict',
          }),
        }),
      );
      const res = await api.overwriteSeg(OVERWRITE_ARGS);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.conflict).toBe(true);
    });

    it('overwrite transient (5xx) → transient', async () => {
      const api = createXnatUploadApi(
        fakeApi({
          overwriteDicomSeg: vi.fn().mockResolvedValue({
            ok: false,
            error: 'Failed to overwrite SEG in scan 3004: 503 Service Unavailable',
          }),
        }),
      );
      const res = await api.overwriteSeg(OVERWRITE_ARGS);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.kind).toBe('transient');
    });

    it('overwriteSeg always uses the SEG channel (kind routing is the transport\'s job, not a scan-id guess)', async () => {
      const overwriteDicomSeg = vi.fn().mockResolvedValue({ ok: true, scanId: '3004', versionToken: 'sha1:x' });
      const overwriteDicomRtStruct = vi.fn();
      const api = createXnatUploadApi(fakeApi({ overwriteDicomSeg, overwriteDicomRtStruct }));

      await api.overwriteSeg(OVERWRITE_ARGS);

      expect(overwriteDicomSeg).toHaveBeenCalledTimes(1);
      expect(overwriteDicomRtStruct).not.toHaveBeenCalled();
    });
  });

  describe('RTSTRUCT channel', () => {
    it('uploadRtStruct → uploadDicomRtStruct (first save), passing through scanId + versionToken', async () => {
      const uploadDicomRtStruct = vi.fn().mockResolvedValue({ ok: true, scanId: '4004', versionToken: 'sha1:rt1' });
      const uploadDicomSeg = vi.fn();
      const api = createXnatUploadApi(fakeApi({ uploadDicomRtStruct, uploadDicomSeg }));

      const res = await api.uploadRtStruct(UPLOAD_ARGS);

      expect(res).toEqual({ ok: true, scanId: '4004', versionToken: 'sha1:rt1' });
      expect(uploadDicomRtStruct).toHaveBeenCalledWith('P', 'S', 'E1', 'SESS_LABEL', '4', 'QUFBQQ==', undefined);
      expect(uploadDicomSeg).not.toHaveBeenCalled();
    });

    it('overwriteRtStruct → overwriteDicomRtStruct (update), never the SEG channel', async () => {
      const overwriteDicomRtStruct = vi.fn().mockResolvedValue({ ok: true, scanId: '4004', versionToken: 'sha1:rt2' });
      const overwriteDicomSeg = vi.fn();
      const api = createXnatUploadApi(fakeApi({ overwriteDicomRtStruct, overwriteDicomSeg }));

      const res = await api.overwriteRtStruct(OVERWRITE_ARGS);

      expect(res).toEqual({ ok: true, scanId: '4004', versionToken: 'sha1:rt2' });
      expect(overwriteDicomRtStruct).toHaveBeenCalledWith('E1', '3004', 'QkJCQg==', 'Liver');
      expect(overwriteDicomSeg).not.toHaveBeenCalled();
    });

    it('classifies an RTSTRUCT upload failure (conflict) like the SEG channel', async () => {
      const uploadDicomRtStruct = vi.fn().mockResolvedValue({ ok: false, error: 'HTTP 409 version conflict', serverVersionToken: 'sha1:srv' });
      const api = createXnatUploadApi(fakeApi({ uploadDicomRtStruct }));

      const res = await api.uploadRtStruct(UPLOAD_ARGS);

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.conflict).toBe(true);
        expect(res.serverVersionToken).toBe('sha1:srv');
      }
    });
  });

  describe('getVersion (H6 — server-version poll)', () => {
    it('passes through the server token from the getScanVersion IPC', async () => {
      const getScanVersion = vi.fn().mockResolvedValue('sha1:server-current');
      const api = createXnatUploadApi(fakeApi({ getScanVersion }));
      await expect(api.getVersion({ sessionId: 'E1', scanId: '3004' })).resolves.toBe('sha1:server-current');
      expect(getScanVersion).toHaveBeenCalledWith('E1', '3004');
    });

    it('returns null when the IPC reports the version is unknown', async () => {
      const api = createXnatUploadApi(fakeApi({ getScanVersion: vi.fn().mockResolvedValue(null) }));
      await expect(api.getVersion({ sessionId: 'E1', scanId: '3004' })).resolves.toBeNull();
    });

    it('returns null (not throw) when the version IPC fails — degrades to last-write-wins', async () => {
      const api = createXnatUploadApi(fakeApi({ getScanVersion: vi.fn().mockRejectedValue(new Error('IPC closed')) }));
      await expect(api.getVersion({ sessionId: 'E1', scanId: '3004' })).resolves.toBeNull();
    });
  });
});
