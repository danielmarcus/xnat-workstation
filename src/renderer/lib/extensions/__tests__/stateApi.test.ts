/**
 * App state for extensions (extension framework X3, R5–R6): the session on screen, the active
 * viewport, the annotations as the panel lists them, the events — and that an extension's
 * listeners go when it stops.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStateApi } from '../stateApi';
import { disposeExtensionUi, __resetExtensionUiForTests } from '../uiRegistry';
import { useViewerStore } from '../../../stores/viewerStore';
import { useConnectionStore } from '../../../stores/connectionStore';
import { useAnnotationSelectionStore } from '../../../stores/annotationSelectionStore';
import { setNavigationHandler } from '../../app/appNavigation';

vi.mock('../../annotations/currentContainers', () => ({
  currentContainers: () => containers,
  CONTAINER_SOURCES: [],
}));
let containers: Array<Record<string, unknown>> = [];
const seg = (id: string, label: string, dirty = false) => ({
  id, kind: 'SEG', label, dirty, members: [{ id: '1', label: 'Liver', visible: true, locked: false }],
  source: { projectId: 'P', subjectId: 'S', sessionId: 'E1', sourceScanId: '4', scanId: id === 'saved' ? '3004' : undefined },
});

beforeEach(() => {
  __resetExtensionUiForTests();
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
    expect(annotations.list()).toEqual([
      { id: 'saved', kind: 'SEG', label: 'Liver seg', dirty: false, xnatScanId: '3004', members: [{ id: '1', label: 'Liver' }] },
      { id: 'new', kind: 'SEG', label: 'Draft', dirty: true, xnatScanId: undefined, members: [{ id: '1', label: 'Liver' }] },
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
    const remove = setNavigationHandler({ openSession: open, revealInBrowser: vi.fn() });
    expect(await viewer.openSession({ projectId: 'P', subjectId: 'S', sessionId: 'E1' }, { scanId: '4' })).toEqual({ outcome: 'cancelled' });
    expect(open).toHaveBeenCalledWith({ projectId: 'P', subjectId: 'S', sessionId: 'E1' }, { scanId: '4' });
    remove();
  });
});
