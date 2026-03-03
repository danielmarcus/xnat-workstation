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
