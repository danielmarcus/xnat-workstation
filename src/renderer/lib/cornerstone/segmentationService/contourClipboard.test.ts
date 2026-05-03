/**
 * Unit tests for the contour-clipboard interpolation-chain UID helper.
 *
 * `resolveContourChainInterpolationUIDWithDeps` is the load-bearing piece
 * of the paste fix for the pre-existing 05-segmentations.e2e.ts failure:
 * pasted contours used to land on a fresh chain (`interpolationUID: ''`),
 * so Cornerstone's `InterpolationManager.handleAnnotationCompleted` refused
 * to fill in-between rungs. The helper finds-or-mints a UID for the chain
 * (`segmentationId`, `segmentIndex`, `viewPlaneNormal`, `viewUp`) and
 * backfills any chain members that lack one.
 *
 * Tested via the DI-friendly variant so the helper exercises in isolation
 * — no Cornerstone tools/core import side effects.
 */
import { describe, expect, it } from 'vitest';

const NORMAL = [0, 0, 1] as const;
const UP = [0, 1, 0] as const;

let mintCount = 0;
function makeDeps(allAnnotations: unknown[]) {
  return {
    getAllAnnotations: () => allAnnotations,
    mintUID: () => {
      mintCount += 1;
      return `minted-${mintCount}`;
    },
  };
}

// We use dynamic import so the test file doesn't have to mock the entire
// Cornerstone stack just to read a pure function from the same module.
// Vitest runs each describe in its own scope; we can lazy-import safely.
import { resolveContourChainInterpolationUIDWithDeps } from './contourClipboard.helpers';

describe('resolveContourChainInterpolationUIDWithDeps', () => {
  it('mints a fresh UID when no chain candidates exist', () => {
    const uid = resolveContourChainInterpolationUIDWithDeps(
      {
        segmentationId: 'seg-A',
        segmentIndex: 1,
        viewPlaneNormal: [0, 0, 1],
        viewUp: [0, 1, 0],
      },
      makeDeps([]),
    );
    expect(uid).toMatch(/^minted-/);
  });

  it('reuses an existing UID found on a chain member', () => {
    const all = [
      {
        data: { segmentation: { segmentationId: 'seg-A', segmentIndex: 1 } },
        metadata: { viewPlaneNormal: [0, 0, 1], viewUp: [0, 1, 0] },
        interpolationUID: 'pre-existing-chain-uid',
      },
    ];
    const uid = resolveContourChainInterpolationUIDWithDeps(
      {
        segmentationId: 'seg-A',
        segmentIndex: 1,
        viewPlaneNormal: [...NORMAL],
        viewUp: [...UP],
      },
      makeDeps(all),
    );
    expect(uid).toBe('pre-existing-chain-uid');
  });

  it('backfills the minted UID onto chain members that lack one', () => {
    const a: Record<string, unknown> = {
      data: { segmentation: { segmentationId: 'seg-A', segmentIndex: 1 } },
      metadata: { viewPlaneNormal: [0, 0, 1], viewUp: [0, 1, 0] },
    };
    const b: Record<string, unknown> = {
      data: { segmentation: { segmentationId: 'seg-A', segmentIndex: 1 } },
      metadata: { viewPlaneNormal: [0, 0, 1], viewUp: [0, 1, 0] },
    };
    const uid = resolveContourChainInterpolationUIDWithDeps(
      {
        segmentationId: 'seg-A',
        segmentIndex: 1,
        viewPlaneNormal: [...NORMAL],
        viewUp: [...UP],
      },
      makeDeps([a, b]),
    );
    expect(uid).toMatch(/^minted-/);
    expect(a.interpolationUID).toBe(uid);
    expect(b.interpolationUID).toBe(uid);
  });

  it('does not overwrite an existing interpolationUID on chain members', () => {
    const a: Record<string, unknown> = {
      data: { segmentation: { segmentationId: 'seg-A', segmentIndex: 1 } },
      metadata: { viewPlaneNormal: [0, 0, 1], viewUp: [0, 1, 0] },
      interpolationUID: 'kept',
    };
    const b: Record<string, unknown> = {
      data: { segmentation: { segmentationId: 'seg-A', segmentIndex: 1 } },
      metadata: { viewPlaneNormal: [0, 0, 1], viewUp: [0, 1, 0] },
    };
    const uid = resolveContourChainInterpolationUIDWithDeps(
      {
        segmentationId: 'seg-A',
        segmentIndex: 1,
        viewPlaneNormal: [...NORMAL],
        viewUp: [...UP],
      },
      makeDeps([a, b]),
    );
    expect(uid).toBe('kept');
    expect(a.interpolationUID).toBe('kept');
    expect(b.interpolationUID).toBe('kept');
  });

  it('excludes annotations on a different segmentationId', () => {
    const all = [
      {
        data: { segmentation: { segmentationId: 'OTHER-seg', segmentIndex: 1 } },
        metadata: { viewPlaneNormal: [0, 0, 1], viewUp: [0, 1, 0] },
        interpolationUID: 'unrelated',
      },
    ];
    const uid = resolveContourChainInterpolationUIDWithDeps(
      {
        segmentationId: 'seg-A',
        segmentIndex: 1,
        viewPlaneNormal: [...NORMAL],
        viewUp: [...UP],
      },
      makeDeps(all),
    );
    expect(uid).toMatch(/^minted-/);
  });

  it('excludes annotations on a different segmentIndex', () => {
    const all = [
      {
        data: { segmentation: { segmentationId: 'seg-A', segmentIndex: 2 } },
        metadata: { viewPlaneNormal: [0, 0, 1], viewUp: [0, 1, 0] },
        interpolationUID: 'segment-2-chain',
      },
    ];
    const uid = resolveContourChainInterpolationUIDWithDeps(
      {
        segmentationId: 'seg-A',
        segmentIndex: 1,
        viewPlaneNormal: [...NORMAL],
        viewUp: [...UP],
      },
      makeDeps(all),
    );
    expect(uid).toMatch(/^minted-/);
  });

  it('excludes annotations whose viewPlaneNormal differs (different orientation)', () => {
    const all = [
      {
        data: { segmentation: { segmentationId: 'seg-A', segmentIndex: 1 } },
        metadata: { viewPlaneNormal: [1, 0, 0], viewUp: [0, 1, 0] },
        interpolationUID: 'sagittal-chain',
      },
    ];
    const uid = resolveContourChainInterpolationUIDWithDeps(
      {
        segmentationId: 'seg-A',
        segmentIndex: 1,
        viewPlaneNormal: [...NORMAL],
        viewUp: [...UP],
      },
      makeDeps(all),
    );
    expect(uid).toMatch(/^minted-/);
  });

  it('mints a fresh UID without backfilling when viewPlaneNormal/viewUp are missing', () => {
    const a: Record<string, unknown> = {
      data: { segmentation: { segmentationId: 'seg-A', segmentIndex: 1 } },
      metadata: { viewPlaneNormal: [0, 0, 1], viewUp: [0, 1, 0] },
    };
    const uid = resolveContourChainInterpolationUIDWithDeps(
      {
        segmentationId: 'seg-A',
        segmentIndex: 1,
        viewPlaneNormal: undefined,
        viewUp: undefined,
      },
      makeDeps([a]),
    );
    expect(uid).toMatch(/^minted-/);
    // The candidate intentionally NOT backfilled when the new annotation's
    // orientation is unknown — we cannot prove it belongs to the same chain.
    expect(a.interpolationUID).toBeUndefined();
  });
});
