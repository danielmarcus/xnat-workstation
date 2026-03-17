import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
};

async function loadModule() {
  return import('./rendererLogBuffer');
}

describe('rendererLogBuffer', () => {
  beforeEach(() => {
    vi.resetModules();
    delete (window as any).__xnatRendererLogCaptureInstalled__;
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  });

  afterEach(() => {
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  });

  it('captures console output and global error events with de-identification', async () => {
    const { installRendererLogCapture, getRendererLogEntries } = await loadModule();
    installRendererLogCapture();

    console.log('user email', 'dev@example.com');
    console.warn('token', 'Authorization: Bearer secret-123');
    console.error('path', '/Users/dan/Documents/private');
    window.dispatchEvent(
      new ErrorEvent('error', {
        message: 'boom',
        filename: '/Users/dan/app.ts',
        lineno: 10,
        colno: 5,
      }),
    );

    const unhandled = new Event('unhandledrejection') as Event & { reason?: unknown };
    unhandled.reason = new Error('rejection from https://xnat.example.org/data?token=abc');
    window.dispatchEvent(unhandled);

    const logs = getRendererLogEntries(20);
    const joined = logs.map((entry) => entry.message).join('\n');

    expect(logs.length).toBeGreaterThanOrEqual(5);
    expect(logs.some((entry) => entry.stream === 'stdout')).toBe(true);
    expect(logs.some((entry) => entry.stream === 'stderr')).toBe(true);
    expect(joined).toContain('<email-redacted>');
    expect(joined).toContain('Authorization: Bearer <token-redacted>');
    expect(joined).toContain('/Users/<user>');
    expect(joined).toContain('[window.error]');
    expect(joined).toContain('[unhandledrejection]');
    expect(joined).not.toContain('xnat.example.org');
  });

  it('does not double-install listeners and wrappers', async () => {
    const { installRendererLogCapture, getRendererLogEntries } = await loadModule();

    installRendererLogCapture();
    installRendererLogCapture();
    console.error('single error line');

    const logs = getRendererLogEntries(10).filter((entry) => entry.message.includes('single error line'));
    expect(logs).toHaveLength(1);
  });

  it('returns only the requested tail window from log history', async () => {
    const { installRendererLogCapture, getRendererLogEntries } = await loadModule();
    installRendererLogCapture();

    console.log('line 1');
    console.log('line 2');
    console.log('line 3');

    const tail = getRendererLogEntries(2);
    expect(tail).toHaveLength(2);
    expect(tail[0].message).toContain('line 2');
    expect(tail[1].message).toContain('line 3');
  });
});
