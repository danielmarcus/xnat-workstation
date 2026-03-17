import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';
import { installRendererLogCapture } from './lib/diagnostics/rendererLogBuffer';

installRendererLogCapture();

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Renderer root element "#root" was not found');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
