import { beforeEach, describe, expect, it } from 'vitest';
import { useTransportStore } from './transportStore';

describe('useTransportStore', () => {
  beforeEach(() => {
    useTransportStore.getState().clear();
  });

  it('returns null for an unknown container', () => {
    expect(useTransportStore.getState().get('unknown')).toBeNull();
  });

  it('beginSave creates a record with saveInFlight=true', () => {
    useTransportStore.getState().beginSave('c-1');
    const record = useTransportStore.getState().get('c-1');
    expect(record).not.toBeNull();
    expect(record!.saveInFlight).toBe(true);
    expect(record!.lastError).toBeNull();
  });

  it('finishSaveSuccess clears in-flight, sets token and lastSavedAt', () => {
    useTransportStore.getState().beginSave('c-1');
    useTransportStore.getState().finishSaveSuccess('c-1', 'tok-1');

    const record = useTransportStore.getState().get('c-1');
    expect(record!.saveInFlight).toBe(false);
    expect(record!.versionToken).toBe('tok-1');
    expect(record!.lastOutcome).toBe('success');
    expect(record!.lastError).toBeNull();
    expect(record!.externalChangePending).toBe(false);
    expect(record!.lastSavedAt).toBeGreaterThan(0);
  });

  it('finishSaveConflict sets externalChangePending and outcome=conflict', () => {
    useTransportStore.getState().beginSave('c-1');
    useTransportStore.getState().finishSaveConflict('c-1');

    const record = useTransportStore.getState().get('c-1');
    expect(record!.saveInFlight).toBe(false);
    expect(record!.lastOutcome).toBe('conflict');
    expect(record!.externalChangePending).toBe(true);
  });

  it('finishSaveTransientFailure normalizes kind=transient on the error', () => {
    useTransportStore.getState().beginSave('c-1');
    useTransportStore.getState().finishSaveTransientFailure('c-1', {
      kind: 'permanent', // intentionally wrong; should be normalized
      message: 'network unreachable',
      at: 1,
    });

    const record = useTransportStore.getState().get('c-1');
    expect(record!.saveInFlight).toBe(false);
    expect(record!.lastOutcome).toBe('transient-failure');
    expect(record!.lastError?.kind).toBe('transient');
    expect(record!.lastError?.message).toBe('network unreachable');
  });

  it('finishSavePermanentFailure normalizes kind=permanent on the error', () => {
    useTransportStore.getState().beginSave('c-1');
    useTransportStore.getState().finishSavePermanentFailure('c-1', {
      kind: 'transient', // intentionally wrong; should be normalized
      message: 'unauthorized',
      at: 1,
    });

    const record = useTransportStore.getState().get('c-1');
    expect(record!.lastOutcome).toBe('permanent-failure');
    expect(record!.lastError?.kind).toBe('permanent');
  });

  it('noteExternalChange and clearExternalChange flip the pending flag', () => {
    useTransportStore.getState().noteExternalChange('c-1');
    expect(useTransportStore.getState().get('c-1')!.externalChangePending).toBe(true);

    useTransportStore.getState().clearExternalChange('c-1');
    expect(useTransportStore.getState().get('c-1')!.externalChangePending).toBe(false);
  });

  it('remove drops the record', () => {
    useTransportStore.getState().beginSave('c-1');
    useTransportStore.getState().remove('c-1');
    expect(useTransportStore.getState().get('c-1')).toBeNull();
  });

  it('clear empties the store', () => {
    useTransportStore.getState().beginSave('c-1');
    useTransportStore.getState().beginSave('c-2');
    useTransportStore.getState().clear();
    expect(useTransportStore.getState().get('c-1')).toBeNull();
    expect(useTransportStore.getState().get('c-2')).toBeNull();
  });

  it('preserves previous fields when patching', () => {
    useTransportStore.getState().beginSave('c-1');
    useTransportStore.getState().finishSaveSuccess('c-1', 'tok-1');
    useTransportStore.getState().noteExternalChange('c-1');

    const record = useTransportStore.getState().get('c-1');
    // Token from the prior success should persist through the noteExternalChange call.
    expect(record!.versionToken).toBe('tok-1');
    expect(record!.externalChangePending).toBe(true);
  });
});
