import { describe, expect, it } from 'vitest';
import { createInMemoryTransport, type SerializedContainer } from '../annotationTransport';

/**
 * Transport workstream — the §H save contract, verified against the in-memory
 * double (offline). The double implements H5 (Success → new version token /
 * Conflict → stale token) + H6 (external change bumps the server version), so the
 * queue-next-save (signal 14) and conflict (H7 / signal 27) state machines can be
 * driven without a live XNAT. The real IPC transport implements the same contract.
 */
function ser(containerId: string, base64 = 'AAAA'): SerializedContainer {
  return {
    containerId,
    kind: 'SEG',
    base64,
    source: { projectId: 'P', subjectId: 'S', sessionId: 'E', sourceScanId: '4' },
  };
}

describe('createInMemoryTransport (§H save contract)', () => {
  it('first save (null base token) succeeds and returns a version token', async () => {
    const t = createInMemoryTransport();
    const r = await t.save(ser('c1'), null);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.versionToken).toBeTruthy();
  });

  it('a save based on the current token succeeds and advances the token (H5 success)', async () => {
    const t = createInMemoryTransport();
    const first = await t.save(ser('c1'), null);
    expect(first.ok).toBe(true);
    const token1 = first.ok ? first.versionToken : '';
    const second = await t.save(ser('c1'), token1);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.versionToken).not.toBe(token1);
  });

  it('a save based on a STALE token is a conflict, returning the current server token (H5 conflict)', async () => {
    const t = createInMemoryTransport();
    const first = await t.save(ser('c1'), null);
    const token1 = first.ok ? first.versionToken : '';
    await t.save(ser('c1'), token1); // advances to token2 (someone else saved)
    const stale = await t.save(ser('c1'), token1); // still based on token1 → conflict
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.kind).toBe('conflict');
      expect(stale.serverVersionToken).toBeTruthy();
      expect(stale.serverVersionToken).not.toBe(token1);
    }
  });

  it('getServerVersion reflects the latest token; an external edit bumps it (H6)', async () => {
    const t = createInMemoryTransport();
    const first = await t.save(ser('c1'), null);
    const token1 = first.ok ? first.versionToken : '';
    expect(await t.getServerVersion('c1')).toBe(token1);
    t._externalEdit('c1'); // simulate another source modifying the container
    expect(await t.getServerVersion('c1')).not.toBe(token1);
  });

  it('a transient failure can be injected and reported as retryable', async () => {
    const t = createInMemoryTransport();
    t._failNext('transient');
    const r = await t.save(ser('c1'), null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('transient');
    // the next save succeeds (transient cleared)
    const r2 = await t.save(ser('c1'), null);
    expect(r2.ok).toBe(true);
  });

  it('keeps version state per container (independent)', async () => {
    const t = createInMemoryTransport();
    const a = await t.save(ser('a'), null);
    const b = await t.save(ser('b'), null);
    expect(a.ok && b.ok).toBe(true);
    // saving a with a's token succeeds; b is unaffected
    if (a.ok) expect((await t.save(ser('a'), a.versionToken)).ok).toBe(true);
    expect(await t.getServerVersion('b')).toBe(b.ok ? b.versionToken : '');
  });
});
