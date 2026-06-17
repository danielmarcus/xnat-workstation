import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Container } from '@shared/types/annotation';
import ContainerList, { type ContainerListHandlers } from '../ContainerList';

/** Rebuild Phase 3, R3.4/R3.5 glue — list composes container headers + member rows. */
const containers: Container[] = [
  {
    id: 'rt-1', kind: 'RTSTRUCT', label: 'Pelvis', source: { projectId: 'P', subjectId: 'S', sessionId: 'E', sourceScanId: '4' },
    members: [
      { id: '1', label: 'GTV', visible: true, locked: false },
      { id: '2', label: 'CTV', visible: false, locked: true },
    ],
  },
];

const noopHandlers: ContainerListHandlers = {
  onToggleExpand: vi.fn(), onApproveToggle: vi.fn(), onAddMember: vi.fn(), onSaveContainer: vi.fn(),
  onResolveConflict: vi.fn(),
  onKebab: vi.fn(), onSetAllVisible: vi.fn(), onSetAllLocked: vi.fn(),
  onExportContainerDicom: vi.fn(), onExportContainerCsv: vi.fn(),
  onDeleteContainer: vi.fn(), onRenameContainer: vi.fn(), onSelectMember: vi.fn(),
  onActivateContainer: vi.fn(),
  onActivateMember: vi.fn(), onCycleVisibility: vi.fn(), onToggleLock: vi.fn(), onDeleteMember: vi.fn(),
  onRenameMember: vi.fn(), onColorChange: vi.fn(),
};

function renderList(expanded: boolean, over: Partial<React.ComponentProps<typeof ContainerList>> = {}) {
  render(
    <ContainerList
      containers={containers}
      handlers={noopHandlers}
      isExpanded={() => expanded}
      isActive={(cid, mid) => cid === 'rt-1' && mid === '1'}
      isSelected={() => false}
      {...over}
    />,
  );
}

describe('ContainerList', () => {
  it('renders the container header always, and member rows only when expanded', () => {
    renderList(false);
    expect(screen.getByText('Pelvis')).toBeTruthy();
    expect(screen.queryByText('GTV')).toBeNull(); // collapsed
  });

  it('shows members when expanded, marking the active one', () => {
    renderList(true);
    expect(screen.getByText('GTV')).toBeTruthy();
    expect(screen.getByText('CTV')).toBeTruthy();
    expect(screen.getByTestId('active-indicator')).toBeTruthy(); // GTV is active
  });

  it('derives member lock state from the Member.locked field', () => {
    renderList(true);
    // CTV is locked → its lock button reflects the locked (amber) state via title
    const lockButtons = screen.getAllByLabelText('Toggle lock');
    expect(lockButtons.some((b) => b.getAttribute('title')?.includes('Locked'))).toBe(true);
  });
});
