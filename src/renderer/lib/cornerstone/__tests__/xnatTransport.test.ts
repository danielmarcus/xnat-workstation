import { describe, expect, it } from 'vitest';
import { createXnatTransport } from '../xnatTransport';
import { createMockXnatApi } from '../mockXnatApi';
import type { SerializedContainer } from '../annotationTransport';

/**
 * Transport TR5 (renderer side) — the real xnatTransport adapter that calls the
 * XNAT upload/overwrite/version API, verified against the in-memory mock that
 * simulates XNAT (the mocked-XNAT harness). This exercises the ACTUAL adapter code
 * (first-save → upload → scanId mapping H8; update → overwrite; stale → conflict
 * H5; version polling H6) without a live server. The real electronAPI.xnat is the
 * production XnatUploadApi (its handlers must be extended to return version tokens).
 */
function ser(containerId: string, scanId?: string, base64 = 'AAAA'): SerializedContainer {
  return {
    containerId,
    kind: 'SEG',
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

  it('getServerVersion reflects the mapped scan version; external edit bumps it (H6)', async () => {
    const api = createMockXnatApi();
    const t = createXnatTransport(api);
    const first = await t.save(ser('c1'), null);
    const token1 = first.ok ? first.versionToken : '';
    expect(await t.getServerVersion('c1')).toBe(token1);
    api._externalEdit('E1', first.ok ? first.scanId! : '');
    expect(await t.getServerVersion('c1')).not.toBe(token1);
  });
});
