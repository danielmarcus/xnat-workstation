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
  });

  it('throws a clear error when #root is missing', async () => {
    document.body.innerHTML = '';

    await expect(import('./main')).rejects.toThrow(
      'Renderer root element "#root" was not found',
    );
    expect(createRootMock).not.toHaveBeenCalled();
    expect(renderMock).not.toHaveBeenCalled();
  });
});
