/**
 * Service-integration test for acceptance signal G17 (requirements §G):
 *
 *   "The active member is currently empty. The 'active' indicator in the
 *    list panel shows on its row, the panel shows the 'empty' marker.
 *    Drawing on the active viewport appends to this empty member, not to
 *    a new one; the empty marker clears."
 *
 * The user-visible invariant is that drawing into an empty active member
 * preserves the member's identity rather than auto-creating a new member.
 * The data-model surface that backs this is:
 *
 *   - `containerService.setActiveMember(memberId)` mirrors the member's
 *     `(csSegmentationId, segmentIndex)` to the legacy `useSegmentationStore`,
 *     which is what tools read to decide where new geometry lands.
 *
 *   - `containerStoreSync.rebuildMembersFromCs` re-derives `Container.members`
 *     from Cornerstone's segment state on every `SEGMENTATION_MODIFIED`. The
 *     `existingByIndex` reuse map preserves a Member's stable id whenever
 *     the segmentIndex is unchanged — drawing into segment 1 keeps member
 *     `memberIdFor(csSegId, 1)`, no new member is appended to
 *     `Container.members`.
 *
 * This test wires both surfaces with synthetic Cornerstone state through
 * the production DI seams and asserts:
 *
 *   1. setActiveMember on an empty member sets the legacy store correctly
 *      so a drawing tool would target this member.
 *   2. Triggering a SEGMENTATION_MODIFIED rebuild after a notional draw
 *      (segment 1 still present, possibly with new metadata on the cs
 *      side) leaves `members.length` unchanged and the active member's id
 *      stable.
 *   3. Activating an empty member then drawing does not push a fresh
 *      member onto the container — `listAll()`-derived counts stay at 1.
 *
 * The "empty marker UI clearing" is a presentation concern (rendered
 * conditionally in `ContainerListPanel` from `Member.csAnnotationUIDs`);
 * it has no data writer in the current code paths and is not exercised
 * here. The data-model invariants above are the load-bearing G17
 * guarantees.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Synthetic Cornerstone state. The bridge + storeSync read
// `csSegmentation.state.getSegmentation(csSegId).segments`; we drive that
// through the mock so a "draw" can append/modify segments in-place.
const segmentsByCsId: Record<string, Record<number, { label?: string }>> = {};

const { mockEventTarget } = vi.hoisted(() => ({
  mockEventTarget: new EventTarget(),
}));

vi.mock('@cornerstonejs/core', () => ({
  eventTarget: mockEventTarget,
}));

vi.mock('@cornerstonejs/tools', () => ({
  Enums: {
    Events: {
      SEGMENTATION_ADDED: 'CS_SEGMENTATION_ADDED',
      SEGMENTATION_REMOVED: 'CS_SEGMENTATION_REMOVED',
      SEGMENTATION_MODIFIED: 'CS_SEGMENTATION_MODIFIED',
    },
    SegmentationRepresentations: {
      Labelmap: 'Labelmap',
      Contour: 'Contour',
    },
  },
  segmentation: {
    state: {
      getSegmentation: vi.fn((csSegId: string) =>
        segmentsByCsId[csSegId]
          ? { segmentationId: csSegId, segments: segmentsByCsId[csSegId] }
          : undefined,
      ),
      getViewportIdsWithSegmentation: vi.fn(() => []),
    },
    config: {
      color: {
        getSegmentIndexColor: vi.fn(() => undefined),
      },
    },
    segmentLocking: {
      isSegmentIndexLocked: vi.fn(() => false),
    },
  },
}));

import * as containerBridge from '../containerBridge';
import * as containerStoreSync from '../containerStoreSync';
import { memberIdFor } from '../containerStoreSync';
import { containerService } from '../containerService';
import { useSegmentationStore } from '../../../stores/segmentationStore';
import { useContainerSelectionStore } from '../../../stores/containerSelectionStore';

// ─── Helpers ─────────────────────────────────────────────────────────────

const SEG_MODIFIED = 'CS_SEGMENTATION_MODIFIED';

function fireSegmentationModified(csSegId: string): void {
  mockEventTarget.dispatchEvent(
    new CustomEvent(SEG_MODIFIED, { detail: { segmentationId: csSegId } }),
  );
}

/**
 * Pre-populate Cornerstone's mocked segment state and register a container
 * in the bridge. The storeSync init path will rebuild members from the
 * cs state we expose via the mock.
 */
