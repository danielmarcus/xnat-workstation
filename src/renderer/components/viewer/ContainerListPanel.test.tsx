/**
 * Component tests for the Phase 3.3 ContainerListPanel.
 *
 * Drives the panel through synthetic Container snapshots in
 * useContainerStore. No bridge interaction — these tests verify the
 * UI shell renders state correctly.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ContainerListPanel from './ContainerListPanel';
import { useContainerStore } from '../../stores/containerStore';
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
});

afterEach(() => {
  useContainerStore.getState()._replaceAll(new Map());
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
