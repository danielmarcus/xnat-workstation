/**
 * Component tests for the Phase 3.3 ContainerListPanel.
 *
 * Drives the panel through synthetic Container snapshots in
 * useContainerStore. No bridge interaction — these tests verify the
 * UI shell renders state correctly.
 */
import { act, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock containerService methods — we just verify the panel calls them
// with the right arguments. The service's behavior is covered by
// containerService.test.ts.
const setMemberVisibilityMock = vi.hoisted(() => vi.fn());
const setMemberLockMock = vi.hoisted(() => vi.fn());
const setActiveMemberMock = vi.hoisted(() => vi.fn());
const renameMemberMock = vi.hoisted(() => vi.fn());
const renameContainerMock = vi.hoisted(() => vi.fn());
const reorderMemberMock = vi.hoisted(() => vi.fn());
const recolorMemberMock = vi.hoisted(() => vi.fn());
const deleteMemberMock = vi.hoisted(() => vi.fn());
const deleteContainerMock = vi.hoisted(() => vi.fn());
const setA2cOptedInMock = vi.hoisted(() => vi.fn());
const approveContainerMock = vi.hoisted(() => vi.fn());
const revokeApprovalMock = vi.hoisted(() => vi.fn());
const setRoiTypeMock = vi.hoisted(() => vi.fn());

vi.mock('../../lib/cornerstone/containerService', () => ({
  containerService: {
    setMemberVisibility: setMemberVisibilityMock,
    setMemberLock: setMemberLockMock,
    setActiveMember: setActiveMemberMock,
    renameMember: renameMemberMock,
    renameContainer: renameContainerMock,
    reorderMember: reorderMemberMock,
    recolorMember: recolorMemberMock,
    deleteMember: deleteMemberMock,
    deleteContainer: deleteContainerMock,
    setA2cOptedIn: setA2cOptedInMock,
    approveContainer: approveContainerMock,
    revokeApproval: revokeApprovalMock,
    setRoiType: setRoiTypeMock,
  },
}));

const saveContainerMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const revertContainerMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const exportContainerMock = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const uploadContainerToXnatMock = vi.hoisted(() => vi.fn().mockResolvedValue('saved'));
const saveAllDirtyMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const stepThroughInterpolatedMock = vi.hoisted(() => vi.fn());
const setAllMembersVisibilityMock = vi.hoisted(() => vi.fn().mockReturnValue(0));
const setAllMembersLockMock = vi.hoisted(() => vi.fn().mockReturnValue(0));

vi.mock('../../lib/cornerstone/containerActions', () => ({
  saveContainer: saveContainerMock,
  revertContainer: revertContainerMock,
  exportContainer: exportContainerMock,
  uploadContainerToXnat: uploadContainerToXnatMock,
  saveAllDirty: saveAllDirtyMock,
  stepThroughInterpolated: stepThroughInterpolatedMock,
  setAllMembersVisibility: setAllMembersVisibilityMock,
  setAllMembersLock: setAllMembersLockMock,
}));

const createNewSegmentationMock = vi.hoisted(() => vi.fn().mockResolvedValue('seg_new_1'));
const createNewStructureMock = vi.hoisted(() => vi.fn().mockResolvedValue('struct_new_1'));
// Default: panel_0 sees every container, panel_1+ see none. Tests
// can override per-case via `getVisibleSegMock.mockImplementation(...)`.
const getVisibleSegMock = vi.hoisted(() =>
  vi.fn((vp: string) => (vp === 'panel_0' ? null : new Set<string>())),
);

vi.mock('../../lib/segmentation/segmentationManagerSingleton', () => ({
  segmentationManager: {
    createNewSegmentation: createNewSegmentationMock,
    createNewStructure: createNewStructureMock,
    getVisibleSegmentationIdsForViewport: getVisibleSegMock,
  },
}));

import ContainerListPanel from './ContainerListPanel';
import { useContainerStore } from '../../stores/containerStore';
import { useContainerSelectionStore } from '../../stores/containerSelectionStore';
import { useTransportStore } from '../../stores/transportStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { usePreferencesStore } from '../../stores/preferencesStore';
import { useViewerStore } from '../../stores/viewerStore';
import { useToastStore } from '../../lib/toast/toastService';
import {
  ANNOTATION_PANEL_DEFAULT_WIDTH,
  ANNOTATION_PANEL_MAX_WIDTH,
  ANNOTATION_PANEL_MIN_WIDTH,
} from '@shared/types/preferences';
import {
  resetVisibilityAdapter,
  wireVisibility,
} from '../../lib/cornerstone/segmentationService/visibility';
import type { Container, Member } from '../../types/annotation';

function makeMember(partial: Partial<Member> = {}): Member {
  return {
    id: 'member_1',
    name: 'Member 1',
    color: [220, 50, 50],
    visibility: 'filled',
    locked: false,
    provenance: 'manual',
    roiType: null,
    roiNumber: null,
    interpolationState: null,
    segmentIndex: 1,
    segmentDescription: null,
    segmentedPropertyCategory: null,
    segmentedPropertyType: null,
    poiPoints: null,
    algebra: null,
    algebraSources: null,
    algebraOutOfDate: false,
    algebraManualOverride: false,
    csAnnotationUIDs: null,
    csSegmentationId: 'seg_1',
    createdAt: 0,
    modifiedAt: 0,
    ...partial,
  };
}

function makeContainer(partial: Partial<Container> = {}): Container {
  return {
    id: 'container_1',
    kind: 'SEG',
    name: 'My Segmentation',
    members: [],
    sourceIdentity: null,
    approval: { approved: false, reviewerName: null, reviewedAt: null, history: [] },
    dirty: false,
    saveInFlight: false,
    versionToken: null,
    parseError: null,
    a2cOptedIn: false,
    ...partial,
  };
}

function setContainers(...containers: Container[]): void {
  const map = new Map<string, Container>();
  for (const c of containers) map.set(c.id, c);
  useContainerStore.getState()._replaceAll(map);
}

beforeEach(() => {
  useContainerStore.getState()._replaceAll(new Map());
  useContainerSelectionStore.getState().setActive(null);
  useContainerSelectionStore.getState().clearSelection();
  useTransportStore.getState().clear();
  resetVisibilityAdapter();
  setMemberVisibilityMock.mockReset();
  setMemberLockMock.mockReset();
  setActiveMemberMock.mockReset();
  renameMemberMock.mockReset();
  renameContainerMock.mockReset();
  reorderMemberMock.mockReset();
  recolorMemberMock.mockReset();
  deleteMemberMock.mockReset();
  deleteContainerMock.mockReset();
  setA2cOptedInMock.mockReset();
  approveContainerMock.mockReset();
  revokeApprovalMock.mockReset();
  setRoiTypeMock.mockReset();
  saveContainerMock.mockReset().mockResolvedValue(undefined);
  revertContainerMock.mockReset().mockResolvedValue(undefined);
  exportContainerMock.mockReset().mockResolvedValue(null);
  uploadContainerToXnatMock.mockReset().mockResolvedValue('saved');
  saveAllDirtyMock.mockReset().mockResolvedValue(undefined);
  setAllMembersVisibilityMock.mockReset().mockReturnValue(0);
  setAllMembersLockMock.mockReset().mockReturnValue(0);
  createNewSegmentationMock.mockReset().mockResolvedValue('seg_new_1');
  createNewStructureMock.mockReset().mockResolvedValue('struct_new_1');
});

afterEach(() => {
  useContainerStore.getState()._replaceAll(new Map());
  useContainerSelectionStore.getState().setActive(null);
  useContainerSelectionStore.getState().clearSelection();
  useTransportStore.getState().clear();
  resetVisibilityAdapter();
});

describe('empty state', () => {
  it('shows the empty-state message when no containers', () => {
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('container-panel-empty')).not.toBeNull();
    expect(screen.queryByTestId('container-count')?.textContent).toMatch(/^0 total/);
  });
});

describe('container row rendering', () => {
  it('renders a row for each container with name + kind badge', () => {
    setContainers(
      makeContainer({ id: 'c1', name: 'PTV Set', kind: 'RTSTRUCT' }),
      makeContainer({ id: 'c2', name: 'Tumor SEG', kind: 'SEG' }),
    );
    render(<ContainerListPanel />);

    expect(screen.queryByTestId('container-row:c1')).not.toBeNull();
    expect(screen.queryByTestId('container-row:c2')).not.toBeNull();
    expect(screen.queryByTestId('container-count')?.textContent).toMatch(/^2 total/);
    expect(screen.queryByTestId('container-row:c1')?.textContent).toContain('PTV Set');
    expect(screen.queryByTestId('container-row:c1')?.textContent).toContain('RTSTRUCT');
  });

  it('shows the dirty marker only when the container is dirty', () => {
    setContainers(
      makeContainer({ id: 'c1', dirty: true }),
      makeContainer({ id: 'c2', dirty: false }),
    );
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('container-dirty:c1')).not.toBeNull();
    expect(screen.queryByTestId('container-dirty:c2')).toBeNull();
  });

  it('shows the approved badge only when the container is approved', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        approval: { approved: true, reviewerName: 'dr.smith', reviewedAt: 0, history: [] },
      }),
      makeContainer({ id: 'c2' }),
    );
    render(<ContainerListPanel />);
    const approved = screen.queryByTestId('container-approved:c1');
    expect(approved).not.toBeNull();
    expect(approved?.getAttribute('title')).toContain('dr.smith');
    expect(screen.queryByTestId('container-approved:c2')).toBeNull();
  });

  it('expand/collapse hides member rows when collapsed (D7.1)', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1', name: 'Tumor' })],
      }),
    );
    render(<ContainerListPanel />);
    // Default expanded.
    expect(screen.queryByTestId('member-row:m1')).not.toBeNull();
    const toggle = screen.getByTestId('container-toggle:c1');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    // Collapse — member rows go away.
    fireEvent.click(toggle);
    expect(screen.queryByTestId('member-row:m1')).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    // Re-expand.
    fireEvent.click(toggle);
    expect(screen.queryByTestId('member-row:m1')).not.toBeNull();
  });
});

