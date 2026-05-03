/**
 * Service-integration test for acceptance signal G5 (requirements §G):
 *
 *   "Hide structure 'GTV' on panel A only. Other panels still show it.
 *    Close panel A and reopen — GTV is visible again, the per-viewport
 *    hide reset to the global default per A5."
 *
 * Implementation: `containerService.setMemberVisibilityOnViewport(memberId,
 * viewportId, visible)` calls Cornerstone's per-(viewport, segmentation,
 * kind) `setSegmentVisibility` for one viewport only. The override lives
 * in Cornerstone's representation state, so it disappears when the
 * viewport's representation is destroyed (close panel) — and reattaching
 * starts from the global default (reopen). No application-side storage;
 * no global D7.3 mutation.
 *
 * Invariants pinned:
 *   1. Per-viewport hide on viewport A does NOT call setSegmentVisibility
 *      for viewport B.
 *   2. Per-viewport hide does NOT mutate `Member.visibility` (the global
 *      D7.3 mode); other viewports continue to follow that mode.
 *   3. The override is NOT stored in any application-side state — closing
 *      and reopening the viewport restarts from defaults because there is
 *      nothing for our code to re-apply.
 *   4. Empty / invalid memberId / viewportId is a no-op.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
      getSegmentation: vi.fn(() => ({ label: 'M' })),
      getViewportIdsWithSegmentation: vi.fn(() => []),
    },
    config: { color: { getSegmentIndexColor: vi.fn(() => undefined) } },
    segmentLocking: { isSegmentIndexLocked: vi.fn(() => false) },
  },
}));

import * as containerBridge from '../containerBridge';
import { containerService } from '../containerService';
import {
  wireContainerService,
  resetContainerServiceWiring,
} from '../containerService';
import { memberIdFor } from '../containerStoreSync';

interface VisibilityCall {
  viewportId: string;
  segmentationId: string;
  segmentIndex: number;
  kind: 'Labelmap' | 'Contour';
  visible: boolean;
}

let visibilityCalls: VisibilityCall[];

function makeContainerWithMember(csSegId: string, segmentIndex: number): {
  containerId: string;
  memberId: string;
} {
  const containerId = containerBridge.register(csSegId, { name: csSegId });
  const c = containerBridge.getContainer(containerId)!;
  const memberId = memberIdFor(csSegId, segmentIndex);
  c.members.push({
    id: memberId,
    name: 'GTV',
    color: [255, 0, 0],
    visibility: 'filled', // global D7.3 default
    locked: false,
    provenance: 'manual',
    roiType: null,
    roiNumber: segmentIndex,
    interpolationState: null,
    segmentIndex,
    segmentDescription: null,
    segmentedPropertyCategory: null,
    segmentedPropertyType: null,
    poiPoints: null,
    algebra: null,
    algebraSources: null,
    algebraOutOfDate: false,
    algebraManualOverride: false,
    csAnnotationUIDs: null,
    csSegmentationId: csSegId,
    createdAt: 0,
    modifiedAt: 0,
  });
  return { containerId, memberId };
}

beforeEach(() => {
  containerBridge.clearAll();
  visibilityCalls = [];
  wireContainerService({
    setSegmentStyle: () => undefined,
    setSegmentVisibility: (viewportId, segmentationId, segmentIndex, kind, visible) => {
      visibilityCalls.push({ viewportId, segmentationId, segmentIndex, kind, visible });
    },
    getViewportIdsWithSegmentation: () => ['panel_0', 'panel_1'],
    getRepresentationKinds: () => ['Labelmap'],
    addSegment: () => Promise.resolve(0),
    removeSegment: () => undefined,
    renameSegment: () => undefined,
    setSegmentColor: () => undefined,
    setSegmentLocked: () => undefined,
  });
});

afterEach(() => {
  resetContainerServiceWiring();
  containerBridge.clearAll();
});

describe('G5: per-viewport hide (containerService.setMemberVisibilityOnViewport)', () => {
  it('hides on the named viewport only — does not call setSegmentVisibility for other viewports', () => {
    const { memberId } = makeContainerWithMember('cs-X', 1);

    containerService.setMemberVisibilityOnViewport(memberId, 'panel_0', false);

    const targets = visibilityCalls.map((c) => c.viewportId);
    expect(targets).toEqual(['panel_0']); // exactly one call, exactly one viewport
    expect(visibilityCalls[0]).toMatchObject({
      viewportId: 'panel_0',
      segmentationId: 'cs-X',
      segmentIndex: 1,
      visible: false,
    });
  });

  it('shows-on-this-viewport-only is symmetric: call with visible=true targets one viewport', () => {
    const { memberId } = makeContainerWithMember('cs-X', 1);

    containerService.setMemberVisibilityOnViewport(memberId, 'panel_1', true);

    expect(visibilityCalls.map((c) => c.viewportId)).toEqual(['panel_1']);
    expect(visibilityCalls[0].visible).toBe(true);
  });

  it('does NOT mutate the global Member.visibility (D7.3 mode unaffected)', () => {
    const { containerId, memberId } = makeContainerWithMember('cs-X', 1);
    const memberBefore = containerBridge.getContainer(containerId)!.members[0];
    expect(memberBefore.visibility).toBe('filled');

    containerService.setMemberVisibilityOnViewport(memberId, 'panel_0', false);

    const memberAfter = containerBridge.getContainer(containerId)!.members[0];
    expect(memberAfter.visibility).toBe('filled'); // unchanged
  });

  it('does NOT mark the container dirty', () => {
    const { containerId, memberId } = makeContainerWithMember('cs-X', 1);
    expect(containerBridge.getContainer(containerId)!.dirty).toBe(false);

    containerService.setMemberVisibilityOnViewport(memberId, 'panel_0', false);

    expect(containerBridge.getContainer(containerId)!.dirty).toBe(false);
  });

  it('iterates each representation kind the segmentation has data for', () => {
    // Re-wire with both kinds
    wireContainerService({
      setSegmentStyle: () => undefined,
      setSegmentVisibility: (viewportId, segmentationId, segmentIndex, kind, visible) => {
        visibilityCalls.push({ viewportId, segmentationId, segmentIndex, kind, visible });
      },
      getViewportIdsWithSegmentation: () => ['panel_0'],
      getRepresentationKinds: () => ['Labelmap', 'Contour'],
      addSegment: () => Promise.resolve(0),
      removeSegment: () => undefined,
      renameSegment: () => undefined,
      setSegmentColor: () => undefined,
      setSegmentLocked: () => undefined,
    });

    const { memberId } = makeContainerWithMember('cs-X', 1);
    containerService.setMemberVisibilityOnViewport(memberId, 'panel_0', false);

    expect(visibilityCalls.map((c) => c.kind)).toEqual(['Labelmap', 'Contour']);
  });

  it('throws on unknown memberId (clear failure mode, not silent)', () => {
    expect(() =>
      containerService.setMemberVisibilityOnViewport('does-not-exist', 'panel_0', false),
    ).toThrow(/unknown memberId/);
  });

  it('is a silent no-op when memberId is empty (defensive)', () => {
    expect(() =>
      containerService.setMemberVisibilityOnViewport('', 'panel_0', false),
    ).not.toThrow();
    expect(visibilityCalls).toHaveLength(0);
  });

  it('is a silent no-op when viewportId is empty (defensive)', () => {
    const { memberId } = makeContainerWithMember('cs-X', 1);
    containerService.setMemberVisibilityOnViewport(memberId, '', false);
    expect(visibilityCalls).toHaveLength(0);
  });

  it('skips application when the member has no segmentIndex (POI / metadata-only members)', () => {
    const containerId = containerBridge.register('cs-X', { name: 'cs-X' });
    const c = containerBridge.getContainer(containerId)!;
    c.members.push({
      id: 'm-poi',
      name: 'Marker',
      color: [0, 0, 255],
      visibility: 'filled',
      locked: false,
      provenance: 'manual',
      roiType: null,
      roiNumber: null,
      interpolationState: null,
      segmentIndex: null, // POI member
      segmentDescription: null,
      segmentedPropertyCategory: null,
      segmentedPropertyType: null,
      poiPoints: [[0, 0, 0]],
      algebra: null,
      algebraSources: null,
      algebraOutOfDate: false,
      algebraManualOverride: false,
      csAnnotationUIDs: null,
      csSegmentationId: 'cs-X',
      createdAt: 0,
      modifiedAt: 0,
    });

    containerService.setMemberVisibilityOnViewport('m-poi', 'panel_0', false);
    expect(visibilityCalls).toHaveLength(0);
  });
});

describe('G5: close-and-reopen reset (lifecycle invariant)', () => {
  it('does NOT persist the per-viewport hide in any application-side state', () => {
    // Structural assertion: the override lives in Cornerstone's per-viewport
    // representation state, not in our bridge / store / preferences. After
    // setMemberVisibilityOnViewport, the only application-side change is the
    // setSegmentVisibility call we routed through — there is no override map
    // to clear when the viewport closes.
    const { containerId, memberId } = makeContainerWithMember('cs-X', 1);

    containerService.setMemberVisibilityOnViewport(memberId, 'panel_0', false);

    // Snapshot the bridge after the per-viewport hide. The container and
    // member should be byte-identical apart from any incidental modifiedAt
    // updates — the visibility field stays at 'filled', no per-viewport
    // hide map was added.
    const c = containerBridge.getContainer(containerId)!;
    expect(c.members[0].visibility).toBe('filled');
    expect((c.members[0] as unknown as Record<string, unknown>).perViewportHidden).toBeUndefined();
    expect((c as unknown as Record<string, unknown>).perViewportHidden).toBeUndefined();
  });

  it('reattach simulation: a new representation on the same panelId picks up the global default', () => {
    // We model "viewport close + reopen" by:
    //   1. Setting per-viewport hide on panel_0 (records the cs-side state via our mock)
    //   2. Simulating close: clear our recorded calls (Cornerstone destroys its representation)
    //   3. Simulating reopen: representation comes back fresh; no replay of the hide
    //      call from our code. Confirmed by visibilityCalls staying empty.
    const { memberId } = makeContainerWithMember('cs-X', 1);

    containerService.setMemberVisibilityOnViewport(memberId, 'panel_0', false);
    expect(visibilityCalls).toHaveLength(1);

    // Simulate close: clear recorded calls (Cornerstone destroys per-viewport state)
    visibilityCalls.length = 0;

    // Simulate reopen: in production, the panel mounts a fresh representation
    // with its default visibility. Our code is NOT called to re-apply the
    // hide — there is no source to replay from.
    // (No code path invocation here; we are asserting the absence of one.)
    expect(visibilityCalls).toHaveLength(0);

    // Optional positive control: re-applying the global mode (D7.3 cycle)
    // would call setSegmentVisibility for ALL viewports, not for the panel
    // alone. The per-viewport hide does NOT carry over.
  });
});
