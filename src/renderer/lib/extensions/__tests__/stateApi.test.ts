/**
 * App state for extensions (extension framework X3, R5–R6): the session on screen, the active
 * viewport, the annotations as the panel lists them, the events — and that an extension's
 * listeners go when it stops.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStateApi, setAnnotationActions, type AnnotationActionsPort } from '../stateApi';
import { disposeExtensionUi, __resetExtensionUiForTests } from '../uiRegistry';
import { useViewerStore } from '../../../stores/viewerStore';
import { useConnectionStore } from '../../../stores/connectionStore';
import { useAnnotationSelectionStore } from '../../../stores/annotationSelectionStore';
import { setNavigationHandler } from '../../app/appNavigation';
import { useTransportStore } from '../../../stores/transportStore';
import { useExtensionStore } from '../../../stores/extensionStore';

vi.mock('../../annotations/currentContainers', () => ({
  currentContainers: () => containers,
  CONTAINER_SOURCES: [],
}));
let containers: Array<Record<string, unknown>> = [];
const seg = (id: string, label: string, dirty = false) => ({
  id, kind: 'SEG', label, dirty, members: [{ id: '1', label: 'Liver', visible: true, locked: false }],
  source: { projectId: 'P', subjectId: 'S', sessionId: 'E1', sourceScanId: '4', scanId: id === 'saved' ? '3004' : undefined },
});

/** The panel's actions, faked: they record what they were asked, and change `containers` as the real ones would. */
const calls: string[] = [];
const approved = new Set<string>();
const actions: AnnotationActionsPort = {
  activateMember: (c, m) => { calls.push(`activate ${c} ${m}`); useAnnotationSelectionStore.setState({ activeMember: { containerId: c, memberId: m } }); },
  createContainer: async (kind, vp, ids) => {
    calls.push(`create ${kind} on ${vp} (${ids.length} images)`);
    const id = `${kind.toLowerCase()}-1`;
    containers.push({ id, kind, label: kind === 'RTSTRUCT' ? 'Structure' : 'Segmentation', dirty: false, members: kind === 'SR' ? [] : [{ id: '1', label: kind === 'RTSTRUCT' ? 'ROI 1' : 'Segment 1' }], source: { projectId: 'P', subjectId: 'S', sessionId: 'E1', sourceScanId: '4' } });
    return id;
  },
  addMember: async (c, label) => { const ct = containers.find((x) => x.id === c)!; const ms = ct.members as Array<{ id: string; label: string }>; ms.push({ id: String(ms.length + 1), label: label! }); calls.push(`add ${label}`); return ms.length; },
  renameContainer: (c, name) => { (containers.find((x) => x.id === c)!).label = name; calls.push(`rename ${name}`); return true; },
  renameMember: (c, m, name) => { const ms = containers.find((x) => x.id === c)!.members as Array<{ id: string; label: string }>; ms.find((x) => x.id === m)!.label = name; calls.push(`rename ${m} ${name}`); return true; },
  setMemberColor: (_c, m, color) => { calls.push(`color ${m} ${color.join(',')}`); return true; },
  saveContainer: async (c) => { calls.push(`save ${c}`); return approved.has(c) ? { outcome: 'failed', reason: 'The annotation is approved: revoke its approval to edit or save it' } : { outcome: 'saved', versionToken: 'v2' }; },
  isApproved: (c) => approved.has(c),
  versionToken: (c) => useTransportStore.getState().entries[c]?.versionToken,
};

beforeEach(() => {
  __resetExtensionUiForTests();
  setAnnotationActions(actions);
  calls.length = 0;
  approved.clear();
  useTransportStore.setState({ entries: {} });
  containers = [];
  useViewerStore.setState({ xnatContext: null, activeViewportId: 'panel_0' });
  useConnectionStore.setState({ status: 'disconnected', connection: null });
  useAnnotationSelectionStore.setState({ activeMember: null });
});