describe('member row rendering', () => {
  it('renders a row for each member with color swatch + name', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [
          makeMember({ id: 'm1', name: 'Tumor', color: [255, 0, 0] }),
          makeMember({ id: 'm2', name: 'Edema', color: [0, 255, 0], segmentIndex: 2 }),
        ],
      }),
    );
    render(<ContainerListPanel />);

    expect(screen.queryByTestId('member-row:m1')?.textContent).toContain('Tumor');
    expect(screen.queryByTestId('member-row:m2')?.textContent).toContain('Edema');

    const swatch = screen.queryByTestId('member-color:m1');
    expect(swatch?.getAttribute('style')).toContain('rgb(255, 0, 0)');
  });

  it('shows the locked indicator for locked members', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [
          makeMember({ id: 'm1', locked: true }),
          makeMember({ id: 'm2', locked: false }),
        ],
      }),
    );
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('member-locked:m1')).not.toBeNull();
    expect(screen.queryByTestId('member-locked:m2')).toBeNull();
    // Unlocked members surface a hover-only toggle (D7.2/C5).
    expect(screen.queryByTestId('member-lock-toggle:m2')).not.toBeNull();
  });

  it('clicking the lock toggle calls setMemberLock', () => {
    setMemberLockMock.mockReset();
    setContainers(
      makeContainer({
        id: 'c1',
        members: [
          makeMember({ id: 'm-locked', locked: true }),
          makeMember({ id: 'm-unlocked', locked: false }),
        ],
      }),
    );
    render(<ContainerListPanel />);
    fireEvent.click(screen.getByTestId('member-locked:m-locked'));
    expect(setMemberLockMock).toHaveBeenCalledWith('m-locked', false);
    fireEvent.click(screen.getByTestId('member-lock-toggle:m-unlocked'));
    expect(setMemberLockMock).toHaveBeenCalledWith('m-unlocked', true);
  });

  it('lock toggle is hidden on approved containers (read-only indicator instead)', () => {
    setMemberLockMock.mockReset();
    setContainers(
      makeContainer({
        id: 'c1',
        approval: {
          approved: true,
          reviewerName: 'Dr. Smith',
          reviewedAt: 1,
          history: [],
        },
        members: [
          makeMember({ id: 'm1', locked: true }),
          makeMember({ id: 'm2', locked: false }),
        ],
      }),
    );
    render(<ContainerListPanel />);
    // m1 still shows the icon (read-only) — matches "container approved" state.
    expect(screen.queryByTestId('member-locked:m1')).not.toBeNull();
    expect(screen.queryByTestId('member-locked:m1')?.tagName).toBe('SPAN');
    // m2 is unlocked but on an approved container — no toggle, no indicator.
    expect(screen.queryByTestId('member-locked:m2')).toBeNull();
    expect(screen.queryByTestId('member-lock-toggle:m2')).toBeNull();
  });

  it('renders different visibility-mode glyphs for hidden / outlined / filled', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [
          makeMember({ id: 'm-hidden', visibility: 'hidden' }),
          makeMember({ id: 'm-outlined', visibility: 'outlined' }),
          makeMember({ id: 'm-filled', visibility: 'filled' }),
        ],
      }),
    );
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('member-row:m-hidden')?.textContent).toContain('○');
    expect(screen.queryByTestId('member-row:m-outlined')?.textContent).toContain('◐');
    expect(screen.queryByTestId('member-row:m-filled')?.textContent).toContain('●');
  });

  it('shows the (empty) placeholder for containers with no members', () => {
    setContainers(makeContainer({ id: 'c1', members: [] }));
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('container-no-members:c1')).not.toBeNull();
    expect(screen.queryByTestId('container-no-members:c1')?.textContent).toBe('(empty)');
  });

  it('does not render the (empty) placeholder when members exist', () => {
    setContainers(
      makeContainer({ id: 'c1', members: [makeMember({ id: 'm1' })] }),
    );
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('container-no-members:c1')).toBeNull();
  });
});

describe('reactive updates', () => {
  it('re-renders when the store updates', () => {
    const { rerender } = render(<ContainerListPanel />);
    expect(screen.queryByTestId('container-panel-empty')).not.toBeNull();

    setContainers(makeContainer({ id: 'c1' }));
    rerender(<ContainerListPanel />);
    expect(screen.queryByTestId('container-row:c1')).not.toBeNull();
    expect(screen.queryByTestId('container-panel-empty')).toBeNull();
  });
});

describe('kind badge color', () => {
  it('uses different text colors for SEG / RTSTRUCT / POI', () => {
    setContainers(
      makeContainer({ id: 'c1', kind: 'SEG' }),
      makeContainer({ id: 'c2', kind: 'RTSTRUCT' }),
      makeContainer({ id: 'c3', kind: 'POI' }),
    );
    render(<ContainerListPanel />);
    // The kind badge is the first <span> inside the container row.
    const segRow = screen.queryByTestId('container-row:c1')!;
    const rtRow = screen.queryByTestId('container-row:c2')!;
    const poiRow = screen.queryByTestId('container-row:c3')!;

    expect(segRow.querySelector('span')?.className).toContain('text-cyan-400');
    expect(rtRow.querySelector('span')?.className).toContain('text-violet-400');
    expect(poiRow.querySelector('span')?.className).toContain('text-amber-400');
  });
});

// ─── Phase 3.4: visibility-mode click cycling ──────────────────────────

describe('visibility-mode click cycling', () => {
  it('clicking the visibility glyph calls setMemberVisibility with the next mode', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1', visibility: 'filled' })],
      }),
    );
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.click(screen.getByTestId('member-visibility:m1'));
    });
    expect(setMemberVisibilityMock).toHaveBeenCalledWith('m1', 'outlined');
  });

  it('cycle goes filled → outlined → hidden → filled', () => {
    const cases: Array<['filled' | 'outlined' | 'hidden', 'filled' | 'outlined' | 'hidden']> = [
      ['filled', 'outlined'],
      ['outlined', 'hidden'],
      ['hidden', 'filled'],
    ];
    for (const [from, to] of cases) {
      setMemberVisibilityMock.mockReset();
      setContainers(
        makeContainer({
          id: 'c1',
          members: [makeMember({ id: 'm1', visibility: from })],
        }),
      );
      const { unmount } = render(<ContainerListPanel />);
      act(() => {
        fireEvent.click(screen.getByTestId('member-visibility:m1'));
      });
      expect(setMemberVisibilityMock).toHaveBeenCalledWith('m1', to);
      unmount();
    }
  });

  it('the click does not bubble to the row (event.stopPropagation)', () => {
    // Future: when row click selects, the visibility click should NOT
    // also select. Currently the row has no click handler, so we verify
    // stopPropagation is wired by ensuring only the visibility call was
    // made (no other side effects we can observe yet — this test guards
    // the wiring for Phase 3.5).
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1', visibility: 'filled' })],
      }),
    );
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.click(screen.getByTestId('member-visibility:m1'));
    });
    expect(setMemberVisibilityMock).toHaveBeenCalledTimes(1);
  });

  it('button is accessible — has aria-label and title with current mode', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1', visibility: 'outlined' })],
      }),
    );
    render(<ContainerListPanel />);
    const btn = screen.getByTestId('member-visibility:m1');
    expect(btn.getAttribute('aria-label')).toBe('visibility outlined');
    expect(btn.getAttribute('title')).toContain('outlined');
  });
});

// ─── Phase 3.5a: selection vs active model ─────────────────────────────

describe('selection vs active (D7.5)', () => {
  it('single-click on a row replaces the selection with that member', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [
          makeMember({ id: 'm1' }),
          makeMember({ id: 'm2', segmentIndex: 2 }),
        ],
      }),
    );
    render(<ContainerListPanel />);

    act(() => {
      fireEvent.click(screen.getByTestId('member-row:m1'));
    });
    expect(useContainerSelectionStore.getState().selectionSet).toEqual(new Set(['m1']));

    act(() => {
      fireEvent.click(screen.getByTestId('member-row:m2'));
    });
    expect(useContainerSelectionStore.getState().selectionSet).toEqual(new Set(['m2']));
  });

  it('shift-click toggles a member in the selection set', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [
          makeMember({ id: 'm1' }),
          makeMember({ id: 'm2', segmentIndex: 2 }),
        ],
      }),
    );
    render(<ContainerListPanel />);

    act(() => {
      fireEvent.click(screen.getByTestId('member-row:m1'));
    });
    act(() => {
      fireEvent.click(screen.getByTestId('member-row:m2'), { shiftKey: true });
    });
    expect(useContainerSelectionStore.getState().selectionSet).toEqual(new Set(['m1', 'm2']));

    act(() => {
      fireEvent.click(screen.getByTestId('member-row:m1'), { ctrlKey: true });
    });
    expect(useContainerSelectionStore.getState().selectionSet).toEqual(new Set(['m2']));
  });

  it('color-swatch click opens the color picker popover (spec §4.5)', () => {
    // Behavior change for MV-Phase 7.3b: the swatch no longer activates
    // the member; it opens an inline color picker popover with presets.
    setContainers(
      makeContainer({
        id: 'c1',
        members: [
          makeMember({ id: 'm1' }),
          makeMember({ id: 'm2', segmentIndex: 2 }),
        ],
      }),
    );
    render(<ContainerListPanel />);

    // Pre-select m1 via row click.
    act(() => {
      fireEvent.click(screen.getByTestId('member-row:m1'));
    });
    expect(useContainerSelectionStore.getState().selectionSet).toEqual(new Set(['m1']));

    // Click m2's color swatch — opens the picker; does NOT activate or
    // change selection.
    expect(screen.queryByTestId('member-color-picker:m2')).toBeNull();
    act(() => {
      fireEvent.click(screen.getByTestId('member-color:m2'));
    });
    expect(screen.queryByTestId('member-color-picker:m2')).not.toBeNull();
    expect(setActiveMemberMock).not.toHaveBeenCalled();
    expect(useContainerSelectionStore.getState().selectionSet).toEqual(new Set(['m1']));
  });

  it('renders the selected-row styling (bg-blue-900/30 border-blue-500)', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1' })],
      }),
    );
    render(<ContainerListPanel />);
    act(() => {
      useContainerSelectionStore.getState().setSelection('m1');
    });
    const row = screen.getByTestId('member-row:m1');
    expect(row.className).toMatch(/bg-blue-900/);
    expect(row.dataset.selected).toBe('true');
  });

  it('renders the active-member styling (amber color swatch ring)', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1' })],
      }),
    );
    render(<ContainerListPanel />);
    act(() => {
      useContainerSelectionStore.getState().setActive('m1');
    });
    const swatch = screen.getByTestId('member-color:m1');
    expect(swatch.className).toMatch(/ring-amber-300/);
    expect(screen.getByTestId('member-row:m1').dataset.active).toBe('true');
  });

  it('visibility click does NOT bubble into row selection', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1', visibility: 'filled' })],
      }),
    );
    render(<ContainerListPanel />);

    act(() => {
      fireEvent.click(screen.getByTestId('member-visibility:m1'));
    });
    expect(setMemberVisibilityMock).toHaveBeenCalledWith('m1', 'outlined');
    // Selection set should remain empty (row click was prevented).
    expect(useContainerSelectionStore.getState().selectionSet.size).toBe(0);
  });
});

// ─── Phase 3.5b: row hover wiring ──────────────────────────────────────

describe('row hover (D7.8 row-side)', () => {
  it('mouseEnter on a row sets hoverMemberId in the selection store', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1' })],
      }),
    );
    render(<ContainerListPanel />);

    act(() => {
      fireEvent.mouseEnter(screen.getByTestId('member-row:m1'));
    });
    expect(useContainerSelectionStore.getState().hoverMemberId).toBe('m1');
  });

  it('mouseLeave clears hoverMemberId', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1' })],
      }),
    );
    render(<ContainerListPanel />);

    act(() => {
      fireEvent.mouseEnter(screen.getByTestId('member-row:m1'));
      fireEvent.mouseLeave(screen.getByTestId('member-row:m1'));
    });
    expect(useContainerSelectionStore.getState().hoverMemberId).toBeNull();
  });

  it('hovered row gets the data-hovered attribute', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1' })],
      }),
    );
    render(<ContainerListPanel />);
    act(() => {
      useContainerSelectionStore.getState().setHover('m1');
    });
    expect(screen.getByTestId('member-row:m1').dataset.hovered).toBe('true');
  });

  it('hovered row does not show the hover styling when also selected (selection wins)', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1' })],
      }),
    );
    render(<ContainerListPanel />);
    act(() => {
      useContainerSelectionStore.getState().setSelection('m1');
      useContainerSelectionStore.getState().setHover('m1');
    });
    const row = screen.getByTestId('member-row:m1');
    // bg-blue-900 is the selected styling; should be present even when
    // hovered. The hover-specific bg-zinc-800/60 should NOT be present.
    expect(row.className).toMatch(/bg-blue-900/);
    expect(row.className).not.toMatch(/bg-zinc-800\/60/);
  });
});

// ─── MV-Phase 7.3b: direct affordances replace the ⋯ menu (spec §4.5) ──

