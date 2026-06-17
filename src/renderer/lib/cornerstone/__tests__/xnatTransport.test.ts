import { describe, expect, it, vi } from 'vitest';
import { createXnatTransport } from '../xnatTransport';
import { createMockXnatApi } from '../mockXnatApi';
import type { XnatUploadApi } from '../xnatTransport';
import type { SerializedContainer } from '../annotationTransport';

/**
 * Transport TR5 (renderer side) — the real xnatTransport adapter that calls the
 * XNAT upload/overwrite/version API, verified against the in-memory mock that
 * simulates XNAT (the mocked-XNAT harness). This exercises the ACTUAL adapter code
 * (first-save → upload → scanId mapping H8; update → overwrite; stale → conflict
 * H5; version polling H6) without a live server. The real electronAPI.xnat is the
 * production XnatUploadApi (its handlers must be extended to return version tokens).
 */
function ser(
  containerId: string,
  scanId?: string,
  base64 = 'AAAA',
  kind: SerializedContainer['kind'] = 'SEG',
): SerializedContainer {
  return {
    containerId,
    kind,
    base64,
    source: { projectId: 'P', subjectId: 'S', sessionId: 'E1', sessionLabel: 'EXP', sourceScanId: '4', scanId },
  };
}

describe('createXnatTransport over the mock XNAT API', () => {
  it('first save (no scanId) UPLOADS, returns a version token + the new scanId (H8)', async () => {
    const t = createXnatTransport(createMockXnatApi());
    const r = await t.save(ser('c1'), null);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scanId).toBeTruthy(); // new XNAT scan id assigned
      expect(r.versionToken).toBeTruthy();
    }
  });

  it('a subsequent save OVERWRITES the mapped scan and advances the version', async () => {
    const t = createXnatTransport(createMockXnatApi());
    const first = await t.save(ser('c1'), null);
    const token1 = first.ok ? first.versionToken : '';
    const second = await t.save(ser('c1'), token1); // adapter remembers the scanId → overwrite
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.versionToken).not.toBe(token1);
  });

  it('a save based on a stale token is a conflict, returning the server token (H5)', async () => {
    const api = createMockXnatApi();
    const t = createXnatTransport(api);
    const first = await t.save(ser('c1'), null);
    const token1 = first.ok ? first.versionToken : '';
    await t.save(ser('c1'), token1); // → token2 on the server
    const stale = await t.save(ser('c1'), token1); // still based on token1
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.kind).toBe('conflict');
      expect(stale.serverVersionToken).toBeTruthy();
    }
  });

  it('classifies a permanent (auth/4xx) failure as permanent (no retry)', async () => {
    const api = createMockXnatApi();
    api._failNext({ kind: 'permanent', error: 'forbidden' });
    const t = createXnatTransport(api);
    const r = await t.save(ser('c1'), null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('permanent');
  });

  it('classifies a transient (5xx/network) failure as transient (retryable)', async () => {
    const api = createMockXnatApi();
    api._failNext({ kind: 'transient', error: 'gateway timeout' });
    const t = createXnatTransport(api);
    const r = await t.save(ser('c1'), null);
    if (!r.ok) expect(r.kind).toBe('transient');
  });

  it('routes by container kind: a SEG container uploads via the SEG channel (30xx scan id)', async () => {
    const t = createXnatTransport(createMockXnatApi());
    const r = await t.save(ser('seg1', undefined, 'AAAA', 'SEG'), null);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.scanId?.startsWith('30')).toBe(true); // SEG convention
  });

  it('routes by container kind: an RTSTRUCT container uploads via the RTSTRUCT channel (40xx scan id), then overwrites it', async () => {
    const t = createXnatTransport(createMockXnatApi());
    const first = await t.save(ser('rt1', undefined, 'AAAA', 'RTSTRUCT'), null);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.scanId?.startsWith('40')).toBe(true); // RTSTRUCT convention — proves the RTSTRUCT channel
    // A follow-up save overwrites the same RTSTRUCT scan (not a new upload) and advances the version.
    const second = await t.save(ser('rt1', undefined, 'BBBB', 'RTSTRUCT'), first.versionToken);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.scanId).toBe(first.scanId);
      expect(second.versionToken).not.toBe(first.versionToken);
    }
  });

  it('routes by container kind: an SR container uploads via the SR channel (50xx scan id), then overwrites it', async () => {
    const t = createXnatTransport(createMockXnatApi());
    const first = await t.save(ser('sr1', undefined, 'AAAA', 'SR'), null);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.scanId?.startsWith('50')).toBe(true); // SR convention — proves the SR channel
    const second = await t.save(ser('sr1', undefined, 'BBBB', 'SR'), first.versionToken);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.scanId).toBe(first.scanId);
      expect(second.versionToken).not.toBe(first.versionToken);
    }
  });

  it('getServerVersion reflects the mapped scan version; external edit bumps it (H6)', async () => {
    const api = createMockXnatApi();
    const t = createXnatTransport(api);
    const first = await t.save(ser('c1'), null);
    const token1 = first.ok ? first.versionToken : '';
    expect(await t.getServerVersion('c1')).toBe(token1);
    api._externalEdit('E1', first.ok ? first.scanId! : '');
    expect(await t.getServerVersion('c1')).not.toBe(token1);
  });

  // ── Client-side pre-overwrite conflict detection (#64-A, H5/H6) ──
  // Real XNAT has no native optimistic concurrency, so the transport polls
  // getVersion BEFORE an overwrite and compares it to the base token it holds.
  describe('client-side pre-overwrite conflict check', () => {
    const W_OK = { ok: true as const, scanId: '3004', versionToken: 'v-after-overwrite' };
    function fakeApi(over: Partial<XnatUploadApi>): XnatUploadApi {
      return {
        uploadSeg: vi.fn(async () => ({ ok: true as const, scanId: '3004', versionToken: 'v1' })),
        uploadRtStruct: vi.fn(async () => ({ ok: true as const, scanId: '4004', versionToken: 'v1' })),
        uploadSr: vi.fn(async () => ({ ok: true as const, scanId: '5004', versionToken: 'v1' })),
        overwriteSeg: vi.fn(async () => W_OK),
        overwriteRtStruct: vi.fn(async () => W_OK),
        overwriteSr: vi.fn(async () => W_OK),
        getVersion: vi.fn(async () => null),
        ...over,
      };
    }

    it('polls the server version and CONFLICTS (without overwriting) when it differs from the base', async () => {
      const overwriteSeg = vi.fn(async () => W_OK);
      const getVersion = vi.fn(async () => 'sha1:server-moved-on');
      const t = createXnatTransport(fakeApi({ overwriteSeg, getVersion }));

      // scanId in source → straight to the overwrite branch (no prior upload needed).
      const r = await t.save(ser('c1', '3004'), 'sha1:my-base');

      expect(getVersion).toHaveBeenCalledWith({ sessionId: 'E1', scanId: '3004' });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.kind).toBe('conflict');
        expect(r.serverVersionToken).toBe('sha1:server-moved-on');
      }
      expect(overwriteSeg).not.toHaveBeenCalled(); // never clobbered the server
    });

    it('proceeds with the overwrite when the server version MATCHES the base', async () => {
      const overwriteSeg = vi.fn(async () => W_OK);
      const t = createXnatTransport(fakeApi({ overwriteSeg, getVersion: vi.fn(async () => 'sha1:my-base') }));
      const r = await t.save(ser('c1', '3004'), 'sha1:my-base');
      expect(r.ok).toBe(true);
      expect(overwriteSeg).toHaveBeenCalledTimes(1);
    });

    it('degrades to last-write-wins (proceeds) when the server version is unknown (null)', async () => {
      const overwriteSeg = vi.fn(async () => W_OK);
      const t = createXnatTransport(fakeApi({ overwriteSeg, getVersion: vi.fn(async () => null) }));
      const r = await t.save(ser('c1', '3004'), 'sha1:my-base');
      expect(r.ok).toBe(true);
      expect(overwriteSeg).toHaveBeenCalledTimes(1);
    });

    it('does not poll on a FIRST save (no scan id → upload, nothing to conflict with)', async () => {
      const getVersion = vi.fn(async () => 'sha1:whatever');
      const uploadSeg = vi.fn(async () => ({ ok: true as const, scanId: '3004', versionToken: 'v1' }));
      const t = createXnatTransport(fakeApi({ uploadSeg, getVersion }));
      const r = await t.save(ser('c1'), null); // no scanId, base null
      expect(r.ok).toBe(true);
      expect(getVersion).not.toHaveBeenCalled();
      expect(uploadSeg).toHaveBeenCalledTimes(1);
    });
  });
});
