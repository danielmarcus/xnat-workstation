import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import RecoveryDialog, { type RecoveryItem } from './RecoveryDialog';

function makeItems(overrides: Array<Partial<RecoveryItem>> = []): RecoveryItem[] {
  const base: RecoveryItem[] = [
    { id: 'a', name: 'Tumor study A', summary: '3 segments', ageLabel: '2h ago' },
    { id: 'b', name: 'Organs at risk', summary: '2 structures', ageLabel: '30m ago' },
    { id: 'c', name: 'Lesion measurements', summary: '4 measurements', ageLabel: 'yesterday' },
  ];
  return base.map((item, i) => ({ ...item, ...(overrides[i] ?? {}) }));
}

function renderDialog(overrides: Partial<React.ComponentProps<typeof RecoveryDialog>> = {}) {
  const onSkipAll = vi.fn();
  const onRecover = vi.fn();
  const utils = render(
    <RecoveryDialog
      open
      items={makeItems()}
      onSkipAll={onSkipAll}
      onRecover={onRecover}
      {...overrides}
    />,
  );
  return { ...utils, onSkipAll, onRecover };
}

describe('RecoveryDialog (spec §12.5)', () => {
  it('does not render when open=false', () => {
    render(
      <RecoveryDialog open={false} items={makeItems()} onSkipAll={() => {}} onRecover={() => {}} />,
    );
    expect(screen.queryByTestId('recovery-dialog')).toBeNull();
  });

  it('renders one row per item with the spec summary + age labels', () => {
    renderDialog();
    expect(screen.queryByTestId('recovery-row:a')).not.toBeNull();
    expect(screen.queryByTestId('recovery-row:b')).not.toBeNull();
    expect(screen.queryByTestId('recovery-row:c')).not.toBeNull();
    expect(screen.getByTestId('recovery-row:a').textContent).toMatch(/3 segments · 2h ago/);
    expect(screen.getByTestId('recovery-row:c').textContent).toMatch(/4 measurements · yesterday/);
  });

  it('all rows default to checked; count reflects N items', () => {
    renderDialog();
    const items = makeItems();
    for (const item of items) {
      expect((screen.getByTestId(`recovery-row-check:${item.id}`) as HTMLInputElement).checked).toBe(true);
    }
    expect(screen.getByTestId('recovery-dialog-recover').textContent).toMatch(/Recover selected \(3\)/);
  });

  it('respects per-item defaultSelected=false', () => {
    renderDialog({
      items: makeItems([{ defaultSelected: true }, { defaultSelected: true }, { defaultSelected: false }]),
    });
    expect((screen.getByTestId('recovery-row-check:c') as HTMLInputElement).checked).toBe(false);
    expect(screen.getByTestId('recovery-dialog-recover').textContent).toMatch(/Recover selected \(2\)/);
  });

  it('toggling a checkbox updates the recover-count live', () => {
    renderDialog();
    act(() => {
      fireEvent.click(screen.getByTestId('recovery-row-check:b'));
    });
    expect(screen.getByTestId('recovery-dialog-recover').textContent).toMatch(/Recover selected \(2\)/);
    act(() => {
      fireEvent.click(screen.getByTestId('recovery-row-check:a'));
    });
    expect(screen.getByTestId('recovery-dialog-recover').textContent).toMatch(/Recover selected \(1\)/);
  });

  it('Recover selected fires onRecover with only the checked ids', () => {
    const { onRecover } = renderDialog();
    act(() => {
      fireEvent.click(screen.getByTestId('recovery-row-check:c'));
    });
    act(() => {
      fireEvent.click(screen.getByTestId('recovery-dialog-recover'));
    });
    expect(onRecover).toHaveBeenCalledWith(['a', 'b']);
  });

  it('Recover button is disabled when nothing is selected', () => {
    renderDialog();
    act(() => {
      fireEvent.click(screen.getByTestId('recovery-row-check:a'));
      fireEvent.click(screen.getByTestId('recovery-row-check:b'));
      fireEvent.click(screen.getByTestId('recovery-row-check:c'));
    });
    expect((screen.getByTestId('recovery-dialog-recover') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Skip all + scrim + Escape all fire onSkipAll', () => {
    const { onSkipAll } = renderDialog();
    act(() => fireEvent.click(screen.getByTestId('recovery-dialog-skip')));
    act(() => fireEvent.click(screen.getByTestId('recovery-dialog-scrim')));
    act(() => fireEvent.keyDown(window, { key: 'Escape' }));
    expect(onSkipAll).toHaveBeenCalledTimes(3);
  });

  it('reopening with a different items list re-seeds the defaults', () => {
    const { rerender } = render(
      <RecoveryDialog open items={makeItems()} onSkipAll={() => {}} onRecover={() => {}} />,
    );
    act(() => fireEvent.click(screen.getByTestId('recovery-row-check:a')));
    expect(screen.getByTestId('recovery-dialog-recover').textContent).toMatch(/\(2\)/);

    rerender(
      <RecoveryDialog open={false} items={makeItems()} onSkipAll={() => {}} onRecover={() => {}} />,
    );
    rerender(
      <RecoveryDialog
        open
        items={[{ id: 'x', name: 'X', summary: '1 segment', ageLabel: 'now' }]}
        onSkipAll={() => {}}
        onRecover={() => {}}
      />,
    );
    expect(screen.getByTestId('recovery-dialog-recover').textContent).toMatch(/\(1\)/);
  });

  it('header copy reflects sessionLabel when provided', () => {
    renderDialog({ sessionLabel: 'CT2024_Visit1' });
    expect(screen.getByTestId('recovery-dialog').textContent).toMatch(/CT2024_Visit1 has 3 backups/);
  });
});
