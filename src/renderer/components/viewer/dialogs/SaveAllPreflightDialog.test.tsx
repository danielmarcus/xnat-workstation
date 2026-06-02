/**
 * SaveAllPreflightDialog component tests — spec §4.4.4.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import SaveAllPreflightDialog, {
  type SaveAllPreflightRow,
} from './SaveAllPreflightDialog';

function makeRow(overrides: Partial<SaveAllPreflightRow> = {}): SaveAllPreflightRow {
  return {
    containerId: 'c1',
    containerName: 'Container 1',
    kindLabel: 'SEG',
    memberSummary: '3 segments',
    xnatOrigin: { scanId: '3004' },
    defaultCopyName: 'Container 1 (copy)',
    ...overrides,
  };
}

function renderDialog(rows: SaveAllPreflightRow[]) {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  const utils = render(
    <SaveAllPreflightDialog
      open
      rows={rows}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
  );
  return { ...utils, onCancel, onConfirm };
}

describe('SaveAllPreflightDialog (spec §4.4.4)', () => {
  it('does not render when open=false', () => {
    render(
      <SaveAllPreflightDialog
        open={false}
        rows={[]}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.queryByTestId('save-all-preflight-dialog')).toBeNull();
  });

  it('lists every row with the kind tag, name, and member summary', () => {
    renderDialog([
      makeRow({ containerId: 'a', containerName: 'A', memberSummary: '3 segments' }),
      makeRow({ containerId: 'b', containerName: 'B', kindLabel: 'STRUCT', memberSummary: '2 structures', xnatOrigin: { scanId: '4001' } }),
    ]);
    expect(screen.queryByTestId('save-all-row:a')).not.toBeNull();
    expect(screen.queryByTestId('save-all-row:b')).not.toBeNull();
    expect(screen.getByTestId('save-all-row:a').textContent).toMatch(/3 segments/);
    expect(screen.getByTestId('save-all-row:b').textContent).toMatch(/STRUCT/);
    expect(screen.getByTestId('save-all-row:b').textContent).toMatch(/existing #4001/);
  });

  it('XNAT-origin rows default to Overwrite; non-origin rows default to "new"', () => {
    renderDialog([
      makeRow({ containerId: 'has-origin', xnatOrigin: { scanId: '1' } }),
      makeRow({ containerId: 'no-origin', xnatOrigin: null }),
    ]);
    expect(screen.getByTestId('save-all-row:has-origin').dataset.action).toBe('overwrite');
    expect(screen.getByTestId('save-all-row:no-origin').dataset.action).toBe('new');
  });

  it('action dropdown options differ based on origin', () => {
    renderDialog([
      makeRow({ containerId: 'has-origin', xnatOrigin: { scanId: '1' } }),
      makeRow({ containerId: 'no-origin', xnatOrigin: null }),
    ]);
    const originSelect = screen.getByTestId('save-all-action-select:has-origin') as HTMLSelectElement;
    const nonOriginSelect = screen.getByTestId('save-all-action-select:no-origin') as HTMLSelectElement;
    expect(Array.from(originSelect.options).map((o) => o.value)).toEqual(['overwrite', 'copy', 'skip']);
    expect(Array.from(nonOriginSelect.options).map((o) => o.value)).toEqual(['new', 'skip']);
  });

  it('switching to "copy" reveals the inline name input prefilled with defaultCopyName', () => {
    renderDialog([
      makeRow({ containerId: 'c1', defaultCopyName: 'My copy' }),
    ]);
    expect(screen.queryByTestId('save-all-copy-name:c1')).toBeNull();
    act(() => {
      fireEvent.change(screen.getByTestId('save-all-action-select:c1'), { target: { value: 'copy' } });
    });
    const input = screen.getByTestId('save-all-copy-name:c1') as HTMLInputElement;
    expect(input.value).toBe('My copy');
  });

  it('switching back to overwrite hides the name input', () => {
    renderDialog([makeRow({ containerId: 'c1' })]);
    act(() => {
      fireEvent.change(screen.getByTestId('save-all-action-select:c1'), { target: { value: 'copy' } });
    });
    expect(screen.queryByTestId('save-all-copy-name:c1')).not.toBeNull();
    act(() => {
      fireEvent.change(screen.getByTestId('save-all-action-select:c1'), { target: { value: 'overwrite' } });
    });
    expect(screen.queryByTestId('save-all-copy-name:c1')).toBeNull();
  });

  it('summary line updates live as actions change', () => {
    renderDialog([
      makeRow({ containerId: 'a', xnatOrigin: { scanId: '1' } }),
      makeRow({ containerId: 'b', xnatOrigin: { scanId: '2' } }),
      makeRow({ containerId: 'c', xnatOrigin: null }),
    ]);
    expect(screen.getByTestId('save-all-summary').textContent).toMatch(/2 overwrite · 0 copy · 1 new · 0 skipped/);

    act(() => {
      fireEvent.change(screen.getByTestId('save-all-action-select:b'), { target: { value: 'copy' } });
    });
    act(() => {
      fireEvent.change(screen.getByTestId('save-all-action-select:c'), { target: { value: 'skip' } });
    });
    expect(screen.getByTestId('save-all-summary').textContent).toMatch(/1 overwrite · 1 copy · 0 new · 1 skipped/);
  });

  it('Save all button shows non-skipped count', () => {
    renderDialog([
      makeRow({ containerId: 'a' }),
      makeRow({ containerId: 'b' }),
      makeRow({ containerId: 'c' }),
    ]);
    expect(screen.getByTestId('save-all-commit').textContent).toMatch(/Save all \(3\)/);
    act(() => {
      fireEvent.change(screen.getByTestId('save-all-action-select:b'), { target: { value: 'skip' } });
    });
    expect(screen.getByTestId('save-all-commit').textContent).toMatch(/Save all \(2\)/);
  });

  it('Save all button is disabled when all rows are skipped', () => {
    renderDialog([
      makeRow({ containerId: 'a' }),
      makeRow({ containerId: 'b' }),
    ]);
    act(() => {
      fireEvent.change(screen.getByTestId('save-all-action-select:a'), { target: { value: 'skip' } });
      fireEvent.change(screen.getByTestId('save-all-action-select:b'), { target: { value: 'skip' } });
    });
    expect((screen.getByTestId('save-all-commit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Save all is disabled when a copy row has an empty trimmed name', () => {
    renderDialog([
      makeRow({ containerId: 'a' }),
    ]);
    act(() => {
      fireEvent.change(screen.getByTestId('save-all-action-select:a'), { target: { value: 'copy' } });
    });
    act(() => {
      fireEvent.change(screen.getByTestId('save-all-copy-name:a'), { target: { value: '   ' } });
    });
    expect((screen.getByTestId('save-all-commit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Save all fires onConfirm with a decision per row; copy carries the trimmed name', () => {
    const { onConfirm } = renderDialog([
      makeRow({ containerId: 'a', xnatOrigin: { scanId: '1' } }),
      makeRow({ containerId: 'b', xnatOrigin: { scanId: '2' }, defaultCopyName: 'B (copy)' }),
      makeRow({ containerId: 'c', xnatOrigin: null }),
    ]);
    act(() => {
      fireEvent.change(screen.getByTestId('save-all-action-select:b'), { target: { value: 'copy' } });
    });
    act(() => {
      fireEvent.change(screen.getByTestId('save-all-copy-name:b'), { target: { value: '  Edited Copy  ' } });
    });
    act(() => {
      fireEvent.click(screen.getByTestId('save-all-commit'));
    });
    expect(onConfirm).toHaveBeenCalledWith([
      { containerId: 'a', action: 'overwrite' },
      { containerId: 'b', action: 'copy', copyName: 'Edited Copy' },
      { containerId: 'c', action: 'new' },
    ]);
  });

  it('Cancel + scrim + Escape all fire onCancel', () => {
    const { onCancel } = renderDialog([makeRow({ containerId: 'a' })]);
    act(() => fireEvent.click(screen.getByTestId('save-all-cancel')));
    act(() => fireEvent.click(screen.getByLabelText('Close dialog')));
    act(() => fireEvent.keyDown(window, { key: 'Escape' }));
    expect(onCancel).toHaveBeenCalledTimes(3);
  });
});
