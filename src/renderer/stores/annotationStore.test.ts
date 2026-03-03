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
});
