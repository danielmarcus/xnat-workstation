import { beforeEach, describe, expect, it } from 'vitest';
import { createXnatTransportService } from '../transportService';
import { createMockXnatApi } from '../mockXnatApi';
import { useTransportStore, selectConflicts } from '../../../stores/transportStore';
import type { SerializedContainer } from '../annotationTransport';

/**
 * Transport assembler — composes the xnatTransport adapter + transportSaver and
 * feeds the transportStore (version token on success, conflict marker on H5). This
 * is the production-injectable saveContainer the saveQueue calls; the E2E plugs the
 * mock XNAT api in here. Verified against the mock with the real store.
 */
const serialize = async (containerId: string): Promise<SerializedContainer> => ({
  containerId,
  kind: 'SEG',
  base64: 'AAAA',
  source: { projectId: 'P', subjectId: 'S', sessionId: 'E1', sessionLabel: 'EXP', sourceScanId: '4' },
});

beforeEach(() => useTransportStore.getState().reset());

describe('createXnatTransportService', () => {
  it('a successful save → outcome ok + store entry idle with a version token', async () => {
    const svc = createXnatTransportService({ api: createMockXnatApi(), serialize, kindOf: () => 'SEG', now: () => 1000 });
    const outcome = await svc.saveContainer('c1');
    expect(outcome).toEqual({ ok: true });
    const e = useTransportStore.getState().entries.c1;
    expect(e.phase).toBe('idle');
    expect(e.versionToken).toBeTruthy();
    expect(e.lastSavedAt).toBe(1000);
  });

  it('a stale-token (external-edit) save → conflict outcome + store conflict marker (H5/D7.4)', async () => {
    const api = createMockXnatApi();
    const svc = createXnatTransportService({ api, serialize, kindOf: () => 'SEG' });
    const first = await svc.saveContainer('c1');
    expect(first).toEqual({ ok: true });
    api._externalEdit('E1', '3001'); // server advanced underneath (first upload → scan 3001)

    const outcome = await svc.saveContainer('c1');
    expect(outcome).toMatchObject({ ok: false, kind: 'conflict' });
    const e = useTransportStore.getState().entries.c1;
    expect(e.phase).toBe('error');
    expect(e.errorKind).toBe('conflict');
    expect(e.serverVersionToken).toBeTruthy();
    expect(selectConflicts(useTransportStore.getState())).toContain('c1');
  });

  it('keep-local resolution (rebaseToServer → re-save) clears the conflict (H7)', async () => {
    const api = createMockXnatApi();
    const svc = createXnatTransportService({ api, serialize, kindOf: () => 'SEG' });
    await svc.saveContainer('c1');
    api._externalEdit('E1', '3001');
    await svc.saveContainer('c1'); // conflict recorded
    expect(selectConflicts(useTransportStore.getState())).toContain('c1');

    await svc.rebaseToServer('c1'); // keep-local: adopt the server's current version
    const outcome = await svc.saveContainer('c1');
    expect(outcome).toEqual({ ok: true });
    expect(selectConflicts(useTransportStore.getState())).toEqual([]);
    expect(useTransportStore.getState().entries.c1.phase).toBe('idle');
  });

  it('a transient transport failure → transient outcome + store error', async () => {
    const api = createMockXnatApi();
    api._failNext({ kind: 'transient', error: 'timeout' });
    const svc = createXnatTransportService({ api, serialize, kindOf: () => 'SEG' });
    const outcome = await svc.saveContainer('c1');
    expect(outcome).toMatchObject({ ok: false, kind: 'transient' });
    expect(useTransportStore.getState().entries.c1.errorKind).toBe('transient');
  });
});
