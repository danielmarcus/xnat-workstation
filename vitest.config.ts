import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@renderer': path.resolve(__dirname, 'src/renderer'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
    environmentMatchGlobs: [
      ['src/renderer/lib/cornerstone/**/__tests__/**/*.test.{ts,tsx}', 'node'],
      ['src/renderer/**/*.test.{ts,tsx}', 'jsdom'],
    ],
    setupFiles: ['src/test/setupTests.ts'],
    server: {
      deps: {
        // Cornerstone 5 imports named ESM exports from dcmjs, whose package.json maps
        // `import` to build/dcmjs.es.js but declares no "type": "module" — so Node, which
        // loads externalized deps natively, treats that file as CommonJS and the named
        // imports fail. The app is fine (Vite bundles it); run these through Vite's
        // transform in tests too.
        inline: [/@cornerstonejs\//, /[\\/]dcmjs[\\/]/],
      },
    },
    coverage: {
      provider: 'v8',
      all: true,
      include: [
        'src/**/*.{ts,tsx}',
      ],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/__tests__/**',
        'src/test/**',
        'src/renderer/test/**',
        'src/**/*.d.ts',
        '**/shared/types/hotkeys.ts',
        '**/shared/types/index.ts',
        '**/shared/types/xnat.ts',
      ],
      reporter: ['text', 'html', 'json-summary', 'json'],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        'src/**/*.{ts,tsx}': {
          lines: 60,
          statements: 60,
        },
      },
    },
  },
});