describe('inline rename via double-click (spec §4.5)', () => {
  it('double-clicking the name swaps in an input pre-filled with the current name', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1', name: 'Tumor' })],
      }),
    );
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.doubleClick(screen.getByTestId('member-name:m1'));
    });
    const input = screen.getByTestId('member-rename:m1') as HTMLInputElement;
    expect(input.value).toBe('Tumor');
  });

  it('Enter submits the rename via containerService.renameMember', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1', name: 'Tumor' })],
      }),
    );
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.doubleClick(screen.getByTestId('member-name:m1'));
    });
    const input = screen.getByTestId('member-rename:m1');
    act(() => {
      fireEvent.change(input, { target: { value: 'Renamed' } });
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(renameMemberMock).toHaveBeenCalledWith('m1', 'Renamed');
  });

  it('Escape cancels without calling renameMember', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1', name: 'Tumor' })],
      }),
    );
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.doubleClick(screen.getByTestId('member-name:m1'));
    });
    const input = screen.getByTestId('member-rename:m1');
    act(() => {
      fireEvent.change(input, { target: { value: 'NewName' } });
      fireEvent.keyDown(input, { key: 'Escape' });
    });
    expect(renameMemberMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('member-rename:m1')).toBeNull();
  });

  it('blank rename does not call renameMember', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1', name: 'Tumor' })],
      }),
    );
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.doubleClick(screen.getByTestId('member-name:m1'));
    });
    act(() => {
      fireEvent.change(screen.getByTestId('member-rename:m1'), { target: { value: '   ' } });
      fireEvent.keyDown(screen.getByTestId('member-rename:m1'), { key: 'Enter' });
    });
    expect(renameMemberMock).not.toHaveBeenCalled();
  });

  it('same-name rename is a no-op', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1', name: 'Tumor' })],
      }),
    );
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.doubleClick(screen.getByTestId('member-name:m1'));
    });
    act(() => {
      fireEvent.keyDown(screen.getByTestId('member-rename:m1'), { key: 'Enter' });
    });
    expect(renameMemberMock).not.toHaveBeenCalled();
  });

  it('input click does not bubble to the row', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1' })],
      }),
    );
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.doubleClick(screen.getByTestId('member-name:m1'));
    });
    act(() => {
      fireEvent.click(screen.getByTestId('member-rename:m1'));
    });
    expect(useContainerSelectionStore.getState().selectionSet.size).toBe(0);
  });
});

describe('inline delete (spec §4.5)', () => {
  it('clicking ✕ calls deleteMember directly (no confirmation)', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1', name: 'Tumor' })],
      }),
    );
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.click(screen.getByTestId('member-delete:m1'));
    });
    expect(deleteMemberMock).toHaveBeenCalledWith('m1');
  });

  it('approved containers hide the ✕ delete button', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        approval: { approved: true, reviewerName: null, reviewedAt: 0, history: [] },
        members: [makeMember({ id: 'm1' })],
      }),
    );
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('member-delete:m1')).toBeNull();
  });

  it('the legacy ⋯ action menu has been removed', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1' })],
      }),
    );
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('member-menu:m1')).toBeNull();
  });
});

// ─── Phase 3.7a: filter by member name (D7.7) ──────────────────────────

describe('filter / search (D7.7)', () => {
  it('filter input is hidden when no containers exist', () => {
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('container-filter')).toBeNull();
  });

  it('filter input appears when at least one container exists', () => {
    setContainers(makeContainer({ id: 'c1', members: [makeMember({ id: 'm1' })] }));
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('container-filter')).not.toBeNull();
  });

  it('typing a filter narrows visible members by name (case-insensitive substring)', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [
          makeMember({ id: 'm1', name: 'GTV' }),
          makeMember({ id: 'm2', name: 'CTV', segmentIndex: 2 }),
          makeMember({ id: 'm3', name: 'PTV', segmentIndex: 3 }),
          makeMember({ id: 'm4', name: 'Brain', segmentIndex: 4 }),
        ],
      }),
    );
    render(<ContainerListPanel />);

    act(() => {
      fireEvent.change(screen.getByTestId('container-filter'), { target: { value: 'tv' } });
    });
    expect(screen.queryByTestId('member-row:m1')).not.toBeNull();
    expect(screen.queryByTestId('member-row:m2')).not.toBeNull();
    expect(screen.queryByTestId('member-row:m3')).not.toBeNull();
    expect(screen.queryByTestId('member-row:m4')).toBeNull();
  });

  it('hides containers whose members all fail the filter', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1', name: 'Tumor' })],
      }),
      makeContainer({
        id: 'c2',
        members: [makeMember({ id: 'm2', name: 'Edema' })],
      }),
    );
    render(<ContainerListPanel />);

    act(() => {
      fireEvent.change(screen.getByTestId('container-filter'), { target: { value: 'tumor' } });
    });
    expect(screen.queryByTestId('container-row:c1')).not.toBeNull();
    expect(screen.queryByTestId('container-row:c2')).toBeNull();
  });

  it('shows the no-matches placeholder when filter matches nothing', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1', name: 'Tumor' })],
      }),
    );
    render(<ContainerListPanel />);

    act(() => {
      fireEvent.change(screen.getByTestId('container-filter'), { target: { value: 'nonexistent' } });
    });
    expect(screen.queryByTestId('container-panel-no-matches')).not.toBeNull();
    expect(screen.queryByTestId('container-row:c1')).toBeNull();
  });

  it('clear button resets the filter', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [
          makeMember({ id: 'm1', name: 'Tumor' }),
          makeMember({ id: 'm2', name: 'Edema', segmentIndex: 2 }),
        ],
      }),
    );
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.change(screen.getByTestId('container-filter'), { target: { value: 'tumor' } });
    });
    expect(screen.queryByTestId('member-row:m2')).toBeNull();

    act(() => {
      fireEvent.click(screen.getByTestId('container-filter-clear'));
    });
    expect(screen.queryByTestId('member-row:m1')).not.toBeNull();
    expect(screen.queryByTestId('member-row:m2')).not.toBeNull();
  });

  it('clear button is hidden when filter is empty', () => {
    setContainers(makeContainer({ id: 'c1', members: [makeMember({ id: 'm1' })] }));
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('container-filter-clear')).toBeNull();
  });

  it('whitespace-only filter is treated as empty', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1', name: 'Tumor' })],
      }),
    );
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.change(screen.getByTestId('container-filter'), { target: { value: '   ' } });
    });
    expect(screen.queryByTestId('member-row:m1')).not.toBeNull();
  });

  it('filter does not mutate visibility / lock state of hidden-by-filter members', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [
          makeMember({ id: 'm1', name: 'Tumor', visibility: 'filled', locked: true }),
          makeMember({ id: 'm2', name: 'Edema', visibility: 'hidden', locked: false, segmentIndex: 2 }),
        ],
      }),
    );
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.change(screen.getByTestId('container-filter'), { target: { value: 'tumor' } });
    });
    // The container store hasn't been mutated — filter is purely a display
    // concern (filter state is local panel state).
    const c = useContainerStore.getState().containers.get('c1')!;
    expect(c.members.find((m) => m.id === 'm1')?.visibility).toBe('filled');
    expect(c.members.find((m) => m.id === 'm1')?.locked).toBe(true);
    expect(c.members.find((m) => m.id === 'm2')?.visibility).toBe('hidden');
  });
});

// ─── Phase 3.7b: A2c per-container opt-in toggle ───────────────────────

describe('A2c per-container opt-in toggle (§A2c, §D11)', () => {
  it('renders an A2c button per container row', () => {
    setContainers(makeContainer({ id: 'c1' }));
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('container-a2c-toggle:c1')).not.toBeNull();
  });

  it('reflects the off state when a2cOptedIn is false', () => {
    setContainers(makeContainer({ id: 'c1', a2cOptedIn: false }));
    render(<ContainerListPanel />);
    const btn = screen.getByTestId('container-a2c-toggle:c1');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.getAttribute('aria-label')).toContain('off');
  });

  it('reflects the on state when a2cOptedIn is true', () => {
    setContainers(makeContainer({ id: 'c1', a2cOptedIn: true }));
    render(<ContainerListPanel />);
    const btn = screen.getByTestId('container-a2c-toggle:c1');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.getAttribute('aria-label')).toContain('on');
    expect(btn.className).toMatch(/orange/);
  });

  it('clicking the toggle calls setA2cOptedIn with the inverted value', () => {
    setContainers(makeContainer({ id: 'c1', a2cOptedIn: false }));
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.click(screen.getByTestId('container-a2c-toggle:c1'));
    });
    expect(setA2cOptedInMock).toHaveBeenCalledWith('c1', true);
  });

  it('toggle off → on inverts correctly when starting from on', () => {
    setContainers(makeContainer({ id: 'c1', a2cOptedIn: true }));
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.click(screen.getByTestId('container-a2c-toggle:c1'));
    });
    expect(setA2cOptedInMock).toHaveBeenCalledWith('c1', false);
  });
});

// ─── Phase 3.7c: sort options ──────────────────────────────────────────

describe('sort (D7.7)', () => {
  function rowOrder(): string[] {
    const rows = document.querySelectorAll('[data-testid^="member-row:"]');
    return Array.from(rows).map((r) => r.getAttribute('data-testid')!.replace('member-row:', ''));
  }

  it('default order keeps the bridge order (creation order = segmentIndex)', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [
          makeMember({ id: 'm1', name: 'Tumor', segmentIndex: 1 }),
          makeMember({ id: 'm3', name: 'Apple', segmentIndex: 3 }),
          makeMember({ id: 'm2', name: 'Brain', segmentIndex: 2 }),
        ],
      }),
    );
    render(<ContainerListPanel />);
    expect(rowOrder()).toEqual(['m1', 'm3', 'm2']);
  });

  it('alphabetical sort orders members by name', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [
          makeMember({ id: 'm1', name: 'Tumor', segmentIndex: 1 }),
          makeMember({ id: 'm2', name: 'Apple', segmentIndex: 2 }),
          makeMember({ id: 'm3', name: 'Brain', segmentIndex: 3 }),
        ],
      }),
    );
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.change(screen.getByTestId('container-sort'), { target: { value: 'alphabetical' } });
    });
    expect(rowOrder()).toEqual(['m2', 'm3', 'm1']);
  });

  it('segmentIndex sort orders members by index ascending', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [
          makeMember({ id: 'm1', name: 'A', segmentIndex: 5 }),
          makeMember({ id: 'm2', name: 'B', segmentIndex: 1 }),
          makeMember({ id: 'm3', name: 'C', segmentIndex: 3 }),
        ],
      }),
    );
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.change(screen.getByTestId('container-sort'), { target: { value: 'segmentIndex' } });
    });
    expect(rowOrder()).toEqual(['m2', 'm3', 'm1']);
  });

  it('sort dropdown is hidden when no containers exist', () => {
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('container-sort')).toBeNull();
  });

  it('sort does not mutate the persisted Container.members order', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [
          makeMember({ id: 'm1', name: 'Z', segmentIndex: 1 }),
          makeMember({ id: 'm2', name: 'A', segmentIndex: 2 }),
        ],
      }),
    );
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.change(screen.getByTestId('container-sort'), { target: { value: 'alphabetical' } });
    });
    // Bridge order unchanged.
    const c = useContainerStore.getState().containers.get('c1')!;
    expect(c.members.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('sort applies independently within each container', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [
          makeMember({ id: 'm1', name: 'Z', segmentIndex: 1 }),
          makeMember({ id: 'm2', name: 'A', segmentIndex: 2 }),
        ],
      }),
      makeContainer({
        id: 'c2',
        members: [
          makeMember({ id: 'm3', name: 'M', segmentIndex: 1 }),
          makeMember({ id: 'm4', name: 'B', segmentIndex: 2 }),
        ],
      }),
    );
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.change(screen.getByTestId('container-sort'), { target: { value: 'alphabetical' } });
    });
    // Both containers are alphabetized, but their members stay segregated.
    expect(rowOrder()).toEqual(['m2', 'm1', 'm4', 'm3']);
  });

  it('sort + filter compose: filter narrows, sort orders the survivors', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [
          makeMember({ id: 'm1', name: 'Tumor large', segmentIndex: 1 }),
          makeMember({ id: 'm2', name: 'Tumor small', segmentIndex: 2 }),
          makeMember({ id: 'm3', name: 'Brain', segmentIndex: 3 }),
        ],
      }),
    );
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.change(screen.getByTestId('container-filter'), { target: { value: 'tumor' } });
    });
    act(() => {
      fireEvent.change(screen.getByTestId('container-sort'), { target: { value: 'alphabetical' } });
    });
    expect(rowOrder()).toEqual(['m1', 'm2']);
  });
});

