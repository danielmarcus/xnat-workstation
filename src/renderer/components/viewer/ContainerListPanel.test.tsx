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

vi.mock('../../lib/cornerstone/containerService', () => ({
  containerService: {
    setMemberVisibility: setMemberVisibilityMock,
    setActiveMember: setActiveMemberMock,
    renameMember: renameMemberMock,
    deleteMember: deleteMemberMock,
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
