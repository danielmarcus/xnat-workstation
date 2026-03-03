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
      reporter: ['text', 'html'],
      thresholds: {
        lines: 1,
        branches: 1,
        functions: 1,
        statements: 1,
        'src/renderer/lib/cornerstone/annotationService.ts': {
          lines: 85,
          branches: 60,
          functions: 80,
          statements: 85,
        },
        'src/renderer/lib/cornerstone/toolService.ts': {
          lines: 60,
          branches: 60,
          functions: 80,
          statements: 60,
        },
        'src/renderer/lib/cornerstone/viewportService.ts': {
          lines: 70,
          branches: 70,
          functions: 70,
          statements: 70,
        },
        'src/renderer/lib/cornerstone/segmentationService.ts': {
          lines: 7,
          branches: 10,
          functions: 10,
          statements: 7,
        },
        'src/renderer/lib/hotkeys/*.ts': {
          lines: 80,
          branches: 80,
          functions: 80,
          statements: 80,
        },
        'src/renderer/components/viewer/ViewportOverlay.tsx': {
          lines: 70,
          branches: 70,
          functions: 70,
          statements: 70,
        },
        'src/main/ipc/*Handlers.ts': {
          lines: 80,
          branches: 80,
          functions: 80,
          statements: 80,
        },
        'src/renderer/App.tsx': {
          lines: 30,
          branches: 70,
          functions: 35,
          statements: 30,
        },
        'src/renderer/main.tsx': {
          lines: 100,
          branches: 100,
          functions: 100,
          statements: 100,
        },
        'src/renderer/components/settings/SettingsModal.tsx': {
          lines: 90,
          branches: 85,
          functions: 80,
          statements: 90,
        },
        'src/renderer/components/viewer/Toolbar.tsx': {
          lines: 90,
          branches: 75,
          functions: 80,
          statements: 90,
        },
        'src/renderer/components/dialog/AppDialogHost.tsx': {
          lines: 90,
          branches: 90,
          functions: 80,
          statements: 90,
        },
        'src/renderer/lib/app/appHelpers.ts': {
          lines: 90,
          branches: 70,
          functions: 100,
          statements: 90,
        },
        'src/preload/index.ts': {
          lines: 85,
          branches: 100,
          functions: 80,
          statements: 85,
        },
        'src/main/xnat/sessionManager.ts': {
          lines: 80,
          branches: 70,
          functions: 100,
          statements: 80,
        },
        'src/main/xnat/xnatClient.ts': {
          lines: 70,
          branches: 50,
          functions: 75,
          statements: 70,
        },
      },
    },
  },
});
