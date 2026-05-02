import { describe, expect, it } from 'vitest';
import { decideDrawingRouting, type DecisionInputs } from './drawingRouting';
import type { SourceIdentityForEligibility } from './visibility';

function id(partial: Partial<SourceIdentityForEligibility> = {}): SourceIdentityForEligibility {
  return {
    seriesUID: 'S1',
    frameOfReferenceUID: 'F1',
    acquisitionNumber: null,
    ...partial,
  };
}

function inputs(over: Partial<DecisionInputs> = {}): DecisionInputs {
  return {
    activeContainerIdentity: id(),
    viewportIdentity: id(),
    anyForMatchedViewportOpen: true,
    activeContainerSeriesDescription: null,
    ...over,
  };
}

describe('decideDrawingRouting', () => {
  it('allows when active container identity is unknown (be permissive)', () => {
    expect(
      decideDrawingRouting(inputs({ activeContainerIdentity: null })),
    ).toEqual({ kind: 'allow' });
  });

  it('allows when viewport identity is unknown but active is known and any-FoR-matched=true', () => {
    expect(
      decideDrawingRouting(inputs({ viewportIdentity: null })),
    ).toEqual({ kind: 'allow' });
  });

  it('blocks "no FoR-matched viewport" everywhere when no open viewport matches the container FoR', () => {
    const decision = decideDrawingRouting(inputs({ anyForMatchedViewportOpen: false }));
    expect(decision.kind).toBe('block');
    if (decision.kind === 'block') {
      expect(decision.reason).toBe('no-for-matched-viewport-open');
      expect(decision.hintMessage).toMatch(/no open viewport shares/i);
    }
  });

  it('blocks "no FoR-matched viewport" even when viewport identity is unknown (target has no valid landing anywhere)', () => {
    const decision = decideDrawingRouting(
      inputs({ anyForMatchedViewportOpen: false, viewportIdentity: null }),
    );
    expect(decision.kind).toBe('block');
    if (decision.kind === 'block') {
      expect(decision.reason).toBe('no-for-matched-viewport-open');
    }
  });

  it('allows native (matching FoR + series)', () => {
    expect(
      decideDrawingRouting(
        inputs({
          activeContainerIdentity: id({ seriesUID: 'S1', frameOfReferenceUID: 'F1' }),
          viewportIdentity: id({ seriesUID: 'S1', frameOfReferenceUID: 'F1' }),
        }),
      ),
    ).toEqual({ kind: 'allow' });
  });

  it('blocks cross-FoR (viewport has different FoR)', () => {
    const decision = decideDrawingRouting(
      inputs({
        activeContainerIdentity: id({ frameOfReferenceUID: 'F1' }),
        viewportIdentity: id({ frameOfReferenceUID: 'F2' }),
      }),
    );
    expect(decision.kind).toBe('block');
    if (decision.kind === 'block') {
      expect(decision.reason).toBe('cross-for');
      expect(decision.hintMessage).toMatch(/different frame of reference/i);
    }
  });

  it('blocks cross-series (same FoR, different series) with hint mentioning the structure’s native series', () => {
    const decision = decideDrawingRouting(
      inputs({
        activeContainerIdentity: id({ seriesUID: 'T1', frameOfReferenceUID: 'F1' }),
        viewportIdentity: id({ seriesUID: 'T2', frameOfReferenceUID: 'F1' }),
        activeContainerSeriesDescription: 'T1 SAG',
      }),
    );
    expect(decision.kind).toBe('block');
    if (decision.kind === 'block') {
      expect(decision.reason).toBe('cross-series');
      expect(decision.hintMessage).toContain('T1 SAG');
    }
  });

  it('blocks cross-series with a generic hint when no series description is provided', () => {
    const decision = decideDrawingRouting(
      inputs({
        activeContainerIdentity: id({ seriesUID: 'A', frameOfReferenceUID: 'F1' }),
        viewportIdentity: id({ seriesUID: 'B', frameOfReferenceUID: 'F1' }),
      }),
    );
    expect(decision.kind).toBe('block');
    if (decision.kind === 'block') {
      expect(decision.hintMessage).toMatch(/native series/i);
    }
  });

  it('cross-FoR check fires before cross-series check', () => {
    // Same series UID but different FoR (a degenerate case but should still
    // resolve to cross-FoR, not native, not cross-series).
    const decision = decideDrawingRouting(
      inputs({
        activeContainerIdentity: id({ seriesUID: 'S', frameOfReferenceUID: 'F1' }),
        viewportIdentity: id({ seriesUID: 'S', frameOfReferenceUID: 'F2' }),
      }),
    );
    expect(decision.kind).toBe('block');
    if (decision.kind === 'block') {
      expect(decision.reason).toBe('cross-for');
    }
  });

  it('any-FoR-matched=false takes precedence over per-viewport classification', () => {
    // Even if the viewport happens to have matching identity, the global
    // "no FoR-matched viewport" check fires first (caller passes
    // anyForMatchedViewportOpen=false based on a session-wide scan).
    const decision = decideDrawingRouting(
      inputs({
        activeContainerIdentity: id({ seriesUID: 'S1', frameOfReferenceUID: 'F1' }),
        viewportIdentity: id({ seriesUID: 'S1', frameOfReferenceUID: 'F1' }),
        anyForMatchedViewportOpen: false,
      }),
    );
    expect(decision.kind).toBe('block');
    if (decision.kind === 'block') {
      expect(decision.reason).toBe('no-for-matched-viewport-open');
    }
  });
});
