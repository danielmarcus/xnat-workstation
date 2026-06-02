import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import CheatsheetOverlay from './CheatsheetOverlay';
import { usePreferencesStore } from '../stores/preferencesStore';

beforeEach(() => {
  usePreferencesStore.getState().resetAll();
});
afterEach(() => {
  usePreferencesStore.getState().resetAll();
});

describe('CheatsheetOverlay (spec §6.3)', () => {
  it('does not render when open=false', () => {
    render(<CheatsheetOverlay open={false} onClose={() => {}} />);
    expect(screen.queryByTestId('cheatsheet-overlay')).toBeNull();
  });

  it('renders a dialog with the major spec categories present', () => {
    render(<CheatsheetOverlay open onClose={() => {}} />);
    expect(screen.queryByTestId('cheatsheet-overlay')).not.toBeNull();
    for (const cat of ['Tools', 'Editing tools', 'Viewport', 'Layout', 'Slice', 'Brush', 'Panels', 'Edit']) {
      expect(screen.queryByTestId(`cheatsheet-section:${cat}`)).not.toBeNull();
    }
  });

  it('renders bound actions only — unbound actions (e.g., tool.sculptor) are omitted', () => {
    render(<CheatsheetOverlay open onClose={() => {}} />);
    // Bound by default.
    expect(screen.queryByTestId('cheatsheet-row:tool.brush')).not.toBeNull();
    // Unbound by default.
    expect(screen.queryByTestId('cheatsheet-row:tool.sculptor')).toBeNull();
  });

  it('binding chip text reflects the current binding for an action', () => {
    render(<CheatsheetOverlay open onClose={() => {}} />);
    expect(screen.getByTestId('cheatsheet-binding:tool.brush:0').textContent).toBe('B');
  });

  it('updates live when the user remaps an action via preferences', () => {
    render(<CheatsheetOverlay open onClose={() => {}} />);
    expect(screen.getByTestId('cheatsheet-binding:tool.brush:0').textContent).toBe('B');
    act(() => {
      usePreferencesStore.getState().setHotkeyOverride('tool.brush', [{ key: 'q' }]);
    });
    expect(screen.getByTestId('cheatsheet-binding:tool.brush:0').textContent).toBe('Q');
  });

  it('clearing a binding ([]) removes the action from the cheatsheet', () => {
    render(<CheatsheetOverlay open onClose={() => {}} />);
    expect(screen.queryByTestId('cheatsheet-row:tool.brush')).not.toBeNull();
    act(() => {
      usePreferencesStore.getState().setHotkeyOverride('tool.brush', []);
    });
    expect(screen.queryByTestId('cheatsheet-row:tool.brush')).toBeNull();
  });

  it('Escape calls onClose', () => {
    const onClose = vi.fn();
    render(<CheatsheetOverlay open onClose={onClose} />);
    act(() => fireEvent.keyDown(window, { key: 'Escape' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('? again calls onClose (toggle)', () => {
    const onClose = vi.fn();
    render(<CheatsheetOverlay open onClose={onClose} />);
    act(() => fireEvent.keyDown(window, { key: '?' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('clicking the ✕ or scrim calls onClose', () => {
    const onClose = vi.fn();
    render(<CheatsheetOverlay open onClose={onClose} />);
    act(() => fireEvent.click(screen.getByTestId('cheatsheet-close')));
    act(() => fireEvent.click(screen.getByTestId('cheatsheet-scrim')));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('multi-binding actions render every binding chip', () => {
    // 'slice.prev' has two default bindings (ArrowUp + ArrowLeft).
    render(<CheatsheetOverlay open onClose={() => {}} />);
    expect(screen.queryByTestId('cheatsheet-binding:slice.prev:0')).not.toBeNull();
    expect(screen.queryByTestId('cheatsheet-binding:slice.prev:1')).not.toBeNull();
  });
});