// ─── Phase 3.8a: approval workflow UI (D7.11) ──────────────────────────

describe('approval workflow (D7.11)', () => {
  let originalConfirm: typeof window.confirm;
  beforeEach(() => {
    originalConfirm = window.confirm;
  });
  afterEach(() => {
    window.confirm = originalConfirm;
  });

  it('not approved → Approve button visible, Revoke + badge hidden', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        approval: { approved: false, reviewerName: null, reviewedAt: null, history: [] },
      }),
    );
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('container-approve:c1')).not.toBeNull();
    expect(screen.queryByTestId('container-revoke:c1')).toBeNull();
    expect(screen.queryByTestId('container-approved:c1')).toBeNull();
  });

  it('approved → Revoke + badge visible, Approve hidden', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        approval: { approved: true, reviewerName: 'dr.smith', reviewedAt: 0, history: [] },
      }),
    );
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('container-approve:c1')).toBeNull();
    expect(screen.queryByTestId('container-revoke:c1')).not.toBeNull();
    expect(screen.queryByTestId('container-approved:c1')?.textContent).toContain('approved');
  });

  it('clicking Approve calls containerService.approveContainer', () => {
    setContainers(makeContainer({ id: 'c1' }));
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.click(screen.getByTestId('container-approve:c1'));
    });
    expect(approveContainerMock).toHaveBeenCalledWith('c1', null);
  });

  it('clicking Revoke prompts confirm before calling revokeApproval', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        approval: { approved: true, reviewerName: 'a', reviewedAt: 0, history: [] },
      }),
    );
    window.confirm = vi.fn().mockReturnValue(true);
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.click(screen.getByTestId('container-revoke:c1'));
    });
    expect(window.confirm).toHaveBeenCalled();
    expect(revokeApprovalMock).toHaveBeenCalledWith('c1', null);
  });

  it('cancelled Revoke does NOT call revokeApproval', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        approval: { approved: true, reviewerName: 'a', reviewedAt: 0, history: [] },
      }),
    );
    window.confirm = vi.fn().mockReturnValue(false);
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.click(screen.getByTestId('container-revoke:c1'));
    });
    expect(revokeApprovalMock).not.toHaveBeenCalled();
  });

  it('approved container hides the inline ✕ delete affordance (edit-locked per §D7.11)', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        approval: { approved: true, reviewerName: 'a', reviewedAt: 0, history: [] },
        members: [makeMember({ id: 'm1' })],
      }),
    );
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('member-delete:m1')).toBeNull();
  });

  it('un-approved container shows the inline ✕ delete affordance', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        approval: { approved: false, reviewerName: null, reviewedAt: null, history: [] },
        members: [makeMember({ id: 'm1' })],
      }),
    );
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('member-delete:m1')).not.toBeNull();
  });

  it('Approve / Revoke clicks do not bubble to the row click handler', () => {
    setContainers(makeContainer({ id: 'c1' }));
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.click(screen.getByTestId('container-approve:c1'));
    });
    expect(useContainerSelectionStore.getState().selectionSet.size).toBe(0);
  });
});

// ─── Phase 3.8b: ROI type badge + provenance indicator (D7.2) ──────────

describe('ROI type badge (D7.2 RTSTRUCT)', () => {
  it('renders the editable select for un-approved RTSTRUCT members', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        kind: 'RTSTRUCT',
        members: [makeMember({ id: 'm1', roiType: 'GTV' })],
      }),
    );
    render(<ContainerListPanel />);
    const select = screen.queryByTestId('member-roi-type-select:m1') as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    expect(select?.value).toBe('GTV');
  });

  it('renders the read-only badge when the container is approved (edit-locked)', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        kind: 'RTSTRUCT',
        approval: { approved: true, reviewerName: 'a', reviewedAt: 0, history: [] },
        members: [makeMember({ id: 'm1', roiType: 'GTV' })],
      }),
    );
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('member-roi-type:m1')?.textContent).toBe('GTV');
    expect(screen.queryByTestId('member-roi-type-select:m1')).toBeNull();
  });

  it('hides the read-only badge when roiType is null and not RTSTRUCT', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        kind: 'SEG',
        members: [makeMember({ id: 'm1', roiType: null })],
      }),
    );
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('member-roi-type:m1')).toBeNull();
    expect(screen.queryByTestId('member-roi-type-select:m1')).toBeNull();
  });

  it('GTV / CTV / PTV / ORGAN / EXTERNAL / AVOIDANCE select carries distinct color hints', () => {
    const types: Array<['GTV' | 'CTV' | 'PTV' | 'ORGAN' | 'EXTERNAL' | 'AVOIDANCE', RegExp]> = [
      ['GTV', /rose/],
      ['CTV', /orange/],
      ['PTV', /amber/],
      ['ORGAN', /emerald/],
      ['EXTERNAL', /blue/],
      ['AVOIDANCE', /red/],
    ];
    for (const [type, color] of types) {
      setContainers(
        makeContainer({
          id: 'c1',
          kind: 'RTSTRUCT',
          members: [makeMember({ id: `m-${type}`, roiType: type })],
        }),
      );
      const { unmount } = render(<ContainerListPanel />);
      const select = screen.queryByTestId(`member-roi-type-select:m-${type}`);
      expect(select?.className).toMatch(color);
      unmount();
    }
  });
});

describe('inline ROI type editor (D7.2 / signal 18)', () => {
  it('changing the select calls containerService.setRoiType', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        kind: 'RTSTRUCT',
        members: [makeMember({ id: 'm1', roiType: 'GTV' })],
      }),
    );
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.change(screen.getByTestId('member-roi-type-select:m1'), {
        target: { value: 'CTV' },
      });
    });
    expect(setRoiTypeMock).toHaveBeenCalledWith('m1', 'CTV');
  });

  it('opening the dropdown does not bubble to row selection', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        kind: 'RTSTRUCT',
        members: [makeMember({ id: 'm1', roiType: 'GTV' })],
      }),
    );
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.click(screen.getByTestId('member-roi-type-select:m1'));
    });
    expect(useContainerSelectionStore.getState().selectionSet.size).toBe(0);
  });

  it('exposes all standard RTROIInterpretedType options', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        kind: 'RTSTRUCT',
        members: [makeMember({ id: 'm1', roiType: 'GTV' })],
      }),
    );
    render(<ContainerListPanel />);
    const select = screen.getByTestId('member-roi-type-select:m1') as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    // Spot-check: the headline radiotherapy types are present.
    expect(optionValues).toEqual(expect.arrayContaining(['GTV', 'CTV', 'PTV', 'ORGAN', 'EXTERNAL', 'AVOIDANCE']));
  });

  it('null roiType renders the empty placeholder option', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        kind: 'RTSTRUCT',
        members: [makeMember({ id: 'm1', roiType: null })],
      }),
    );
    render(<ContainerListPanel />);
    const select = screen.getByTestId('member-roi-type-select:m1') as HTMLSelectElement;
    expect(select.value).toBe('');
  });

  it('SEG containers do not get the editor (only RTSTRUCT)', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        kind: 'SEG',
        members: [makeMember({ id: 'm1' })],
      }),
    );
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('member-roi-type-select:m1')).toBeNull();
  });
});

describe('provenance indicator (D7.2)', () => {
  it('manual provenance does not render an indicator', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1', provenance: 'manual' })],
      }),
    );
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('member-provenance:m1')).toBeNull();
  });

  it('interpolated provenance renders ~', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1', provenance: 'interpolated' })],
      }),
    );
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('member-provenance:m1')?.textContent).toBe('~');
  });

  it('imported provenance renders ↓', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1', provenance: 'imported' })],
      }),
    );
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('member-provenance:m1')?.textContent).toBe('↓');
  });

  it('auto-segmented renders AI', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1', provenance: 'auto-segmented' })],
      }),
    );
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('member-provenance:m1')?.textContent).toBe('AI');
  });
});

// ─── Phase 3.8 cleanup: D7.4 / D7.9 indicators ────────────────────────

describe('container row transport indicators (D7.4 / D7.9)', () => {
  it('renders the load-in-flight spinner when transport is loading', () => {
    setContainers(makeContainer({ id: 'c1' }));
    act(() => useTransportStore.getState().beginLoad('c1'));
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('container-load-inflight:c1')).not.toBeNull();
  });

  it('renders save-in-flight spinner when saving (not loading)', () => {
    setContainers(makeContainer({ id: 'c1' }));
    act(() => useTransportStore.getState().beginSave('c1'));
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('container-save-inflight:c1')).not.toBeNull();
    expect(screen.queryByTestId('container-load-inflight:c1')).toBeNull();
  });

  it('renders parse-error indicator when Container.parseError is set', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        parseError: { message: 'Bad SEG header', at: 0 },
      }),
    );
    render(<ContainerListPanel />);
    const badge = screen.queryByTestId('container-parse-error:c1');
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute('title')).toContain('Bad SEG header');
  });

  it('renders conflict indicator when externalChangePending', () => {
    setContainers(makeContainer({ id: 'c1' }));
    act(() => useTransportStore.getState().noteExternalChange('c1'));
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('container-conflict:c1')).not.toBeNull();
  });

  it('renders transient-error indicator when last save was a transient failure', () => {
    setContainers(makeContainer({ id: 'c1' }));
    act(() =>
      useTransportStore.getState().finishSaveTransientFailure('c1', {
        kind: 'transient',
        message: 'Network blip',
        at: Date.now(),
      }),
    );
    render(<ContainerListPanel />);
    const badge = screen.queryByTestId('container-transient-error:c1');
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute('title')).toContain('Network blip');
  });

  it('renders permanent-error indicator when last save was a permanent failure', () => {
    setContainers(makeContainer({ id: 'c1' }));
    act(() =>
      useTransportStore.getState().finishSavePermanentFailure('c1', {
        kind: 'permanent',
        message: 'Forbidden',
        at: Date.now(),
      }),
    );
    render(<ContainerListPanel />);
    const badge = screen.queryByTestId('container-permanent-error:c1');
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute('title')).toContain('Forbidden');
  });
});

