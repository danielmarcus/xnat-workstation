import { beforeEach, describe, expect, it } from 'vitest';
import { useCursorMetricsStore } from './cursorMetricsStore';

const sample = {
  canvasX: 10,
  canvasY: 20,
  world: [1, 2, 3] as [number, number, number],
  hu: 47,
  modality: 'CT',
};

beforeEach(() => {
  useCursorMetricsStore.getState().clearAll();
});

describe('cursorMetricsStore', () => {
  it('starts empty', () => {
    expect(useCursorMetricsStore.getState().metrics).toEqual({});
  });

  it('set / clear per panelId', () => {
    const { set, clear } = useCursorMetricsStore.getState();
    set('panel_0', sample);
    expect(useCursorMetricsStore.getState().metrics.panel_0).toEqual(sample);
    clear('panel_0');
    expect(useCursorMetricsStore.getState().metrics.panel_0).toBeUndefined();
  });

  it('clear is a no-op for unknown panelId', () => {
    const { clear } = useCursorMetricsStore.getState();
    const beforeRef = useCursorMetricsStore.getState().metrics;
    clear('missing');
    expect(useCursorMetricsStore.getState().metrics).toBe(beforeRef);
  });

  it('multiple panels are independent', () => {
    const { set } = useCursorMetricsStore.getState();
    set('panel_0', { ...sample, hu: 10 });
    set('panel_1', { ...sample, hu: 20 });
    expect(useCursorMetricsStore.getState().metrics.panel_0?.hu).toBe(10);
    expect(useCursorMetricsStore.getState().metrics.panel_1?.hu).toBe(20);
  });

  it('clearAll empties every entry', () => {
    const { set, clearAll } = useCursorMetricsStore.getState();
    set('panel_0', sample);
    set('panel_1', sample);
    clearAll();
    expect(useCursorMetricsStore.getState().metrics).toEqual({});
  });
});
