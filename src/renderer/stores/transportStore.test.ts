import { describe, it, expect, beforeEach } from 'vitest';
import { useTransportStore, selectAnyInFlight } from './transportStore';

describe('transportStore (skeleton)', () => {
  beforeEach(() => {
    useTransportStore.getState().reset();
  });

  it('starts empty with nothing in flight', () => {
    expect(useTransportStore.getState().entries).toEqual({});
    expect(selectAnyInFlight(useTransportStore.getState())).toBe(false);
  });

  it('sets a transport phase and reports in-flight for loading/saving', () => {
    useTransportStore.getState().setPhase('seg-1', 'SEG', 'saving');
    expect(useTransportStore.getState().entries['seg-1']).toMatchObject({
      containerId: 'seg-1',
      kind: 'SEG',
      phase: 'saving',
    });
    expect(selectAnyInFlight(useTransportStore.getState())).toBe(true);
  });

  it('keeps an error message only while phase is error', () => {
    useTransportStore.getState().setPhase('rt-1', 'RTSTRUCT', 'error', 'upload failed');
    expect(useTransportStore.getState().entries['rt-1'].error).toBe('upload failed');

    useTransportStore.getState().setPhase('rt-1', 'RTSTRUCT', 'saving');
    expect(useTransportStore.getState().entries['rt-1'].error).toBeUndefined();
  });

  it('markSaved sets idle, clears error, and stamps lastSavedAt', () => {
    useTransportStore.getState().setPhase('seg-1', 'SEG', 'saving');
    useTransportStore.getState().markSaved('seg-1', 1_700_000_000_000);
    const entry = useTransportStore.getState().entries['seg-1'];
    expect(entry.phase).toBe('idle');
    expect(entry.error).toBeUndefined();
    expect(entry.lastSavedAt).toBe(1_700_000_000_000);
    expect(selectAnyInFlight(useTransportStore.getState())).toBe(false);
  });

  it('markSaved is a no-op for an unknown container', () => {
    useTransportStore.getState().markSaved('missing', 1);
    expect(useTransportStore.getState().entries).toEqual({});
  });

  it('removes and resets entries', () => {
    useTransportStore.getState().setPhase('a', 'SEG', 'loading');
    useTransportStore.getState().setPhase('b', 'SR', 'saving');
    useTransportStore.getState().remove('a');
    expect(useTransportStore.getState().entries['a']).toBeUndefined();
    expect(useTransportStore.getState().entries['b']).toBeDefined();

    useTransportStore.getState().reset();
    expect(useTransportStore.getState().entries).toEqual({});
  });
});