describe('member row eligibility indicators (D7.4)', () => {
  function wireSourceIdentities(
    member: { seriesUID: string; foRUID: string; acq: number | null } | null,
    viewport: { seriesUID: string; foRUID: string; acq: number | null } | null,
  ) {
    wireVisibility({
      getViewportSourceIdentity: () =>
        viewport
          ? {
              seriesUID: viewport.seriesUID,
              frameOfReferenceUID: viewport.foRUID,
              acquisitionNumber: viewport.acq,
            }
          : null,
      getSegmentationSourceIdentity: () =>
        member
          ? {
              seriesUID: member.seriesUID,
              frameOfReferenceUID: member.foRUID,
              acquisitionNumber: member.acq,
            }
          : null,
      getAnnotationSourceIdentity: () =>
        member
          ? {
              seriesUID: member.seriesUID,
              frameOfReferenceUID: member.foRUID,
              acquisitionNumber: member.acq,
            }
          : null,
    });
  }

  it('does NOT render indicator on native (same series) members', () => {
    wireSourceIdentities(
      { seriesUID: 'sX', foRUID: 'forA', acq: 1 },
      { seriesUID: 'sX', foRUID: 'forA', acq: 1 },
    );
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1', csSegmentationId: 'seg_1' })],
      }),
    );
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('member-eligibility:m1')).toBeNull();
  });

  it('renders cross-series-A2b badge on different series, same FoR', () => {
    wireSourceIdentities(
      { seriesUID: 'sX', foRUID: 'forA', acq: 1 },
      { seriesUID: 'sY', foRUID: 'forA', acq: 1 },
    );
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1', csSegmentationId: 'seg_1' })],
      }),
    );
    render(<ContainerListPanel />);
    const badge = screen.queryByTestId('member-eligibility:m1');
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute('data-eligibility')).toBe('cross-series-A2b');
    expect(badge?.textContent).toContain('X-S');
  });

  it('renders cross-series-A2c badge when AcquisitionNumbers differ', () => {
    wireSourceIdentities(
      { seriesUID: 'sX', foRUID: 'forA', acq: 1 },
      { seriesUID: 'sY', foRUID: 'forA', acq: 2 },
    );
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1', csSegmentationId: 'seg_1' })],
      }),
    );
    render(<ContainerListPanel />);
    const badge = screen.queryByTestId('member-eligibility:m1');
    expect(badge?.getAttribute('data-eligibility')).toBe('cross-series-A2c');
    expect(badge?.textContent).toContain('A2c');
  });

  it('renders cross-FoR badge when FoR differs', () => {
    wireSourceIdentities(
      { seriesUID: 'sX', foRUID: 'forA', acq: 1 },
      { seriesUID: 'sY', foRUID: 'forB', acq: 1 },
    );
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1', csSegmentationId: 'seg_1' })],
      }),
    );
    render(<ContainerListPanel />);
    const badge = screen.queryByTestId('member-eligibility:m1');
    expect(badge?.getAttribute('data-eligibility')).toBe('cross-FoR');
    expect(badge?.textContent).toContain('FoR');
  });

  it('skips classification when adapter is not wired', () => {
    // resetVisibilityAdapter is in beforeEach — no wireSourceIdentities call.
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1', csSegmentationId: 'seg_1' })],
      }),
    );
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('member-eligibility:m1')).toBeNull();
  });
});

describe('member row auto-interpolated marker (D7.4 / B5)', () => {
  it('renders the marker when interpolationState is "has-interpolated"', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1', interpolationState: 'has-interpolated' })],
      }),
    );
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('member-auto-interpolated:m1')).not.toBeNull();
  });

  it('does NOT render the marker when interpolationState is "none"', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1', interpolationState: 'none' })],
      }),
    );
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('member-auto-interpolated:m1')).toBeNull();
  });

  // ─── Phase 4.8 step-through review ──────────────────────────────────

  it('renders the step-through ▶ button alongside the AI marker', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1', interpolationState: 'has-interpolated' })],
      }),
    );
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('member-step-through:m1')).not.toBeNull();
  });

  it('does NOT render the step-through button when no interpolated marker', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1', interpolationState: null })],
      }),
    );
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('member-step-through:m1')).toBeNull();
  });

  it('clicking the step-through button calls containerActions.stepThroughInterpolated(memberId)', () => {
    stepThroughInterpolatedMock.mockClear();
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1', interpolationState: 'has-interpolated' })],
      }),
    );
    render(<ContainerListPanel />);
    fireEvent.click(screen.getByTestId('member-step-through:m1'));
    expect(stepThroughInterpolatedMock).toHaveBeenCalledTimes(1);
    expect(stepThroughInterpolatedMock).toHaveBeenCalledWith('m1');
  });
});

// ─── MV-Phase 7.3a: container-level kebab menu (spec §4.4.1) ────────────

