import { beforeEach, describe, expect, it } from 'vitest';
import { useAnnotationStore, type AnnotationSummary } from './annotationStore';

function resetStore(): void {
  useAnnotationStore.setState(useAnnotationStore.getInitialState(), true);
}

describe('useAnnotationStore', () => {
  beforeEach(() => {
    resetStore();
  });

  it('starts with the expected initial state', () => {
    const state = useAnnotationStore.getState();
    expect(state.annotations).toEqual([]);
    expect(state.selectedUID).toBeNull();
    expect(state.showPanel).toBe(false);
  });

  it('applies _sync/select/togglePanel transitions deterministically', () => {
    const first: AnnotationSummary = {
      annotationUID: 'ann-1',
      toolName: 'Length',
      displayName: 'Length',
      displayText: '12.5 mm',
      label: 'A',
    };
    const second: AnnotationSummary = {
      annotationUID: 'ann-2',
      toolName: 'Angle',
      displayName: 'Angle',
      displayText: '45.2°',
      label: 'B',
    };

    useAnnotationStore.getState()._sync([first, second]);
    expect(useAnnotationStore.getState().annotations).toEqual([first, second]);

    useAnnotationStore.getState().select('ann-2');
    expect(useAnnotationStore.getState().selectedUID).toBe('ann-2');

    useAnnotationStore.getState().togglePanel();
    expect(useAnnotationStore.getState().showPanel).toBe(true);
    useAnnotationStore.getState().togglePanel();
    expect(useAnnotationStore.getState().showPanel).toBe(false);
  });

  it('creates an SR container (active), auto-affiliates newly-drawn measurements, and removes it (D7.1)', () => {
    const s = useAnnotationStore.getState();
    const id = s.createSrContainer('Lesions');
    expect(id).toMatch(/^sr:/);
    expect(useAnnotationStore.getState().srContainers).toEqual([{ id, label: 'Lesions' }]);
    expect(useAnnotationStore.getState().activeSrContainerId).toBe(id);

    // A measurement drawn while the SR container is active is auto-affiliated to it.
    const m = (uid: string): AnnotationSummary => ({ annotationUID: uid, toolName: 'Length', displayName: 'Length', displayText: '1mm', label: '' });
    useAnnotationStore.getState()._sync([m('a1')]);
    expect(useAnnotationStore.getState().srAffiliation).toEqual({ a1: id });

    useAnnotationStore.getState().renameSrContainer(id, 'Renamed');
    expect(useAnnotationStore.getState().srContainers[0].label).toBe('Renamed');

    // Removing the container drops its affiliations + clears active.
    useAnnotationStore.getState().removeSrContainer(id);
    expect(useAnnotationStore.getState().srContainers).toEqual([]);
    expect(useAnnotationStore.getState().activeSrContainerId).toBeNull();
    expect(useAnnotationStore.getState().srAffiliation).toEqual({});
  });

  it('does not affiliate measurements when no SR container is active', () => {
    useAnnotationStore.getState()._sync([
      { annotationUID: 'x1', toolName: 'Length', displayName: 'Length', displayText: '1mm', label: '' },
    ]);
    expect(useAnnotationStore.getState().srAffiliation).toEqual({});
  });
});
