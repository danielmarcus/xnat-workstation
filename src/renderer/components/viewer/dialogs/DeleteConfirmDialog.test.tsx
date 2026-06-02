/**
 * DeleteConfirmDialog component tests — spec §4.4.2.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import DeleteConfirmDialog from './DeleteConfirmDialog';

function renderDialog(overrides: Partial<React.ComponentProps<typeof DeleteConfirmDialog>> = {}) {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  const utils = render(
    <DeleteConfirmDialog
      open
      containerName="Tumor study A"
      memberCount={1}
      memberKindLabel="segment"
      hasUnsavedChanges={false}
      xnatOrigin={null}
      onCancel={onCancel}
      onConfirm={onConfirm}
      {...overrides}
    />,
  );
  return { ...utils, onCancel, onConfirm };
}

describe('DeleteConfirmDialog (spec §4.4.2)', () => {
  it('does not render when open=false', () => {
    render(
      <DeleteConfirmDialog
        open={false}
        containerName="X"
        memberCount={1}
        memberKindLabel="segment"
        hasUnsavedChanges={false}
        xnatOrigin={null}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.queryByTestId('delete-confirm-dialog')).toBeNull();
  });

  describe('form 1 — no XNAT origin, ≤ 1 member', () => {
    it('renders single Delete button (red) and a Cancel button', () => {
      renderDialog({ memberCount: 1, xnatOrigin: null });
      expect(screen.getByTestId('delete-confirm-local-only').textContent).toMatch(/^Delete$/);
      expect(screen.queryByTestId('delete-confirm-local-and-remote')).toBeNull();
      expect(screen.getByTestId('delete-confirm-summary').textContent).toMatch(/cannot be undone/i);
    });

    it('confirm fires onConfirm("local")', () => {
      const { onConfirm } = renderDialog({ memberCount: 1, xnatOrigin: null });
      act(() => {
        fireEvent.click(screen.getByTestId('delete-confirm-local-only'));
      });
      expect(onConfirm).toHaveBeenCalledWith('local');
    });

    it('cancel button + scrim click + Escape all fire onCancel', () => {
      const { onCancel } = renderDialog({ memberCount: 1, xnatOrigin: null });
      act(() => {
        fireEvent.click(screen.getByTestId('delete-confirm-cancel'));
      });
      act(() => {
        fireEvent.click(screen.getByLabelText('Close dialog'));
      });
      act(() => {
        fireEvent.keyDown(window, { key: 'Escape' });
      });
      expect(onCancel).toHaveBeenCalledTimes(3);
    });
  });

  describe('form 2 — no XNAT origin, > 1 members', () => {
    it('renders "Delete all" button and shows member count in summary', () => {
      renderDialog({ memberCount: 5, memberKindLabel: 'segment', xnatOrigin: null });
      expect(screen.getByTestId('delete-confirm-local-only').textContent).toMatch(/^Delete all$/);
      expect(screen.getByTestId('delete-confirm-summary').textContent).toMatch(/Contains 5 segments/);
    });

    it('singular noun for one member, plural otherwise', () => {
      const { unmount } = renderDialog({ memberCount: 1, memberKindLabel: 'structure', xnatOrigin: null });
      expect(screen.getByTestId('delete-confirm-summary').textContent).not.toMatch(/Contains/);
      unmount();
      renderDialog({ memberCount: 3, memberKindLabel: 'structure', xnatOrigin: null });
      expect(screen.getByTestId('delete-confirm-summary').textContent).toMatch(/3 structures/);
    });
  });

  describe('form 3 — with XNAT origin', () => {
    it('renders both destructive options + Cancel', () => {
      renderDialog({
        memberCount: 3,
        xnatOrigin: { scanId: '3004', host: 'xnat.example.org' },
      });
      expect(screen.queryByTestId('delete-confirm-local-only')).not.toBeNull();
      expect(screen.queryByTestId('delete-confirm-local-and-remote')).not.toBeNull();
      expect(screen.queryByTestId('delete-confirm-cancel')).not.toBeNull();
    });

    it('shows scan id + Local/Remote summary boxes', () => {
      renderDialog({
        memberCount: 3,
        memberKindLabel: 'segment',
        xnatOrigin: { scanId: '3004' },
      });
      const dialog = screen.getByTestId('delete-confirm-dialog');
      expect(dialog.textContent).toMatch(/scan #3004/);
      expect(dialog.textContent).toMatch(/3 segments/);
    });

    it('"Unsaved changes: ✓" appears only when hasUnsavedChanges is true', () => {
      const { unmount } = renderDialog({
        memberCount: 2,
        hasUnsavedChanges: true,
        xnatOrigin: { scanId: '5' },
      });
      expect(screen.getByTestId('delete-confirm-summary').textContent).toMatch(/Unsaved changes: ✓/);
      unmount();
      renderDialog({
        memberCount: 2,
        hasUnsavedChanges: false,
        xnatOrigin: { scanId: '5' },
      });
      expect(screen.getByTestId('delete-confirm-summary').textContent).not.toMatch(/Unsaved changes/);
    });

    it('local-only fires onConfirm("local"); remote-too fires onConfirm("local-and-remote")', () => {
      const { onConfirm } = renderDialog({
        memberCount: 2,
        xnatOrigin: { scanId: '7' },
      });
      act(() => {
        fireEvent.click(screen.getByTestId('delete-confirm-local-only'));
      });
      expect(onConfirm).toHaveBeenLastCalledWith('local');
      act(() => {
        fireEvent.click(screen.getByTestId('delete-confirm-local-and-remote'));
      });
      expect(onConfirm).toHaveBeenLastCalledWith('local-and-remote');
    });

    it('initial focus is on Cancel — the destructive button is never default', () => {
      renderDialog({
        memberCount: 1,
        xnatOrigin: { scanId: '1' },
      });
      expect(document.activeElement).toBe(screen.getByTestId('delete-confirm-cancel'));
    });

    it('uses the provided host label when present', () => {
      renderDialog({
        memberCount: 1,
        xnatOrigin: { scanId: '1', host: 'central.xnat.org' },
      });
      expect(screen.getByTestId('delete-confirm-local-and-remote').textContent)
        .toMatch(/Delete on central\.xnat\.org too/);
    });
  });
});