describe('container action menu (spec §4.4.1)', () => {
  let originalConfirm: typeof window.confirm;
  beforeEach(() => {
    originalConfirm = window.confirm;
    window.confirm = vi.fn().mockReturnValue(true);
  });
  afterEach(() => {
    window.confirm = originalConfirm;
  });

  it('opens the popover with the spec menu items when "⋯" clicked', () => {
    setContainers(makeContainer({ id: 'c1', dirty: true }));
    render(<ContainerListPanel />);
    act(() => fireEvent.click(screen.getByTestId('container-menu:c1')));
    expect(screen.queryByTestId('container-menu-popover:c1')).not.toBeNull();
    // Spec §4.4.1 ordering: Save to file → Save to XNAT → Rename →
    // Duplicate → Reload → Discard → bulk × 4 → Delete.
    expect(screen.queryByTestId('container-menu-save-file:c1')).not.toBeNull();
    expect(screen.queryByTestId('container-menu-save-xnat:c1')).not.toBeNull();
    expect(screen.queryByTestId('container-menu-rename:c1')).not.toBeNull();
    expect(screen.queryByTestId('container-menu-duplicate:c1')).not.toBeNull();
    expect(screen.queryByTestId('container-menu-reload:c1')).not.toBeNull();
    expect(screen.queryByTestId('container-menu-discard:c1')).not.toBeNull();
    expect(screen.queryByTestId('container-menu-bulk-show:c1')).not.toBeNull();
    expect(screen.queryByTestId('container-menu-bulk-hide:c1')).not.toBeNull();
    expect(screen.queryByTestId('container-menu-bulk-lock:c1')).not.toBeNull();
    expect(screen.queryByTestId('container-menu-bulk-unlock:c1')).not.toBeNull();
    expect(screen.queryByTestId('container-menu-delete:c1')).not.toBeNull();
  });

  it('"Save to file" calls containerActions.exportContainer', () => {
    setContainers(makeContainer({ id: 'c1' }));
    render(<ContainerListPanel />);
    act(() => fireEvent.click(screen.getByTestId('container-menu:c1')));
    act(() => fireEvent.click(screen.getByTestId('container-menu-save-file:c1')));
    expect(exportContainerMock).toHaveBeenCalledWith('c1');
  });

  it('"Save to XNAT" calls containerActions.uploadContainerToXnat (when connected)', () => {
    // Setting status='connected' lifts the disabled state on the menu item.
    act(() => useConnectionStore.setState({ status: 'connected' }));
    setContainers(makeContainer({ id: 'c1' }));
    render(<ContainerListPanel />);
    act(() => fireEvent.click(screen.getByTestId('container-menu:c1')));
    act(() => fireEvent.click(screen.getByTestId('container-menu-save-xnat:c1')));
    expect(uploadContainerToXnatMock).toHaveBeenCalledWith('c1');
    act(() => useConnectionStore.setState({ status: 'disconnected' }));
  });

  it('"Discard local changes" calls revertContainer after confirm', () => {
    setContainers(makeContainer({ id: 'c1', dirty: true }));
    render(<ContainerListPanel />);
    act(() => fireEvent.click(screen.getByTestId('container-menu:c1')));
    act(() => fireEvent.click(screen.getByTestId('container-menu-discard:c1')));
    expect(revertContainerMock).toHaveBeenCalledWith('c1');
  });

  it('"Discard local changes" does NOT call when user cancels', () => {
    window.confirm = vi.fn().mockReturnValue(false);
    setContainers(makeContainer({ id: 'c1', dirty: true }));
    render(<ContainerListPanel />);
    act(() => fireEvent.click(screen.getByTestId('container-menu:c1')));
    act(() => fireEvent.click(screen.getByTestId('container-menu-discard:c1')));
    expect(revertContainerMock).not.toHaveBeenCalled();
  });

  it('"Discard local changes" is disabled when not dirty', () => {
    setContainers(makeContainer({ id: 'c1', dirty: false }));
    render(<ContainerListPanel />);
    act(() => fireEvent.click(screen.getByTestId('container-menu:c1')));
    expect(
      (screen.getByTestId('container-menu-discard:c1') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('"Discard local changes" is disabled when container is approved', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        dirty: true,
        approval: { approved: true, reviewerName: null, reviewedAt: 0, history: [] },
      }),
    );
    render(<ContainerListPanel />);
    act(() => fireEvent.click(screen.getByTestId('container-menu:c1')));
    expect(
      (screen.getByTestId('container-menu-discard:c1') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('"Reload from XNAT" is disabled when the container has no XNAT origin', () => {
    setContainers(makeContainer({ id: 'c1', sourceIdentity: null }));
    render(<ContainerListPanel />);
    act(() => fireEvent.click(screen.getByTestId('container-menu:c1')));
    expect(
      (screen.getByTestId('container-menu-reload:c1') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('"Save to XNAT" is disabled when not connected to XNAT', () => {
    // connectionStore.status defaults to 'disconnected' in tests.
    setContainers(makeContainer({ id: 'c1' }));
    render(<ContainerListPanel />);
    act(() => fireEvent.click(screen.getByTestId('container-menu:c1')));
    expect(
      (screen.getByTestId('container-menu-save-xnat:c1') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('"Duplicate" is rendered disabled in this sub-task (impl lands in a follow-up)', () => {
    setContainers(makeContainer({ id: 'c1' }));
    render(<ContainerListPanel />);
    act(() => fireEvent.click(screen.getByTestId('container-menu:c1')));
    expect(
      (screen.getByTestId('container-menu-duplicate:c1') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('"Show all members" calls setAllMembersVisibility with mode=filled', () => {
    setContainers(makeContainer({ id: 'c1' }));
    render(<ContainerListPanel />);
    act(() => fireEvent.click(screen.getByTestId('container-menu:c1')));
    act(() => fireEvent.click(screen.getByTestId('container-menu-bulk-show:c1')));
    expect(setAllMembersVisibilityMock).toHaveBeenCalledWith('c1', 'filled');
  });

  it('"Hide all members" calls setAllMembersVisibility with mode=hidden', () => {
    setContainers(makeContainer({ id: 'c1' }));
    render(<ContainerListPanel />);
    act(() => fireEvent.click(screen.getByTestId('container-menu:c1')));
    act(() => fireEvent.click(screen.getByTestId('container-menu-bulk-hide:c1')));
    expect(setAllMembersVisibilityMock).toHaveBeenCalledWith('c1', 'hidden');
  });

  it('"Lock all members" calls setAllMembersLock(true)', () => {
    setContainers(makeContainer({ id: 'c1' }));
    render(<ContainerListPanel />);
    act(() => fireEvent.click(screen.getByTestId('container-menu:c1')));
    act(() => fireEvent.click(screen.getByTestId('container-menu-bulk-lock:c1')));
    expect(setAllMembersLockMock).toHaveBeenCalledWith('c1', true);
  });

  it('"Unlock all members" calls setAllMembersLock(false)', () => {
    setContainers(makeContainer({ id: 'c1' }));
    render(<ContainerListPanel />);
    act(() => fireEvent.click(screen.getByTestId('container-menu:c1')));
    act(() => fireEvent.click(screen.getByTestId('container-menu-bulk-unlock:c1')));
    expect(setAllMembersLockMock).toHaveBeenCalledWith('c1', false);
  });

  it('"Lock all" / "Unlock all" are disabled when container is approved', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        approval: { approved: true, reviewerName: null, reviewedAt: 0, history: [] },
      }),
    );
    render(<ContainerListPanel />);
    act(() => fireEvent.click(screen.getByTestId('container-menu:c1')));
    expect(
      (screen.getByTestId('container-menu-bulk-lock:c1') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId('container-menu-bulk-unlock:c1') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('"Rename" puts the container name into an inline edit input', () => {
    setContainers(makeContainer({ id: 'c1', name: 'My Container' }));
    render(<ContainerListPanel />);
    act(() => fireEvent.click(screen.getByTestId('container-menu:c1')));
    act(() => fireEvent.click(screen.getByTestId('container-menu-rename:c1')));
    const input = screen.getByTestId('container-rename-input:c1') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe('My Container');
  });

  it('Rename input — Enter commits the new name via containerService.renameContainer', () => {
    setContainers(makeContainer({ id: 'c1', name: 'Old Name' }));
    render(<ContainerListPanel />);
    act(() => fireEvent.click(screen.getByTestId('container-menu:c1')));
    act(() => fireEvent.click(screen.getByTestId('container-menu-rename:c1')));
    const input = screen.getByTestId('container-rename-input:c1') as HTMLInputElement;
    act(() => fireEvent.change(input, { target: { value: 'New Name' } }));
    act(() => fireEvent.keyDown(input, { key: 'Enter' }));
    expect(renameContainerMock).toHaveBeenCalledWith('c1', 'New Name');
  });

  it('Rename input — Escape cancels without calling renameContainer', () => {
    setContainers(makeContainer({ id: 'c1', name: 'Old Name' }));
    render(<ContainerListPanel />);
    act(() => fireEvent.click(screen.getByTestId('container-menu:c1')));
    act(() => fireEvent.click(screen.getByTestId('container-menu-rename:c1')));
    const input = screen.getByTestId('container-rename-input:c1') as HTMLInputElement;
    act(() => fireEvent.change(input, { target: { value: 'New Name' } }));
    act(() => fireEvent.keyDown(input, { key: 'Escape' }));
    expect(renameContainerMock).not.toHaveBeenCalled();
  });

  it('"Delete…" opens the DeleteConfirmDialog; Cancel does not delete, Delete does (spec §4.4.2)', () => {
    setContainers(makeContainer({ id: 'c1' }));
    render(<ContainerListPanel />);

    // Open the action menu → click Delete → dialog appears.
    act(() => fireEvent.click(screen.getByTestId('container-menu:c1')));
    act(() => fireEvent.click(screen.getByTestId('container-menu-delete:c1')));
    expect(screen.queryByTestId('delete-confirm-dialog')).not.toBeNull();
    expect(deleteContainerMock).not.toHaveBeenCalled();

    // Cancel closes the dialog without calling deleteContainer.
    act(() => fireEvent.click(screen.getByTestId('delete-confirm-cancel')));
    expect(deleteContainerMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('delete-confirm-dialog')).toBeNull();

    // Re-open + click Delete → containerService.deleteContainer fires.
    act(() => fireEvent.click(screen.getByTestId('container-menu:c1')));
    act(() => fireEvent.click(screen.getByTestId('container-menu-delete:c1')));
    act(() => fireEvent.click(screen.getByTestId('delete-confirm-local-only')));
    expect(deleteContainerMock).toHaveBeenCalledWith('c1');
  });
});

// ─── MV-Phase 7.3a: right-click container context menu (spec §4.7) ───────

describe('container right-click context menu (spec §4.7)', () => {
  it('opens at the cursor with the bulk + expand/collapse items', () => {
    setContainers(makeContainer({ id: 'c1' }));
    render(<ContainerListPanel />);
    const row = screen.getByTestId('container-row:c1');
    const header = row.firstElementChild as HTMLElement;
    act(() => fireEvent.contextMenu(header, { clientX: 100, clientY: 200 }));
    expect(screen.queryByTestId('container-context-menu:c1')).not.toBeNull();
    expect(screen.queryByTestId('container-menu-ctx-bulk-show:c1')).not.toBeNull();
    expect(screen.queryByTestId('container-menu-ctx-bulk-hide:c1')).not.toBeNull();
    expect(screen.queryByTestId('container-menu-ctx-bulk-lock:c1')).not.toBeNull();
    expect(screen.queryByTestId('container-menu-ctx-bulk-unlock:c1')).not.toBeNull();
    expect(screen.queryByTestId('container-menu-ctx-expand:c1')).not.toBeNull();
    expect(screen.queryByTestId('container-menu-ctx-collapse:c1')).not.toBeNull();
  });

  it('"Show all" from context menu dispatches setAllMembersVisibility', () => {
    setContainers(makeContainer({ id: 'c1' }));
    render(<ContainerListPanel />);
    const header = screen.getByTestId('container-row:c1').firstElementChild as HTMLElement;
    act(() => fireEvent.contextMenu(header, { clientX: 100, clientY: 200 }));
    act(() => fireEvent.click(screen.getByTestId('container-menu-ctx-bulk-show:c1')));
    expect(setAllMembersVisibilityMock).toHaveBeenCalledWith('c1', 'filled');
  });
});

// ─── Phase 3.8 cleanup: bulk operations (D7.5 / D7.6) ─────────────────

describe('bulk action bar (D7.5 / D7.6)', () => {
  let originalConfirm: typeof window.confirm;
  beforeEach(() => {
    originalConfirm = window.confirm;
    window.confirm = vi.fn().mockReturnValue(true);
  });
  afterEach(() => {
    window.confirm = originalConfirm;
  });

  it('only renders when selection has at least one member', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1' }), makeMember({ id: 'm2' })],
      }),
    );
    const { rerender } = render(<ContainerListPanel />);
    expect(screen.queryByTestId('bulk-action-bar')).toBeNull();
    act(() => useContainerSelectionStore.getState().setSelection('m1'));
    rerender(<ContainerListPanel />);
    expect(screen.queryByTestId('bulk-action-bar')).not.toBeNull();
  });

  it('Hide applies setMemberVisibility(hidden) to every selected member', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1' }), makeMember({ id: 'm2' })],
      }),
    );
    act(() =>
      useContainerSelectionStore.getState().setSelectionSet(['m1', 'm2']),
    );
    render(<ContainerListPanel />);
    fireEvent.click(screen.getByTestId('bulk-hide'));
    expect(setMemberVisibilityMock).toHaveBeenCalledWith('m1', 'hidden');
    expect(setMemberVisibilityMock).toHaveBeenCalledWith('m2', 'hidden');
  });

  it('Show applies setMemberVisibility(filled) to every selected member', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1' }), makeMember({ id: 'm2' })],
      }),
    );
    act(() =>
      useContainerSelectionStore.getState().setSelectionSet(['m1', 'm2']),
    );
    render(<ContainerListPanel />);
    fireEvent.click(screen.getByTestId('bulk-show'));
    expect(setMemberVisibilityMock).toHaveBeenCalledWith('m1', 'filled');
    expect(setMemberVisibilityMock).toHaveBeenCalledWith('m2', 'filled');
  });

  it('Lock applies setMemberLock(true) only to non-approved containers', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1' })],
      }),
      makeContainer({
        id: 'c2',
        approval: { approved: true, reviewerName: null, reviewedAt: 0, history: [] },
        members: [makeMember({ id: 'm2' })],
      }),
    );
    act(() =>
      useContainerSelectionStore.getState().setSelectionSet(['m1', 'm2']),
    );
    render(<ContainerListPanel />);
    fireEvent.click(screen.getByTestId('bulk-lock'));
    expect(setMemberLockMock).toHaveBeenCalledWith('m1', true);
    expect(setMemberLockMock).not.toHaveBeenCalledWith('m2', true);
  });

  it('Delete prompts confirm and calls deleteMember per editable member', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1' }), makeMember({ id: 'm2' })],
      }),
    );
    act(() =>
      useContainerSelectionStore.getState().setSelectionSet(['m1', 'm2']),
    );
    render(<ContainerListPanel />);
    fireEvent.click(screen.getByTestId('bulk-delete'));
    expect(deleteMemberMock).toHaveBeenCalledWith('m1');
    expect(deleteMemberMock).toHaveBeenCalledWith('m2');
    // Selection cleared after delete.
    expect(useContainerSelectionStore.getState().selectionSet.size).toBe(0);
  });

  it('Delete cancelled does NOT call deleteMember', () => {
    window.confirm = vi.fn().mockReturnValue(false);
    setContainers(
      makeContainer({ id: 'c1', members: [makeMember({ id: 'm1' })] }),
    );
    act(() => useContainerSelectionStore.getState().setSelectionSet(['m1']));
    render(<ContainerListPanel />);
    fireEvent.click(screen.getByTestId('bulk-delete'));
    expect(deleteMemberMock).not.toHaveBeenCalled();
  });

  it('Clear-selection button empties the selection set', () => {
    setContainers(
      makeContainer({ id: 'c1', members: [makeMember({ id: 'm1' })] }),
    );
    act(() => useContainerSelectionStore.getState().setSelectionSet(['m1']));
    render(<ContainerListPanel />);
    fireEvent.click(screen.getByTestId('bulk-clear'));
    expect(useContainerSelectionStore.getState().selectionSet.size).toBe(0);
  });
});

// ─── Phase 3.8 cleanup: session-level Save All (D7.6) ─────────────────

describe('session save-all (D7.6)', () => {
  it('renders only when at least one container is dirty', () => {
    setContainers(makeContainer({ id: 'c1', dirty: false }));
    const { rerender } = render(<ContainerListPanel />);
    expect(screen.queryByTestId('session-save-all')).toBeNull();
    setContainers(makeContainer({ id: 'c1', dirty: true }));
    rerender(<ContainerListPanel />);
    expect(screen.queryByTestId('session-save-all')).not.toBeNull();
  });

  it('clicking opens the Save All preflight dialog (spec §4.4.4)', () => {
    setContainers(makeContainer({ id: 'c1', dirty: true }));
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('save-all-preflight-dialog')).toBeNull();
    act(() => fireEvent.click(screen.getByTestId('session-save-all')));
    expect(screen.queryByTestId('save-all-preflight-dialog')).not.toBeNull();
    // The legacy saveAllDirty path is no longer used by the panel.
    expect(saveAllDirtyMock).not.toHaveBeenCalled();
  });

  it('preflight lists every dirty container and shows count in the button label', () => {
    setContainers(
      makeContainer({ id: 'a', name: 'Tumor A', dirty: true }),
      makeContainer({ id: 'b', name: 'Clean', dirty: false }),
      makeContainer({ id: 'c', name: 'Heart', dirty: true }),
    );
    render(<ContainerListPanel />);
    const btn = screen.getByTestId('session-save-all');
    expect(btn.textContent?.toLowerCase()).toMatch(/save all \(2\)/);
    act(() => fireEvent.click(btn));
    expect(screen.queryByTestId('save-all-row:a')).not.toBeNull();
    expect(screen.queryByTestId('save-all-row:c')).not.toBeNull();
    expect(screen.queryByTestId('save-all-row:b')).toBeNull();
  });
});

// ─── MV-Phase 7.3c: create-button row (spec §4.3) ────────────────────

