import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const renderMock = vi.fn();
const createRootMock = vi.fn(() => ({ render: renderMock }));

vi.mock('react-dom/client', () => ({
  default: {
    createRoot: createRootMock,
  },
}));

vi.mock('./App', () => ({
  default: () => <div data-testid="mock-app">Mock App</div>,
}));

vi.mock('./lib/diagnostics/rendererLogBuffer', () => ({
  installRendererLogCapture: vi.fn(),
}));

// These two import the REAL ./main (only react-dom, App and the log capture are
// mocked), so they pay for the renderer's whole module graph — Cornerstone services,
// stores and the e2e hooks. That import alone runs ~4s on a warm machine and grows
// with the app, so the default 5s timeout leaves no headroom; the assertions here are
// about wiring, not speed.
const IMPORT_TIMEOUT_MS = 30_000;

describe('renderer entrypoint', () => {
  beforeEach(() => {
    vi.resetModules();
    createRootMock.mockClear();
    renderMock.mockClear();
    document.body.innerHTML = '<div id="root"></div>';
  });

  it('creates a React root and renders App in StrictMode', async () => {
    await import('./main');

    const rootEl = document.getElementById('root');
    expect(createRootMock).toHaveBeenCalledWith(rootEl);
    expect(renderMock).toHaveBeenCalledTimes(1);

    const renderedTree = renderMock.mock.calls[0][0] as React.ReactElement;
    expect(renderedTree.type).toBe(React.StrictMode);
  }, IMPORT_TIMEOUT_MS);

  it('throws a clear error when #root is missing', async () => {
    document.body.innerHTML = '';

    await expect(import('./main')).rejects.toThrow(
      'Renderer root element "#root" was not found',
    );
    expect(createRootMock).not.toHaveBeenCalled();
    expect(renderMock).not.toHaveBeenCalled();
  }, IMPORT_TIMEOUT_MS);
});
