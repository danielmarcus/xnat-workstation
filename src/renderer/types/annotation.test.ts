/**
 * Type-shape and construction tests for the annotation data model.
 *
 * These are not behavioral tests — they verify that the type definitions
 * compile correctly, that defaults round-trip through JSON, and that the
 * documented invariants (e.g., RTSTRUCT-only fields are nullable on SEG
 * members) hold at construction time.
 *
 * Behavioral tests for the consuming services land alongside those services.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_APPROVAL,
  EMPTY_ACTIVE_STATE,
  UNDO_HISTORY_LIMIT,
  type ActiveState,
  type ApprovalEvent,
  type ApprovalState,
  type Container,
  type ContainerHistory,
  type HistoryEntry,
  type Member,
  type RGB,
  type SourceIdentity,
} from './annotation';

// ─── Constructors used across cases ──────────────────────────────────────

const RED: RGB = [255, 0, 0];

function makeRTSTRUCTMember(overrides: Partial<Member> = {}): Member {
  return {
    id: 'm-1',
    name: 'PTV',
    color: RED,
    visibility: 'outlined',
    locked: false,
    provenance: 'manual',
    roiType: 'PTV',
    roiNumber: 1,
    interpolationState: 'none',
    segmentIndex: null,
    segmentDescription: null,
    segmentedPropertyCategory: null,
    segmentedPropertyType: null,
    poiPoints: null,
    algebra: null,
    algebraSources: null,
    algebraOutOfDate: false,
    algebraManualOverride: false,
    csAnnotationUIDs: null,
    csSegmentationId: null,
    createdAt: 0,
    modifiedAt: 0,
    ...overrides,
  };
}

function makeSEGMember(overrides: Partial<Member> = {}): Member {
  return {
    id: 's-1',
    name: 'Liver',
    color: [200, 100, 50],
    visibility: 'filled',
    locked: false,
    provenance: 'manual',
    roiType: null,
    roiNumber: null,
    interpolationState: null,
    segmentIndex: 1,
    segmentDescription: 'Liver segmentation',
    segmentedPropertyCategory: null,
    segmentedPropertyType: null,
    poiPoints: null,
    algebra: null,
    algebraSources: null,
    algebraOutOfDate: false,
    algebraManualOverride: false,
    csAnnotationUIDs: null,
    csSegmentationId: 'seg-uid-1',
    createdAt: 0,
    modifiedAt: 0,
    ...overrides,
  };
}

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'c-1',
    kind: 'RTSTRUCT',
    name: 'StructureSet 1',
    members: [],
    sourceIdentity: null,
    approval: DEFAULT_APPROVAL,
    dirty: false,
    saveInFlight: false,
    versionToken: null,
    parseError: null,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('annotation data model', () => {
  describe('Member construction', () => {
    it('accepts a fully populated RTSTRUCT member', () => {
      const m = makeRTSTRUCTMember();
      expect(m.roiType).toBe('PTV');
      expect(m.roiNumber).toBe(1);
      expect(m.segmentIndex).toBeNull();
      expect(m.csSegmentationId).toBeNull();
    });

    it('accepts a fully populated SEG member', () => {
      const m = makeSEGMember();
      expect(m.segmentIndex).toBe(1);
      expect(m.csSegmentationId).toBe('seg-uid-1');
      expect(m.roiType).toBeNull();
      expect(m.roiNumber).toBeNull();
    });

    it('accepts a POI member with world points and null kind-specific fields', () => {
      const m = makeRTSTRUCTMember({
        id: 'p-1',
        name: 'Isocenter',
        roiType: null,
        roiNumber: null,
        interpolationState: null,
        poiPoints: [[10, 20, 30]],
      });
      expect(m.poiPoints).toEqual([[10, 20, 30]]);
    });
  });

  describe('Forward-compat algebra fields', () => {
    it('all v1 members have null algebra and false flags', () => {
      const m = makeRTSTRUCTMember();
      expect(m.algebra).toBeNull();
      expect(m.algebraSources).toBeNull();
      expect(m.algebraOutOfDate).toBe(false);
      expect(m.algebraManualOverride).toBe(false);
    });

    it('algebra fields survive JSON round-trip when set', () => {
      const m = makeRTSTRUCTMember({
        algebra: { expression: 'CTV + 5mm' },
        algebraSources: ['m-ctv'],
        algebraOutOfDate: true,
        algebraManualOverride: false,
      });
      const restored: Member = JSON.parse(JSON.stringify(m));
      expect(restored.algebra).toEqual({ expression: 'CTV + 5mm' });
      expect(restored.algebraSources).toEqual(['m-ctv']);
      expect(restored.algebraOutOfDate).toBe(true);
      expect(restored.algebraManualOverride).toBe(false);
    });
  });

  describe('Container construction', () => {
    it('starts unsaved (sourceIdentity null) until transport assigns one (H8)', () => {
      const c = makeContainer();
      expect(c.sourceIdentity).toBeNull();
      expect(c.versionToken).toBeNull();
    });

    it('starts unapproved by default', () => {
      const c = makeContainer();
      expect(c.approval).toEqual(DEFAULT_APPROVAL);
      expect(c.approval.approved).toBe(false);
    });

    it('starts clean and not in flight', () => {
      const c = makeContainer();
      expect(c.dirty).toBe(false);
      expect(c.saveInFlight).toBe(false);
    });

    it('accepts members of multiple kinds (RTSTRUCT example)', () => {
      const c = makeContainer({ members: [makeRTSTRUCTMember(), makeRTSTRUCTMember({ id: 'm-2', name: 'CTV', roiNumber: 2 })] });
      expect(c.members).toHaveLength(2);
      expect(c.members[0]!.roiNumber).toBe(1);
      expect(c.members[1]!.roiNumber).toBe(2);
    });
  });

  describe('SourceIdentity', () => {
    it('round-trips through JSON', () => {
      const s: SourceIdentity = {
        uri: 'xnat://project/exp/scan/1',
        modality: 'RTSTRUCT',
        referencedSeriesUIDs: ['1.2.3', '1.2.4'],
        referencedFrameOfReferenceUID: '1.2.5',
        loadedAt: Date.now(),
      };
      const restored: SourceIdentity = JSON.parse(JSON.stringify(s));
      expect(restored).toEqual(s);
    });
  });

  describe('ApprovalState', () => {
    it('default is unapproved with empty history', () => {
      expect(DEFAULT_APPROVAL.approved).toBe(false);
      expect(DEFAULT_APPROVAL.reviewerName).toBeNull();
      expect(DEFAULT_APPROVAL.reviewedAt).toBeNull();
      expect(DEFAULT_APPROVAL.history).toEqual([]);
    });

    it('approval events round-trip through JSON', () => {
      const ev: ApprovalEvent = { action: 'approve', by: 'dmarcus', at: 1700000000000 };
      const state: ApprovalState = {
        approved: true,
        reviewerName: 'dmarcus',
        reviewedAt: 1700000000000,
        history: [ev],
      };
      const restored: ApprovalState = JSON.parse(JSON.stringify(state));
      expect(restored).toEqual(state);
    });
  });

  describe('ActiveState', () => {
    it('empty default has no active member, empty selection, no viewport', () => {
      expect(EMPTY_ACTIVE_STATE.activeMemberId).toBeNull();
      expect(EMPTY_ACTIVE_STATE.activeViewportId).toBeNull();
      expect(EMPTY_ACTIVE_STATE.selectionSet.size).toBe(0);
    });

    it('selectionSet supports multi-select per D7.5', () => {
      const s: ActiveState = {
        ...EMPTY_ACTIVE_STATE,
        selectionSet: new Set(['m-1', 'm-2', 'm-3']),
      };
      expect(s.selectionSet.size).toBe(3);
    });
  });

  describe('Undo / redo shape (A8)', () => {
    it('history-limit constant matches the spec', () => {
      expect(UNDO_HISTORY_LIMIT).toBe(100);
    });

    it('a HistoryEntry holds apply/invert closures and member scope', () => {
      let counter = 0;
      const entry: HistoryEntry = {
        description: 'test',
        apply: () => { counter += 1; },
        invert: () => { counter -= 1; },
        scopeMemberIds: ['m-1'],
        at: 0,
      };
      entry.apply();
      expect(counter).toBe(1);
      entry.invert();
      expect(counter).toBe(0);
    });

    it('ContainerHistory holds two stacks per container', () => {
      const h: ContainerHistory = {
        containerId: 'c-1',
        undoStack: [],
        redoStack: [],
      };
      expect(h.undoStack).toEqual([]);
      expect(h.redoStack).toEqual([]);
    });
  });
});
