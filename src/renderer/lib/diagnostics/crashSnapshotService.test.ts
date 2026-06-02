/**
 * crashSnapshotService tests (MV-Phase 7.1, spec §13.8).
 *
 * Pins: payload shape, de-identification pass-through, per-message dedupe,
 * never-throws guarantee, and the global listener install.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./rendererLogBuffer', () => ({
  getRendererLogEntries: vi.fn(() => [
    { timestamp: 't', source: 'renderer', level: 'warn', stream: 'stderr', message: 'recent log' },
  ]),
}));

import { captureCrashSnapshot, installCrashSnapshotListeners } from './crashSnapshotService';

describe('crashSnapshotService', () => {
  const writeCrashSnapshot = vi.fn().mockResolvedValue({ ok: true, id: 'snap.json' });

  beforeEach(() => {
    vi.useFakeTimers();
    writeCrashSnapshot.mockClear();
    (window as any).electronAPI = { diagnostics: { writeCrashSnapshot } };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (window as any).electronAPI;
  });

  it('writes a snapshot with reason, message, stack, and renderer logs', async () => {
    const error = new Error('boom');
    const id = await captureCrashSnapshot('error-boundary', error, { boundary: 'panel_1' });

    expect(id).toBe('snap.json');
    expect(writeCrashSnapshot).toHaveBeenCalledTimes(1);
    const payload = writeCrashSnapshot.mock.calls[0][0];
    expect(payload.reason).toBe('error-boundary');
    expect(payload.message).toBe('boom');
    expect(payload.stack).toBeTruthy();
    expect(payload.boundary).toBe('panel_1');
    expect(payload.rendererLogs).toHaveLength(1);
    expect(typeof payload.capturedAt).toBe('string');
  });

  it('stringifies non-Error reasons', async () => {
    await captureCrashSnapshot('unhandled-rejection', 'plain string failure');
    expect(writeCrashSnapshot.mock.calls[0][0].message).toBe('plain string failure');
  });

  it('dedupes identical messages within the window', async () => {
    await captureCrashSnapshot('error-boundary', new Error('repeat'));
    const second = await captureCrashSnapshot('error-boundary', new Error('repeat'));

    expect(second).toBeNull();
    expect(writeCrashSnapshot).toHaveBeenCalledTimes(1);
  });

  it('allows the same message again after the dedupe window expires', async () => {
    await captureCrashSnapshot('error-boundary', new Error('windowed'));
    vi.advanceTimersByTime(31_000);
    vi.setSystemTime(Date.now() + 31_000);
    await captureCrashSnapshot('error-boundary', new Error('windowed'));

    expect(writeCrashSnapshot).toHaveBeenCalledTimes(2);
  });

  it('does not dedupe different messages', async () => {
    await captureCrashSnapshot('error-boundary', new Error('first'));
    await captureCrashSnapshot('error-boundary', new Error('second'));
    expect(writeCrashSnapshot).toHaveBeenCalledTimes(2);
  });

  it('returns null (never throws) when the IPC surface is missing', async () => {
    delete (window as any).electronAPI;
    const result = await captureCrashSnapshot('uncaught-error', new Error('no ipc'));
    expect(result).toBeNull();
  });

  it('returns null (never throws) when the IPC write rejects', async () => {
    writeCrashSnapshot.mockRejectedValueOnce(new Error('disk full'));
    const result = await captureCrashSnapshot('uncaught-error', new Error('ipc rejects'));
    expect(result).toBeNull();
  });

  it('installCrashSnapshotListeners captures unhandled rejections', async () => {
    installCrashSnapshotListeners();
    // JSDOM has no PromiseRejectionEvent constructor — synthesize the event.
    const evt = new Event('unhandledrejection') as Event & { reason?: unknown };
    evt.reason = new Error('rejected');
    window.dispatchEvent(evt);

    await vi.runAllTimersAsync();
    expect(writeCrashSnapshot).toHaveBeenCalled();
    const payload = writeCrashSnapshot.mock.calls[0][0];
    expect(payload.reason).toBe('unhandled-rejection');
    expect(payload.message).toBe('rejected');
  });
});
