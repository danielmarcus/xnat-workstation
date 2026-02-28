import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
  ],
  root: 'src/renderer',
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@renderer': path.resolve(__dirname, 'src/renderer'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    headers: {
      // Required for SharedArrayBuffer used by Cornerstone3D volume rendering
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    proxy: {
      // DICOMweb proxy — avoids COEP cross-origin issues.
      // All /dicomweb requests are proxied to the local DICOMweb server.
      '/dicomweb': {
        target: 'http://localhost:8081',
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    // dicom-image-loader MUST be excluded — if Vite pre-bundles it,
    // the internal import.meta.url-based worker creation breaks.
    // polymorphic-segmentation MUST be excluded so its worker URL
    // (`./workers/polySegConverters.js`) resolves from package files, not
    // from optimize-deps virtual output.
    exclude: ['@cornerstonejs/dicom-image-loader', '@cornerstonejs/polymorphic-segmentation'],
    include: [
      '@cornerstonejs/core',
      '@cornerstonejs/tools',
      'dicom-parser',
      // Keep CJS interop explicit for ToolGroup dependencies.
      'lodash.get',
      // Ensure vtk.js dependency graph is optimized for browser ESM/CJS interop.
      '@kitware/vtk.js',
      // Codec packages are CJS/UMD — must be pre-bundled for ESM default-export interop.
      // They're transitive deps of dicom-image-loader (which itself must stay excluded).
      '@cornerstonejs/codec-libjpeg-turbo-8bit/decodewasmjs',
      '@cornerstonejs/codec-charls/decodewasmjs',
      '@cornerstonejs/codec-openjpeg/decodewasmjs',
      '@cornerstonejs/codec-openjph/wasmjs',
    ],
  },
  worker: {
    format: 'es',
  },
  assetsInclude: ['**/*.wasm'],
});