describe('header create-button row (spec §4.3)', () => {
  beforeEach(() => {
    usePreferencesStore.getState().setAnnotationPanelWidth(ANNOTATION_PANEL_DEFAULT_WIDTH);
    useToastStore.getState().clearAll();
    // Default: active viewport has a scan loaded.
    useViewerStore.setState({
      activeViewportId: 'panel_0',
      panelImageIdsMap: { panel_0: ['img:1', 'img:2'] },
    } as Partial<ReturnType<typeof useViewerStore.getState>>);
  });

  it('renders all three create buttons with their type-specific testids', () => {
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('panel-create-seg')).not.toBeNull();
    expect(screen.queryByTestId('panel-create-struct')).not.toBeNull();
    expect(screen.queryByTestId('panel-create-meas')).not.toBeNull();
  });

  it('above the compact-add threshold, labels are rendered', () => {
    usePreferencesStore.getState().setAnnotationPanelWidth(400);
    render(<ContainerListPanel />);
    expect(screen.getByTestId('panel-create-seg').textContent).toMatch(/Segmentation/);
    expect(screen.getByTestId('panel-create-struct').textContent).toMatch(/Structure/);
    expect(screen.getByTestId('panel-create-meas').textContent).toMatch(/Measurement/);
    expect(screen.getByTestId('panel-create-seg').dataset.compact).toBeUndefined();
  });

  it('below the compact-add threshold (< 270), labels are hidden and data-compact is set', () => {
    usePreferencesStore.getState().setAnnotationPanelWidth(200);
    render(<ContainerListPanel />);
    expect(screen.getByTestId('panel-create-seg').textContent).not.toMatch(/Segmentation/);
    expect(screen.getByTestId('panel-create-seg').dataset.compact).toBe('true');
  });

  it('clicking a create button with no scan on the active panel emits an info toast and creates nothing', () => {
    useViewerStore.setState({
      activeViewportId: 'panel_0',
      panelImageIdsMap: {},
    } as Partial<ReturnType<typeof useViewerStore.getState>>);
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.click(screen.getByTestId('panel-create-seg'));
    });
    const toasts = useToastStore.getState().toasts;
    expect(toasts.length).toBe(1);
    expect(toasts[0].kind).toBe('info');
    expect(toasts[0].message).toMatch(/Load a scan/);
    expect(createNewSegmentationMock).not.toHaveBeenCalled();
    expect(createNewStructureMock).not.toHaveBeenCalled();
  });

  it('clicking + Segmentation creates a SEG named "Segmentation N"', async () => {
    render(<ContainerListPanel />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('panel-create-seg'));
    });
    expect(createNewSegmentationMock).toHaveBeenCalledTimes(1);
    const [vp, sourceIds, name, createDefault] = createNewSegmentationMock.mock.calls[0];
    expect(vp).toBe('panel_0');
    expect(sourceIds).toEqual(['img:1', 'img:2']);
    expect(name).toBe('Segmentation 1');
    expect(createDefault).toBe(true);
  });

  it('Segmentation N increments past existing SEG containers', async () => {
    setContainers(
      makeContainer({ id: 'c1', kind: 'SEG', name: 'Existing seg' }),
      makeContainer({ id: 'c2', kind: 'SEG', name: 'Other seg' }),
    );
    render(<ContainerListPanel />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('panel-create-seg'));
    });
    expect(createNewSegmentationMock.mock.calls[0][2]).toBe('Segmentation 3');
  });

  it('clicking + Structure creates an RTSTRUCT named "Structure N"', async () => {
    render(<ContainerListPanel />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('panel-create-struct'));
    });
    expect(createNewStructureMock).toHaveBeenCalledTimes(1);
    expect(createNewStructureMock.mock.calls[0][2]).toBe('Structure 1');
  });

  it('clicking + Measurement emits an info "coming soon" toast (no creation)', () => {
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.click(screen.getByTestId('panel-create-meas'));
    });
    expect(createNewSegmentationMock).not.toHaveBeenCalled();
    expect(createNewStructureMock).not.toHaveBeenCalled();
    const toasts = useToastStore.getState().toasts;
    expect(toasts.length).toBe(1);
    expect(toasts[0].kind).toBe('info');
    expect(toasts[0].message).toMatch(/coming soon/i);
  });

  it('after SEG creation, the new container drops into inline rename mode', async () => {
    render(<ContainerListPanel />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('panel-create-seg'));
    });
    // The store-sync from createNewSegmentation isn't wired in tests;
    // simulate it landing as a container with the resolved id.
    act(() => {
      setContainers(
        makeContainer({ id: 'seg_new_1', name: 'Segmentation 1' }),
      );
    });
    expect(screen.queryByTestId('container-rename-input:seg_new_1')).not.toBeNull();
  });

  it('createNewSegmentation throw → error toast, no rename pending', async () => {
    createNewSegmentationMock.mockRejectedValueOnce(new Error('boom'));
    render(<ContainerListPanel />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('panel-create-seg'));
    });
    const toasts = useToastStore.getState().toasts;
    expect(toasts.some((t) => t.kind === 'error')).toBe(true);
  });
});

// ─── MV-Phase 7.5: multi-viewport coupling (spec §5.2) ───────────────

describe('container dim + cross-panel pill (spec §5.2)', () => {
  beforeEach(() => {
    // Reset the default visibility: panel_0 = show all, others = empty.
    getVisibleSegMock.mockReset().mockImplementation((vp: string) =>
      vp === 'panel_0' ? null : new Set<string>(),
    );
    useViewerStore.setState({
      ...useViewerStore.getState(),
      activeViewportId: 'panel_0',
      layoutConfig: { ...useViewerStore.getState().layoutConfig, panelCount: 4 },
    });
  });

  it('container shown on the active viewport has no dim + no pill', () => {
    getVisibleSegMock.mockImplementation((vp: string) =>
      vp === 'panel_0' ? new Set(['c1']) : new Set<string>(),
    );
    setContainers(makeContainer({ id: 'c1' }));
    render(<ContainerListPanel />);
    const row = screen.getByTestId('container-row:c1');
    expect(row.dataset.onActivePanel).toBe('true');
    expect(row.className).not.toMatch(/opacity-50/);
    expect(screen.queryByTestId('container-panel-pill:c1')).toBeNull();
  });

  it('container shown only on a non-active viewport → dims + "↗ panel_X" pill', () => {
    getVisibleSegMock.mockImplementation((vp: string) =>
      vp === 'panel_2' ? new Set(['c1']) : new Set<string>(),
    );
    setContainers(makeContainer({ id: 'c1' }));
    render(<ContainerListPanel />);
    const row = screen.getByTestId('container-row:c1');
    expect(row.dataset.onActivePanel).toBeUndefined();
    expect(row.className).toMatch(/opacity-50/);
    const pill = screen.getByTestId('container-panel-pill:c1');
    expect(pill.textContent).toMatch(/↗ panel_2/);
    expect(pill.getAttribute('title')).toMatch(/Shown on: panel_2/);
  });

  it('container on multiple non-active viewports → "↗ N panels" pill', () => {
    getVisibleSegMock.mockImplementation((vp: string) =>
      vp === 'panel_1' || vp === 'panel_2' ? new Set(['c1']) : new Set<string>(),
    );
    setContainers(makeContainer({ id: 'c1' }));
    render(<ContainerListPanel />);
    expect(screen.getByTestId('container-panel-pill:c1').textContent).toMatch(/↗ 2 panels/);
  });

  it('container not shown anywhere → "↗ not loaded" pill', () => {
    getVisibleSegMock.mockImplementation(() => new Set<string>());
    setContainers(makeContainer({ id: 'c1' }));
    render(<ContainerListPanel />);
    expect(screen.getByTestId('container-panel-pill:c1').textContent).toMatch(/↗ not loaded/);
  });

  it('header counter shows "N total · K on active panel" (spec §5.3)', () => {
    getVisibleSegMock.mockImplementation((vp: string) =>
      vp === 'panel_0' ? new Set(['c1']) : new Set<string>(),
    );
    setContainers(
      makeContainer({ id: 'c1' }),
      makeContainer({ id: 'c2' }),
      makeContainer({ id: 'c3' }),
    );
    render(<ContainerListPanel />);
    expect(screen.getByTestId('container-count').textContent).toMatch(/3 total · 1 on active panel/);
  });

  it('Active only toggle filters the list (spec §5.3)', () => {
    getVisibleSegMock.mockImplementation((vp: string) =>
      vp === 'panel_0' ? new Set(['c1']) : new Set<string>(),
    );
    setContainers(
      makeContainer({ id: 'c1', name: 'On active' }),
      makeContainer({ id: 'c2', name: 'On other' }),
    );
    render(<ContainerListPanel />);
    // Default: All panels — both rows visible.
    expect(screen.queryByTestId('container-row:c1')).not.toBeNull();
    expect(screen.queryByTestId('container-row:c2')).not.toBeNull();

    // Toggle to Active only — only c1 remains.
    act(() => {
      fireEvent.click(screen.getByTestId('container-panel-scope-toggle'));
    });
    expect(screen.getByTestId('container-panel-scope-toggle').dataset.scope).toBe('active');
    expect(screen.queryByTestId('container-row:c1')).not.toBeNull();
    expect(screen.queryByTestId('container-row:c2')).toBeNull();

    // Toggle back — both rows again.
    act(() => {
      fireEvent.click(screen.getByTestId('container-panel-scope-toggle'));
    });
    expect(screen.queryByTestId('container-row:c2')).not.toBeNull();
  });

  it('switching active viewport flips dim + pill state for the same container', () => {
    getVisibleSegMock.mockImplementation((vp: string) =>
      vp === 'panel_0' || vp === 'panel_1' ? new Set(['c1']) : new Set<string>(),
    );
    setContainers(makeContainer({ id: 'c1' }));
    const { rerender } = render(<ContainerListPanel />);
    // panel_0 active → no pill (container on panel_0).
    expect(screen.queryByTestId('container-panel-pill:c1')).toBeNull();
    // Flip to panel_2 (which doesn't show c1) → pill appears.
    act(() => {
      useViewerStore.setState({
        ...useViewerStore.getState(),
        activeViewportId: 'panel_2',
      });
    });
    rerender(<ContainerListPanel />);
    const pill = screen.queryByTestId('container-panel-pill:c1');
    expect(pill).not.toBeNull();
    // c1 is on panel_0 + panel_1, both non-active from panel_2's view.
    expect(pill!.textContent).toMatch(/↗ 2 panels/);
  });
});

// ─── MV-Phase 7.3c: resizable panel (spec §4.1) ──────────────────────

describe('panel width and resize (spec §4.1)', () => {
  // jsdom's getBoundingClientRect returns zeros; tests mock the panel's
  // right edge so the resize math has a defined anchor.
  beforeEach(() => {
    usePreferencesStore.getState().setAnnotationPanelWidth(ANNOTATION_PANEL_DEFAULT_WIDTH);
  });

  it('renders at the persisted preference width (default 400)', () => {
    setContainers(makeContainer({ id: 'c1' }));
    render(<ContainerListPanel />);
    const panel = screen.getByTestId('container-panel') as HTMLDivElement;
    expect(panel.style.width).toBe(`${ANNOTATION_PANEL_DEFAULT_WIDTH}px`);
    expect(panel.dataset.panelWidth).toBe(String(ANNOTATION_PANEL_DEFAULT_WIDTH));
  });

  it('a stored width is read on mount', () => {
    usePreferencesStore.getState().setAnnotationPanelWidth(320);
    setContainers(makeContainer({ id: 'c1' }));
    render(<ContainerListPanel />);
    const panel = screen.getByTestId('container-panel') as HTMLDivElement;
    expect(panel.style.width).toBe('320px');
  });

  it('dragging the resize handle clamps width to the [MIN, MAX] range', () => {
    setContainers(makeContainer({ id: 'c1' }));
    render(<ContainerListPanel />);
    const panel = screen.getByTestId('container-panel') as HTMLDivElement;
    const handle = screen.getByTestId('container-panel-resize-handle');
    stubRightEdge(panel, 1000);

    // Cursor at x=100 → 1000-100 = 900 > MAX (600), clamps to MAX.
    act(() => {
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 950 });
    });
    act(() => {
      handle.dispatchEvent(makePointerEvent('pointermove', 100));
    });
    expect(panel.style.width).toBe(`${ANNOTATION_PANEL_MAX_WIDTH}px`);

    // Cursor at x=2000 → 1000-2000 = -1000 < MIN, clamps to MIN.
    act(() => {
      handle.dispatchEvent(makePointerEvent('pointermove', 2000));
    });
    expect(panel.style.width).toBe(`${ANNOTATION_PANEL_MIN_WIDTH}px`);
  });

  it('pointerup persists the final width to preferences', () => {
    setContainers(makeContainer({ id: 'c1' }));
    render(<ContainerListPanel />);
    const panel = screen.getByTestId('container-panel') as HTMLDivElement;
    const handle = screen.getByTestId('container-panel-resize-handle');
    stubRightEdge(panel, 1000);

    act(() => {
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 600 });
    });
    act(() => {
      handle.dispatchEvent(makePointerEvent('pointermove', 700));
    });
    act(() => {
      handle.dispatchEvent(makePointerEvent('pointerup', 700));
    });
    // Final cursor x=700 → 1000-700 = 300 (within range).
    expect(usePreferencesStore.getState().preferences.annotationPanel.width).toBe(300);
    expect(panel.style.width).toBe('300px');
  });
});