describe('ext.viewer / ext.annotations / ext.events', () => {
  it('session() is the XNAT session on screen; activeViewport() the active one', () => {
    const { viewer } = createStateApi('org.example.x');
    expect(viewer.session()).toBeNull();
    useViewerStore.setState({ xnatContext: { projectId: 'P', subjectId: 'S', sessionId: 'E1', sessionLabel: 'MR1', scanId: '4' } });
    expect(viewer.session()).toEqual({ projectId: 'P', subjectId: 'S', sessionId: 'E1', sessionLabel: 'MR1' });
    expect(viewer.activeViewport()).toEqual({ id: 'panel_0' });
  });

  it('annotations: list() and active() as the panel has them', () => {
    containers = [seg('saved', 'Liver seg'), seg('new', 'Draft', true)];
    const { annotations } = createStateApi('org.example.x');
    useTransportStore.setState({ entries: { saved: { kind: 'SEG', phase: 'idle', versionToken: 'v7' } as never } });
    approved.add('saved');
    expect(annotations.list()).toEqual([
      { id: 'saved', kind: 'SEG', label: 'Liver seg', dirty: false, xnatScanId: '3004', approved: true, versionToken: 'v7', members: [{ id: '1', label: 'Liver' }] },
      { id: 'new', kind: 'SEG', label: 'Draft', dirty: true, xnatScanId: undefined, approved: false, versionToken: undefined, members: [{ id: '1', label: 'Liver' }] },
    ]);
    expect(annotations.active()).toBeNull();
    useAnnotationSelectionStore.setState({ activeMember: { containerId: 'new', memberId: '1' } });
    expect(annotations.active()).toMatchObject({ annotation: { id: 'new', dirty: true }, memberId: '1' });
  });

  it('events fire after the change, once per change', () => {
    const { events } = createStateApi('org.example.x');
    const seen: string[] = [];
    for (const name of ['signedIn', 'signedOut', 'sessionChanged', 'activeViewportChanged', 'activeAnnotationChanged'] as const) {
      events.on(name, () => seen.push(name));
    }
    useConnectionStore.setState({ status: 'connected', connection: { serverUrl: 'https://x', username: 'u', connectedAt: 0 } });
    useConnectionStore.setState({ status: 'connected' }); // no change
    useViewerStore.setState({ xnatContext: { projectId: 'P', subjectId: 'S', sessionId: 'E1', sessionLabel: 'MR1', scanId: '4' } });
    useViewerStore.setState({ xnatContext: { projectId: 'P', subjectId: 'S', sessionId: 'E1', sessionLabel: 'MR1', scanId: '5' } }); // same session
    useViewerStore.setState({ activeViewportId: 'panel_1' });
    useAnnotationSelectionStore.setState({ activeMember: { containerId: 'c', memberId: '1' } });
    useConnectionStore.setState({ status: 'disconnected', connection: null });
    expect(seen).toEqual(['signedIn', 'sessionChanged', 'activeViewportChanged', 'activeAnnotationChanged', 'signedOut']);
  });

  it('an extension\'s listeners are removed when it stops', () => {
    const { events } = createStateApi('org.example.x');
    const listener = vi.fn();
    events.on('activeViewportChanged', listener);
    disposeExtensionUi('org.example.x');
    useViewerStore.setState({ activeViewportId: 'panel_3' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('a listener that throws does not stop the others', () => {
    const { events } = createStateApi('org.example.x');
    const after = vi.fn();
    events.on('activeViewportChanged', () => { throw new Error('listener boom'); });
    events.on('activeViewportChanged', after);
    useViewerStore.setState({ activeViewportId: 'panel_2' });
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('openSession() goes through the app\'s navigation and reports its outcome', async () => {
    const { viewer } = createStateApi('org.example.x');
    expect(await viewer.openSession({ projectId: 'P', subjectId: 'S', sessionId: 'E1' })).toMatchObject({ outcome: 'failed' });
    const open = vi.fn(async () => ({ outcome: 'cancelled' as const }));
    const remove = setNavigationHandler({ openSession: open, openScan: vi.fn(), revealInBrowser: vi.fn() });
    expect(await viewer.openSession({ projectId: 'P', subjectId: 'S', sessionId: 'E1' }, { scanId: '4' })).toEqual({ outcome: 'cancelled' });
    expect(open).toHaveBeenCalledWith({ projectId: 'P', subjectId: 'S', sessionId: 'E1' }, { scanId: '4' });
    remove();
  });

  it('create(): the panel\'s create on the active viewport, then the template\'s label, members and colours; it becomes active', async () => {
    useViewerStore.setState({ activeViewportId: 'panel_1', panelImageIdsMap: { panel_1: ['a', 'b', 'c'] } });
    const { annotations } = createStateApi('org.example.x');
    const made = await annotations.create({ kind: 'SEG', label: 'Liver study', members: [{ label: 'Liver', color: [200, 40, 40] }, { label: 'Tumour', color: [250, 200, 0] }] });
    expect(calls).toEqual([
      'create SEG on panel_1 (3 images)', 'rename Liver study',
      'rename 1 Liver', 'color 1 200,40,40,255', 'add Tumour', 'color 2 250,200,0,255', // opaque RGBA
      'activate seg-1 1',
    ]);
    expect(made).toMatchObject({ id: 'seg-1', kind: 'SEG', label: 'Liver study', members: [{ id: '1', label: 'Liver' }, { id: '2', label: 'Tumour' }] });
  });

  it('create() is refused with no images on screen, and for a Measurement template with members', async () => {
    useViewerStore.setState({ activeViewportId: 'panel_0', panelImageIdsMap: {} });
    const { annotations } = createStateApi('org.example.x');
    await expect(annotations.create({ kind: 'SEG' })).rejects.toThrow(/No images/);
    useViewerStore.setState({ panelImageIdsMap: { panel_0: ['a'] } });
    await expect(annotations.create({ kind: 'SR', members: [{ label: 'x' }] })).rejects.toThrow(/drawn/);
    expect(calls).toEqual([]);
  });

  it('select(): activates as a row click does; the first member by default; an unknown one is an error', () => {
    containers = [seg('c1', 'A')];
    const { annotations } = createStateApi('org.example.x');
    annotations.select('c1');
    annotations.select('c1', '1');
    expect(calls).toEqual(['activate c1 1', 'activate c1 1']);
    expect(() => annotations.select('nope')).toThrow(/No annotation nope/);
    expect(() => annotations.select('c1', '9')).toThrow(/no member 9/);
  });

  it('save(): the panel\'s save; an approved container is refused as in the panel', async () => {
    containers = [seg('c1', 'A'), seg('c2', 'B')];
    approved.add('c2');
    const { annotations } = createStateApi('org.example.x');
    expect(await annotations.save('c1')).toEqual({ outcome: 'saved', versionToken: 'v2' });
    expect(await annotations.save('c2')).toMatchObject({ outcome: 'failed', reason: expect.stringMatching(/approved/) });
  });

  it('openScan() goes through the app\'s navigation, for annotation scans only', async () => {
    const openScanH = vi.fn(async () => ({ outcome: 'opened' as const }));
    const remove = setNavigationHandler({ openSession: vi.fn(), openScan: openScanH, revealInBrowser: vi.fn() });
    const { annotations } = createStateApi('org.example.x');
    expect(await annotations.openScan({ projectId: 'P', subjectId: 'S', sessionId: 'E1' }, '3004')).toEqual({ outcome: 'opened' });
    expect(openScanH).toHaveBeenCalledWith({ projectId: 'P', subjectId: 'S', sessionId: 'E1' }, '3004', { derivedOnly: true });
    remove();
  });

  it('gateChanged fires when this extension\'s gate changes — not another\'s (X6)', () => {
    const summary = (id: string, tier?: string) => ({ key: id, id, name: id, state: 'active' as const, tier, features: [] });
    useExtensionStore.setState({ extensions: [summary('org.example.x', 'Basic'), summary('org.example.y')] });
    const { events } = createStateApi('org.example.x');
    const fired = vi.fn();
    events.on('gateChanged', fired);
    useExtensionStore.setState({ extensions: [summary('org.example.x', 'Basic'), summary('org.example.y', 'Pro')] });
    expect(fired).not.toHaveBeenCalled();
    useExtensionStore.setState({ extensions: [summary('org.example.x', 'Pro'), summary('org.example.y', 'Pro')] });
    expect(fired).toHaveBeenCalledTimes(1);
  });
});
