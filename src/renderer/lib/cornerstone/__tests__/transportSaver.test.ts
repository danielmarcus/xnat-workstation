import { describe, expect, it, vi } from 'vitest';
import { createTransportSaver } from '../transportSaver';
import { createInMemoryTransport, type SerializedContainer } from '../annotationTransport';

/**
 * Transport track TR2 — the bridge from saveQueue's injected saveContainer(id) to
 * the §H transport: serialize → transport.save(serialized, baseToken) → map the
 * H5 result to the queue's SaveOutcome, tracking the per-container base version
 * token so the next save isn't a self-conflict. Verified with the in-memory double.
 */
function fakeSerialize(base64 = 'AAAA') {
  return vi.fn(async (containerId: string): Promise<SerializedContainer | null> => ({
    containerId,
    kind: 'SEG',
    base64,
    source: { projectId: 'P', subjectId: 'S', sessionId: 'E', sourceScanId: '4' },
  }));
}

describe('createTransportSaver', () => {
  it('saves successfully and advances the base token so the next save is not a conflict', async () => {
    const transport = createInMemoryTransport();
    const saver = createTransportSaver({ transport, serialize: fakeSerialize() });
    expect(await saver.saveContainer('c1')).toEqual({ ok: true });
    // second save uses the advanced base token → still ok (not a self-conflict)
    expect(await saver.saveContainer('c1')).toEqual({ ok: true });
  });

  it('maps an unserializable container to a permanent (no-retry) outcome', async () => {
    const transport = createInMemoryTransport();
    const serialize = vi.fn(async () => null);
    const saver = createTransportSaver({ transport, serialize });
    const r = await saver.saveContainer('c1');
    expect(r).toMatchObject({ ok: false, kind: 'permanent' });
  });

  it('maps an external-edit stale-token save to a conflict outcome (H5)', async () => {
    const transport = createInMemoryTransport();
    const saver = createTransportSaver({ transport, serialize: fakeSerialize() });
    await saver.saveContainer('c1'); // base token now v1
    transport._externalEdit('c1'); // server advances to v2 underneath us
    const r = await saver.saveContainer('c1'); // still based on v1 → conflict
    expect(r).toMatchObject({ ok: false, kind: 'conflict' });
  });

  it('maps a transient transport failure to a transient (retryable) outcome', async () => {
    const transport = createInMemoryTransport();
    transport._failNext('transient');
    const saver = createTransportSaver({ transport, serialize: fakeSerialize() });
    expect(await saver.saveContainer('c1')).toMatchObject({ ok: false, kind: 'transient' });
    expect(await saver.saveContainer('c1')).toEqual({ ok: true }); // recovers
  });

  it('rebaseToServer resolves a conflict (H7 keep-local): adopt server token, then save succeeds', async () => {
    const transport = createInMemoryTransport();
    const saver = createTransportSaver({ transport, serialize: fakeSerialize() });
    await saver.saveContainer('c1');
    transport._externalEdit('c1');
    expect(await saver.saveContainer('c1')).toMatchObject({ ok: false, kind: 'conflict' });
    await saver.rebaseToServer('c1'); // keep-local: re-base onto the server's current version
    expect(await saver.saveContainer('c1')).toEqual({ ok: true });
  });

  it('re-bases the token on the post-save server version (GET), not the PUT-response token (#64-A)', async () => {
    // Real XNAT issues a PUT-response token that does NOT match a later GET of the
    // same file, which would false-positive the next save's pre-overwrite check.
    // The saver must adopt the GET token (getServerVersion) as the base.
    const saveBases: (string | null)[] = [];
    const transport = {
      save: vi.fn(async (_s: SerializedContainer, base: string | null) => {
        saveBases.push(base);
        return { ok: true as const, versionToken: 'put-token', scanId: '3004' };
      }),
      getServerVersion: vi.fn(async () => 'get-token'),
    } as unknown as Parameters<typeof createTransportSaver>[0]['transport'];

    const saver = createTransportSaver({ transport, serialize: fakeSerialize() });
    await saver.saveContainer('c1');
    expect(saver.baseToken('c1')).toBe('get-token'); // the GET token, not 'put-token'
    await saver.saveContainer('c1');
    expect(saveBases).toEqual([null, 'get-token']); // 2nd save is based on the GET token
  });

  it('reports each H5 result via onResult', async () => {
    const transport = createInMemoryTransport();
    const onResult = vi.fn();
    const saver = createTransportSaver({ transport, serialize: fakeSerialize(), onResult });
    await saver.saveContainer('c1');
    expect(onResult).toHaveBeenCalledWith('c1', expect.objectContaining({ ok: true }));
  });
});
