import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PanelHeader from '../PanelHeader';
import AnnotationsSidePanel from '../AnnotationsSidePanel';

/**
 * Rebuild Phase 3, R3.3 — panel shell + header behaviour (frozen mockup §1/§2).
 * Behavioural contract for the header controls + empty-state branching; the
 * pixel-match is verified separately against docs/mockup/annotations-panel.html.
 */
describe('PanelHeader', () => {
  const setup = (over: Partial<React.ComponentProps<typeof PanelHeader>> = {}) => {
    const onCreate = vi.fn();
    const onSaveAll = vi.fn();
    render(<PanelHeader canCreate anyDirty onCreate={onCreate} onSaveAll={onSaveAll} {...over} />);
    return { onCreate, onSaveAll };
  };

  it('renders the three type create buttons + Save-all', () => {
    setup();
    expect(screen.getByLabelText('New Structure (RTSTRUCT)')).toBeTruthy();
    expect(screen.getByLabelText('New Segmentation (SEG)')).toBeTruthy();
    expect(screen.getByLabelText('New Measurement (SR)')).toBeTruthy();
    expect(screen.getByLabelText('Save all annotations')).toBeTruthy();
  });

  it('disables create buttons when no scan is loaded (canCreate=false)', () => {
    setup({ canCreate: false });
    expect((screen.getByLabelText('New Structure (RTSTRUCT)') as HTMLButtonElement).disabled).toBe(true);
  });

  it('fires onCreate with the kind when a create button is clicked', async () => {
    const { onCreate } = setup();
    await userEvent.click(screen.getByLabelText('New Segmentation (SEG)'));
    expect(onCreate).toHaveBeenCalledWith('SEG');
  });

  it('disables Save-all when nothing is dirty and fires onSaveAll when enabled', async () => {
    const { onSaveAll } = setup({ anyDirty: false });
    expect((screen.getByLabelText('Save all annotations') as HTMLButtonElement).disabled).toBe(true);
    expect(onSaveAll).not.toHaveBeenCalled();
  });

  it('fires onSaveAll when dirty and clicked', async () => {
    const { onSaveAll } = setup({ anyDirty: true });
    await userEvent.click(screen.getByLabelText('Save all annotations'));
    expect(onSaveAll).toHaveBeenCalled();
  });
});

describe('AnnotationsSidePanel (shell)', () => {
  const base = {
    canCreate: true,
    anyDirty: false,
    onCreate: vi.fn(),
    onSaveAll: vi.fn(),
  };

  it('shows the no-scan empty state when create is disabled', () => {
    render(<AnnotationsSidePanel {...base} canCreate={false} containerCount={0} />);
    expect(screen.getByText('No scan loaded')).toBeTruthy();
  });

  it('shows the no-annotations empty state when a scan is loaded but no containers', () => {
    render(<AnnotationsSidePanel {...base} canCreate containerCount={0} />);
    expect(screen.getByText('No annotations yet')).toBeTruthy();
  });

  it('renders the container list (children) instead of the empty state when populated', () => {
    render(
      <AnnotationsSidePanel {...base} containerCount={2}>
        <div data-testid="container-list">rows</div>
      </AnnotationsSidePanel>,
    );
    expect(screen.getByTestId('container-list')).toBeTruthy();
    expect(screen.queryByText('No annotations yet')).toBeNull();
  });
});
