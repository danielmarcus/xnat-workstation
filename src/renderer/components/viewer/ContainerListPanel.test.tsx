/**
 * Component tests for the Phase 3.3 ContainerListPanel.
 *
 * Drives the panel through synthetic Container snapshots in
 * useContainerStore. No bridge interaction — these tests verify the
 * UI shell renders state correctly.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock containerService methods — we just verify the panel calls them
// with the right arguments. The service's behavior is covered by
// containerService.test.ts.
const setMemberVisibilityMock = vi.hoisted(() => vi.fn());
const setActiveMemberMock = vi.hoisted(() => vi.fn());
const renameMemberMock = vi.hoisted(() => vi.fn());
const deleteMemberMock = vi.hoisted(() => vi.fn());
const setA2cOptedInMock = vi.hoisted(() => vi.fn());
const approveContainerMock = vi.hoisted(() => vi.fn());
const revokeApprovalMock = vi.hoisted(() => vi.fn());

vi.mock('../../lib/cornerstone/containerService', () => ({
  containerService: {
    setMemberVisibility: setMemberVisibilityMock,
    setActiveMember: setActiveMemberMock,
    renameMember: renameMemberMock,
    deleteMember: deleteMemberMock,
    setA2cOptedIn: setA2cOptedInMock,
    approveContainer: approveContainerMock,
    revokeApproval: revokeApprovalMock,
  },
}));

import ContainerListPanel from './ContainerListPanel';
import { useContainerStore } from '../../stores/containerStore';
import { useContainerSelectionStore } from '../../stores/containerSelectionStore';
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
  setMemberVisibilityMock.mockReset();
  setActiveMemberMock.mockReset();
  renameMemberMock.mockReset();
  deleteMemberMock.mockReset();
  setA2cOptedInMock.mockReset();
  approveContainerMock.mockReset();
  revokeApprovalMock.mockReset();
});

afterEach(() => {
  useContainerStore.getState()._replaceAll(new Map());
  useContainerSelectionStore.getState().setActive(null);
  useContainerSelectionStore.getState().clearSelection();
});

describe('empty state', () => {
  it('shows the empty-state message when no containers', () => {
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('container-panel-empty')).not.toBeNull();
    expect(screen.queryByTestId('container-count')?.textContent).toBe('0');
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
    expect(screen.queryByTestId('container-count')?.textContent).toBe('2');
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

  it('color-swatch click activates the member without changing selection', () => {
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

    // Click m2's color swatch — activates m2 but keeps m1 selected.
    act(() => {
      fireEvent.click(screen.getByTestId('member-color:m2'));
    });
    expect(setActiveMemberMock).toHaveBeenCalledWith('m2');
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
    expect(swatch.getAttribute('aria-pressed')).toBe('true');
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

// ─── Phase 3.6b: per-member action menu ────────────────────────────────

describe('per-member action menu (D7.6)', () => {
  it('clicking ⋯ opens the popover', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1' })],
      }),
    );
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('member-menu-popover:m1')).toBeNull();

    act(() => {
      fireEvent.click(screen.getByTestId('member-menu:m1'));
    });
    expect(screen.queryByTestId('member-menu-popover:m1')).not.toBeNull();
  });

  it('clicking ⋯ again closes the popover (toggle)', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1' })],
      }),
    );
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.click(screen.getByTestId('member-menu:m1'));
      fireEvent.click(screen.getByTestId('member-menu:m1'));
    });
    expect(screen.queryByTestId('member-menu-popover:m1')).toBeNull();
  });

  it('outside pointerdown closes the popover', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1' })],
      }),
    );
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.click(screen.getByTestId('member-menu:m1'));
    });
    expect(screen.queryByTestId('member-menu-popover:m1')).not.toBeNull();

    act(() => {
      fireEvent.pointerDown(document.body);
    });
    expect(screen.queryByTestId('member-menu-popover:m1')).toBeNull();
  });

  it('menu button click does NOT bubble into row selection', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1' })],
      }),
    );
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.click(screen.getByTestId('member-menu:m1'));
    });
    expect(useContainerSelectionStore.getState().selectionSet.size).toBe(0);
  });
});

describe('inline rename (D7.6)', () => {
  it('clicking Rename swaps the name span for an input pre-filled with the current name', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1', name: 'Tumor' })],
      }),
    );
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.click(screen.getByTestId('member-menu:m1'));
    });
    act(() => {
      fireEvent.click(screen.getByTestId('member-menu-rename:m1'));
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
      fireEvent.click(screen.getByTestId('member-menu:m1'));
    });
    act(() => {
      fireEvent.click(screen.getByTestId('member-menu-rename:m1'));
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
      fireEvent.click(screen.getByTestId('member-menu:m1'));
    });
    act(() => {
      fireEvent.click(screen.getByTestId('member-menu-rename:m1'));
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
      fireEvent.click(screen.getByTestId('member-menu:m1'));
    });
    act(() => {
      fireEvent.click(screen.getByTestId('member-menu-rename:m1'));
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
      fireEvent.click(screen.getByTestId('member-menu:m1'));
    });
    act(() => {
      fireEvent.click(screen.getByTestId('member-menu-rename:m1'));
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
      fireEvent.click(screen.getByTestId('member-menu:m1'));
    });
    act(() => {
      fireEvent.click(screen.getByTestId('member-menu-rename:m1'));
    });
    act(() => {
      fireEvent.click(screen.getByTestId('member-rename:m1'));
    });
    expect(useContainerSelectionStore.getState().selectionSet.size).toBe(0);
  });
});

describe('delete with confirm (D7.6)', () => {
  let originalConfirm: typeof window.confirm;
  beforeEach(() => {
    originalConfirm = window.confirm;
  });
  afterEach(() => {
    window.confirm = originalConfirm;
  });

  it('user confirms → deleteMember called', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1', name: 'Tumor' })],
      }),
    );
    window.confirm = vi.fn().mockReturnValue(true);
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.click(screen.getByTestId('member-menu:m1'));
    });
    act(() => {
      fireEvent.click(screen.getByTestId('member-menu-delete:m1'));
    });
    expect(deleteMemberMock).toHaveBeenCalledWith('m1');
  });

  it('user cancels → deleteMember NOT called', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1', name: 'Tumor' })],
      }),
    );
    window.confirm = vi.fn().mockReturnValue(false);
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.click(screen.getByTestId('member-menu:m1'));
    });
    act(() => {
      fireEvent.click(screen.getByTestId('member-menu-delete:m1'));
    });
    expect(deleteMemberMock).not.toHaveBeenCalled();
  });

  it('clicking Delete closes the popover', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1' })],
      }),
    );
    window.confirm = vi.fn().mockReturnValue(true);
    render(<ContainerListPanel />);
    act(() => {
      fireEvent.click(screen.getByTestId('member-menu:m1'));
    });
    act(() => {
      fireEvent.click(screen.getByTestId('member-menu-delete:m1'));
    });
    expect(screen.queryByTestId('member-menu-popover:m1')).toBeNull();
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

  it('approved container hides the per-member action menu (edit-locked per §D7.11)', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        approval: { approved: true, reviewerName: 'a', reviewedAt: 0, history: [] },
        members: [makeMember({ id: 'm1' })],
      }),
    );
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('member-menu:m1')).toBeNull();
  });

  it('un-approved container shows the per-member action menu', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        approval: { approved: false, reviewerName: null, reviewedAt: null, history: [] },
        members: [makeMember({ id: 'm1' })],
      }),
    );
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('member-menu:m1')).not.toBeNull();
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
  it('renders a badge when roiType is set', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        kind: 'RTSTRUCT',
        members: [makeMember({ id: 'm1', roiType: 'GTV' })],
      }),
    );
    render(<ContainerListPanel />);
    const badge = screen.queryByTestId('member-roi-type:m1');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe('GTV');
  });

  it('hides the badge when roiType is null', () => {
    setContainers(
      makeContainer({
        id: 'c1',
        members: [makeMember({ id: 'm1', roiType: null })],
      }),
    );
    render(<ContainerListPanel />);
    expect(screen.queryByTestId('member-roi-type:m1')).toBeNull();
  });

  it('GTV / CTV / PTV / ORGAN / EXTERNAL / AVOIDANCE get distinct color hints', () => {
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
      const badge = screen.queryByTestId(`member-roi-type:m-${type}`);
      expect(badge?.className).toMatch(color);
      unmount();
    }
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