// ─── MV-Phase 7.3b: member-row drag-handle reorder (spec §4.5) ──────────

describe('member-row drag handle (spec §4.5)', () => {
  it('renders the drag handle on every member of a non-approved container', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [
          makeMember({ id: 'm1', name: 'A' }),
          makeMember({ id: 'm2', name: 'B' }),
        ],
      }),
    );
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('member-drag-handle:m1')).not.toBeNull();
    expect(screen.queryByTestId('member-drag-handle:m2')).not.toBeNull();
  });

  it('hides the drag handle when the container is approved', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        approval: { approved: true, reviewerName: null, reviewedAt: 0, history: [] },
        members: [makeMember({ id: 'm1' })],
      }),
    );
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('member-drag-handle:m1')).toBeNull();
  });

  it('drag over the upper half of a row shows the "above" indicator', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [
          makeMember({ id: 'm1', name: 'A' }),
          makeMember({ id: 'm2', name: 'B' }),
        ],
      }),
    );
    render(<ContainerListPanel />);
    const target = screen.getByTestId('member-row:m2');
    mockRect(target, { top: 100, height: 40 });
    const dt = makeDataTransfer({ 'application/x-member-id': 'm1' });

    act(() => {
      dispatchDrag(target, 'dragOver', { clientY: 105, dataTransfer: dt });
    });
    // dropEdge='above' renders the indicator with the same testid; we
    // assert presence (its position is purely CSS).
    expect(screen.queryByTestId('member-drop-indicator:m2')).not.toBeNull();
  });

  it('dropping a member above another calls reorderMember with the target index', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [
          makeMember({ id: 'm1', name: 'A' }),
          makeMember({ id: 'm2', name: 'B' }),
          makeMember({ id: 'm3', name: 'C' }),
        ],
      }),
    );
    render(<ContainerListPanel />);
    const target = screen.getByTestId('member-row:m3');
    mockRect(target, { top: 100, height: 40 });
    const dt = makeDataTransfer({ 'application/x-member-id': 'm1' });

    act(() => {
      dispatchDrag(target, 'dragOver', { clientY: 105, dataTransfer: dt });
    });
    act(() => {
      dispatchDrag(target, 'drop', { dataTransfer: dt });
    });

    // m1 dropped on top half of m3 → target index = current index of m3 = 2.
    expect(reorderMemberMock).toHaveBeenCalledWith('m1', 2);
  });

  it('dropping a member below another uses the next index', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [
          makeMember({ id: 'm1', name: 'A' }),
          makeMember({ id: 'm2', name: 'B' }),
        ],
      }),
    );
    render(<ContainerListPanel />);
    const target = screen.getByTestId('member-row:m1');
    mockRect(target, { top: 100, height: 40 });
    const dt = makeDataTransfer({ 'application/x-member-id': 'm2' });

    act(() => {
      dispatchDrag(target, 'dragOver', { clientY: 135, dataTransfer: dt });
    });
    act(() => {
      dispatchDrag(target, 'drop', { dataTransfer: dt });
    });

    // m2 dropped on bottom half of m1 (index 0) → target index = 0 + 1 = 1.
    expect(reorderMemberMock).toHaveBeenCalledWith('m2', 1);
  });

  it('dropping a member onto itself is a no-op (no reorderMember call)', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1' })],
      }),
    );
    render(<ContainerListPanel />);
    const target = screen.getByTestId('member-row:m1');
    mockRect(target, { top: 100, height: 40 });
    const dt = makeDataTransfer({ 'application/x-member-id': 'm1' });

    act(() => {
      dispatchDrag(target, 'drop', { dataTransfer: dt });
    });
    expect(reorderMemberMock).not.toHaveBeenCalled();
  });
});

// ─── MV-Phase 7.3b: name double-click rename (spec §4.5) ──────────────

describe('member name double-click rename (spec §4.5)', () => {
  it('double-clicking the name opens the inline rename input', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1', name: 'Lesion 1' })],
      }),
    );
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('member-rename:m1')).toBeNull();
    act(() => {
      fireEvent.doubleClick(screen.getByTestId('member-name:m1'));
    });
    expect(screen.queryByTestId('member-rename:m1')).not.toBeNull();
  });

  it('approved containers do NOT enter rename on double-click', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        approval: { approved: true, reviewerName: null, reviewedAt: 0, history: [] },
        members: [makeMember({ id: 'm1' })],
      }),
    );
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.doubleClick(screen.getByTestId('member-name:m1'));
    });
    expect(screen.queryByTestId('member-rename:m1')).toBeNull();
  });
});

// ─── MV-Phase 7.3b: visibility modifiers (spec §4.5) ──────────────────

describe('member visibility shift-click solo (spec §4.5)', () => {
  it('shift-click hides every other member; visible target stays visible', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [
          makeMember({ id: 'm1', visibility: 'filled' }),
          makeMember({ id: 'm2', visibility: 'filled' }),
          makeMember({ id: 'm3', visibility: 'outlined' }),
        ],
      }),
    );
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.click(screen.getByTestId('member-visibility:m2'), { shiftKey: true });
    });
    // m1 and m3 are hidden; m2 is not re-shown (already visible).
    const calls = setMemberVisibilityMock.mock.calls;
    expect(calls).toEqual(expect.arrayContaining([['m1', 'hidden'], ['m3', 'hidden']]));
    // No call for m2 (already visible → ensure-visible skipped).
    expect(calls.some(([id]) => id === 'm2')).toBe(false);
  });

  it('shift-click on a hidden target also un-hides the target', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [
          makeMember({ id: 'm1', visibility: 'filled' }),
          makeMember({ id: 'm2', visibility: 'hidden' }),
        ],
      }),
    );
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.click(screen.getByTestId('member-visibility:m2'), { shiftKey: true });
    });
    const calls = setMemberVisibilityMock.mock.calls;
    expect(calls).toEqual(expect.arrayContaining([['m1', 'hidden'], ['m2', 'filled']]));
  });
});

// ─── MV-Phase 7.3b: color picker popover (spec §4.5) ──────────────────

describe('member color picker popover (spec §4.5)', () => {
  it('shows 16 preset swatches in a 4×4 grid', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1' })],
      }),
    );
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.click(screen.getByTestId('member-color:m1'));
    });
    for (let i = 0; i < 16; i++) {
      expect(screen.queryByTestId(`member-color-preset:m1:${i}`)).not.toBeNull();
    }
  });

  it('clicking a preset calls recolorMember and closes the popover', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1' })],
      }),
    );
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.click(screen.getByTestId('member-color:m1'));
    });
    act(() => {
      fireEvent.click(screen.getByTestId('member-color-preset:m1:3'));
    });
    expect(recolorMemberMock).toHaveBeenCalledTimes(1);
    const [calledId, calledColor] = recolorMemberMock.mock.calls[0];
    expect(calledId).toBe('m1');
    expect(Array.isArray(calledColor) && calledColor.length === 3).toBe(true);
    expect(screen.queryByTestId('member-color-picker:m1')).toBeNull();
  });

  it('Custom… row hosts a native color input that maps hex → RGB', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1' })],
      }),
    );
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.click(screen.getByTestId('member-color:m1'));
    });
    const input = screen.getByTestId('member-color-custom-input:m1') as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: '#1a2b3c' } });
    });
    expect(recolorMemberMock).toHaveBeenCalledWith('m1', [0x1a, 0x2b, 0x3c]);
  });

  it('swatch is disabled and the picker does not open when the container is approved', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        approval: { approved: true, reviewerName: null, reviewedAt: 0, history: [] },
        members: [makeMember({ id: 'm1' })],
      }),
    );
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.click(screen.getByTestId('member-color:m1'));
    });
    expect(screen.queryByTestId('member-color-picker:m1')).toBeNull();
  });
});

/**
 * jsdom lacks a PointerEvent constructor. The resize handler only
 * reads `clientX` off the event, so we hand-roll an Event with that
 * property defined.
 */
function makePointerEvent(type: string, clientX: number): Event {
  const ev = new Event(type);
  Object.defineProperty(ev, 'clientX', { value: clientX, configurable: true });
  return ev;
}

/**
 * Pin the panel's right edge to a known pixel value so the resize
 * math (width = rightEdge − cursorX) is deterministic in tests.
 */
function stubRightEdge(panel: HTMLElement, right: number) {
  Object.defineProperty(panel, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      top: 0, height: 800, bottom: 800,
      left: right - 400, right, width: 400,
      x: right - 400, y: 0,
      toJSON: () => ({}),
    }),
  });
}

/**
 * Build a minimal DataTransfer-shaped object for fireEvent.dragOver/drop.
 * jsdom doesn't ship a DataTransfer constructor, so we hand-roll the
 * subset our drag handlers actually use: types[], getData, setData,
 * effectAllowed, dropEffect.
 */
function makeDataTransfer(payload: Record<string, string>): DataTransfer {
  const data = new Map<string, string>(Object.entries(payload));
  return {
    types: Array.from(data.keys()),
    setData: (type: string, value: string) => { data.set(type, value); },
    getData: (type: string) => data.get(type) ?? '',
    effectAllowed: 'move',
    dropEffect: 'move',
  } as unknown as DataTransfer;
}

/**
 * Override getBoundingClientRect on a specific element for the test.
 * jsdom returns all-zero rects by default; the drag handlers use the
 * rect to decide above-vs-below the row midpoint.
 */
function mockRect(el: Element, { top, height }: { top: number; height: number }) {
  const rect: DOMRect = {
    top, height,
    bottom: top + height,
    left: 0, right: 200, width: 200,
    x: 0, y: top,
    toJSON: () => ({}),
  } as DOMRect;
  el.getBoundingClientRect = () => rect;
}

/**
 * Dispatch a drag event with clientY + dataTransfer attached.
 *
 * fireEvent.dragOver/drop in @testing-library don't propagate
 * `clientY` into the synthetic event (only MouseEvent does it
 * natively, and the jsdom DragEvent shim drops it). We use
 * createEvent + defineProperty to force the property onto the
 * event before dispatching.
 */
function dispatchDrag(
  el: Element,
  type: 'dragOver' | 'drop' | 'dragStart' | 'dragEnd' | 'dragLeave',
  init: { clientY?: number; dataTransfer?: DataTransfer },
) {
  const event = createEvent[type](el);
  if (init.clientY !== undefined) {
    Object.defineProperty(event, 'clientY', { value: init.clientY, configurable: true });
  }
  if (init.dataTransfer) {
    Object.defineProperty(event, 'dataTransfer', { value: init.dataTransfer, configurable: true });
  }
  fireEvent(el, event);
}