function setupContainerWithEmptyMember(
  csSegId: string,
  segmentIndex: number,
  label = 'GTV',
): { containerId: string; memberId: string } {
  segmentsByCsId[csSegId] = { [segmentIndex]: { label } };
  const containerId = containerBridge.register(csSegId, { name: csSegId });
  containerStoreSync.rebuildMembersFromCs(containerId);
  const memberId = memberIdFor(csSegId, segmentIndex);
  return { containerId, memberId };
}

// ─── Lifecycle ───────────────────────────────────────────────────────────

beforeEach(() => {
  for (const k of Object.keys(segmentsByCsId)) delete segmentsByCsId[k];
  containerBridge.clearAll();
  useContainerSelectionStore.setState({
    activeMemberId: null,
    selectionSet: new Set(),
    hoverMemberId: null,
  });
  useSegmentationStore.setState({
    ...useSegmentationStore.getState(),
    activeSegmentationId: null,
    activeSegmentIndex: 0,
  });
  containerStoreSync.initialize();
});

afterEach(() => {
  containerStoreSync.dispose();
  containerBridge.clearAll();
});

// ─── Tests ───────────────────────────────────────────────────────────────

describe('G17: drawing on an empty active member appends, not creates', () => {
  it('setActiveMember mirrors (csSegmentationId, segmentIndex) so tools target this member', () => {
    const { memberId } = setupContainerWithEmptyMember('cs-X', 1, 'GTV');

    containerService.setActiveMember(memberId);

    // The legacy single-source-of-truth that drawing tools read.
    const seg = useSegmentationStore.getState();
    expect(seg.activeSegmentationId).toBe('cs-X');
    expect(seg.activeSegmentIndex).toBe(1);

    // The new selection-store surface used by the list panel.
    expect(useContainerSelectionStore.getState().activeMemberId).toBe(memberId);
  });

  it('rebuild after a draw event preserves member identity (no append, no duplicate)', () => {
    const { containerId, memberId } = setupContainerWithEmptyMember('cs-X', 1, 'GTV');
    containerService.setActiveMember(memberId);

    const before = containerBridge.getContainer(containerId)!;
    expect(before.members).toHaveLength(1);
    expect(before.members[0].id).toBe(memberId);
    expect(before.members[0].segmentIndex).toBe(1);

    // Simulate a draw: cornerstone rebroadcasts SEGMENTATION_MODIFIED. The
    // segment-1 entry is unchanged in the cs state (drawing wrote pixels /
    // pushed an annotation, but did not add a new segment). The active
    // (csSegId, segmentIndex) is what the tool used to target the geometry.
    fireSegmentationModified('cs-X');

    const after = containerBridge.getContainer(containerId)!;
    expect(after.members).toHaveLength(1);
    expect(after.members[0].id).toBe(memberId);
    expect(after.members[0].segmentIndex).toBe(1);
  });

  it('legacy store stays pointing at the active member across rebuilds', () => {
    const { memberId } = setupContainerWithEmptyMember('cs-X', 1, 'GTV');
    containerService.setActiveMember(memberId);

    fireSegmentationModified('cs-X');
    fireSegmentationModified('cs-X');

    const seg = useSegmentationStore.getState();
    expect(seg.activeSegmentationId).toBe('cs-X');
    expect(seg.activeSegmentIndex).toBe(1);
    expect(useContainerSelectionStore.getState().activeMemberId).toBe(memberId);
  });

  it('a *different* segmentIndex appearing in cs state is what produces a new member (negative control)', () => {
    // Sanity: confirm rebuild does react to genuinely-new segments. This
    // ensures the previous tests' "no-append" behavior is meaningful and
    // not a stuck mock.
    const { containerId, memberId } = setupContainerWithEmptyMember('cs-X', 1, 'GTV');
    containerService.setActiveMember(memberId);

    // User explicitly creates a *second* member by some other route
    // (containerService.createMember, etc.). The test simulates that
    // outcome on the cs side.
    segmentsByCsId['cs-X'][2] = { label: 'CTV' };
    fireSegmentationModified('cs-X');

    const c = containerBridge.getContainer(containerId)!;
    expect(c.members).toHaveLength(2);
    // Original member's id is preserved.
    expect(c.members.find((m) => m.segmentIndex === 1)?.id).toBe(memberId);
    // New member at segmentIndex 2 has its own stable id.
    expect(c.members.find((m) => m.segmentIndex === 2)?.id).toBe(memberIdFor('cs-X', 2));

    // Drawing into the *active* (segmentIndex=1) member, then rebuilding,
    // still does not create another member.
    fireSegmentationModified('cs-X');
    expect(containerBridge.getContainer(containerId)!.members).toHaveLength(2);
  });
});
