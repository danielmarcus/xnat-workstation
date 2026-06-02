import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './styles/globals.css';
import { installRendererLogCapture } from './lib/diagnostics/rendererLogBuffer';
import { installCrashSnapshotListeners } from './lib/diagnostics/crashSnapshotService';
import { installRendererE2eHooks } from './lib/e2e/installRendererE2eHooks';

installRendererLogCapture();
installCrashSnapshotListeners();
installRendererE2eHooks();

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Renderer root element "#root" was not found');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary variant="app">
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
