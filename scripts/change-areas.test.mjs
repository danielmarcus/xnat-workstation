/**
 * The change classifier (scripts/change-areas.mjs), against the changed-file lists of real
 * commits — the ones used to check the tiered CI when it was introduced (#106).
 */
import { describe, expect, it } from 'vitest';
import { classifyForCi, HARNESS, SWEEP, LIVE, AREAS } from './change-areas.mjs';

const split = (s) => s.trim().split(/\s+/);

describe('classifyForCi', () => {
  it('docs-only change (5a770ef): skip', () => {
    const files = split(`CLAUDE.md docs/annotation-panel-modes.md docs/bug-review-2026-10.md
      docs/mockup/annotations-panel.html docs/multiviewport-annotation-requirements.md`);
    expect(classifyForCi(files)).toEqual({ mode: 'skip', build: false, dicom: false, related: [] });
  });

  it('comments across src, e2e and docs (#105, 246cc72): selective, no build, no DICOM', () => {
    const files = split(`CLAUDE.md PHASES.md docs/mockup/full-app.html e2e/specs/README.md
      e2e/specs/transport/sr-export.e2e.ts playwright.config.ts scripts/test-changed.mjs
      src/main/lib/normalizeServerUrl.test.ts src/main/xnat/sessionManager.ts src/main/xnat/xnatClient.ts
      src/renderer/hooks/useXnatAutosaveOptIn.ts src/renderer/stores/preferencesStore.ts src/shared/types/preferences.ts`);
    const plan = classifyForCi(files);
    expect(plan).toMatchObject({ mode: 'selective', build: false, dicom: false });
    expect(plan.related).toEqual(files.filter((f) => f.startsWith('src/')));
  });

  it('a dependency change (fc097f8, package-lock.json): full', () => {
    const files = split(`package-lock.json package.json src/renderer/components/annotations/Qc3dSheet.tsx`);
    expect(classifyForCi(files).mode).toBe('full');
  });

  it('DICOM export code (fbbb1ae): selective with the DICOM suites', () => {
    const files = split(`docs/cornerstone-v5-upgrade-plan.md e2e/specs/transport/seg-export-roundtrip.e2e.ts
      src/renderer/lib/cornerstone/dicomDatasetSource.ts src/renderer/lib/cornerstone/dicomExportHelpers.ts`);
    expect(classifyForCi(files)).toMatchObject({ mode: 'selective', dicom: true, build: false });
  });

  it('build inputs and the workflows', () => {
    expect(classifyForCi(['vite.config.ts']).build).toBe(true);
    expect(classifyForCi(['src/renderer/styles/globals.css']).build).toBe(true);
    expect(classifyForCi(['.github/workflows/release.yml']).mode).toBe('full');
    expect(classifyForCi(['scripts/change-areas.mjs']).mode).toBe('full'); // the classifier itself
  });
});

describe('E2E areas', () => {
  it('harness, sweep, live and area patterns', () => {
    expect(HARNESS.test('e2e/helpers/local-fixture.ts')).toBe(true);
    expect(HARNESS.test('src/renderer/lib/e2e/installRendererE2eHooks.ts')).toBe(true);
    expect(SWEEP.test('src/renderer/lib/segmentation/maskOps/fill.ts')).toBe(true);
    expect(LIVE.test('src/main/xnat/sessionManager.ts')).toBe(true);
    expect(AREAS.find((a) => a.name === 'transport').match.test('src/renderer/lib/cornerstone/srExport.ts')).toBe(true);
  });
});
