import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import {
  useBindingLabel,
  useHotkeyMap,
  useSuffixedTooltip,
  mergeHotkeyMap,
} from './useBindingLabel';
import { DEFAULT_HOTKEY_MAP } from './defaultHotkeyMap';
import { usePreferencesStore } from '../../stores/preferencesStore';

function Probe({ action }: { action: Parameters<typeof useBindingLabel>[0] }) {
  const label = useBindingLabel(action);
  return <span data-testid="probe">{label}</span>;
}

function TooltipProbe({ text, action }: { text: string; action: Parameters<typeof useSuffixedTooltip>[1] }) {
  const tip = useSuffixedTooltip(text, action);
  return <span data-testid="tip">{tip}</span>;
}

beforeEach(() => {
  usePreferencesStore.getState().resetAll();
});
afterEach(() => {
  usePreferencesStore.getState().resetAll();
});

describe('useBindingLabel', () => {
  it('returns the default first-binding label for an unmodified action', () => {
    render(<Probe action="tool.brush" />);
    expect(screen.getByTestId('probe').textContent).toBe('B');
  });

  it('returns "" when the action has no binding', () => {
    // 'tool.sculptor' is unbound in defaults.
    render(<Probe action="tool.sculptor" />);
    expect(screen.getByTestId('probe').textContent).toBe('');
  });

  it('re-renders when the user remaps the action via preferences', () => {
    render(<Probe action="tool.brush" />);
    expect(screen.getByTestId('probe').textContent).toBe('B');
    act(() => {
      usePreferencesStore.getState().setHotkeyOverride('tool.brush', [{ key: 'q' }]);
    });
    expect(screen.getByTestId('probe').textContent).toBe('Q');
  });

  it('clearing the override (`[]`) makes the label empty', () => {
    render(<Probe action="tool.brush" />);
    act(() => {
      usePreferencesStore.getState().setHotkeyOverride('tool.brush', []);
    });
    expect(screen.getByTestId('probe').textContent).toBe('');
  });

  it('resetHotkeys restores the default after a remap', () => {
    render(<Probe action="tool.brush" />);
    act(() => {
      usePreferencesStore.getState().setHotkeyOverride('tool.brush', [{ key: 'q' }]);
    });
    expect(screen.getByTestId('probe').textContent).toBe('Q');
    act(() => {
      usePreferencesStore.getState().resetHotkeys();
    });
    expect(screen.getByTestId('probe').textContent).toBe('B');
  });
});

describe('useSuffixedTooltip', () => {
  it('appends "(label)" when a binding exists', () => {
    render(<TooltipProbe text="Brush" action="tool.brush" />);
    expect(screen.getByTestId('tip').textContent).toBe('Brush (B)');
  });

  it('returns the bare text when the action is unbound', () => {
    render(<TooltipProbe text="Sculptor" action="tool.sculptor" />);
    expect(screen.getByTestId('tip').textContent).toBe('Sculptor');
  });

  it('updates live when the user remaps', () => {
    render(<TooltipProbe text="Brush" action="tool.brush" />);
    act(() => {
      usePreferencesStore.getState().setHotkeyOverride('tool.brush', [{ key: 'm' }]);
    });
    expect(screen.getByTestId('tip').textContent).toBe('Brush (M)');
  });
});

describe('useHotkeyMap', () => {
  function MapProbe() {
    const map = useHotkeyMap();
    return <span data-testid="map">{Object.keys(map).length}</span>;
  }
  it('returns a map containing every default action', () => {
    render(<MapProbe />);
    expect(Number(screen.getByTestId('map').textContent)).toBe(Object.keys(DEFAULT_HOTKEY_MAP).length);
  });
});

describe('mergeHotkeyMap', () => {
  it('returns base unchanged for an empty override', () => {
    const merged = mergeHotkeyMap(DEFAULT_HOTKEY_MAP, {});
    expect(merged).toEqual(DEFAULT_HOTKEY_MAP);
    expect(merged).not.toBe(DEFAULT_HOTKEY_MAP); // shallow-cloned
  });

  it('replaces a single action when overridden', () => {
    const merged = mergeHotkeyMap(DEFAULT_HOTKEY_MAP, {
      'tool.brush': [{ key: 'q' }],
    });
    expect(merged['tool.brush']).toEqual([{ key: 'q' }]);
    expect(merged['tool.pan']).toEqual(DEFAULT_HOTKEY_MAP['tool.pan']);
  });

  it('clears a binding when override is []', () => {
    const merged = mergeHotkeyMap(DEFAULT_HOTKEY_MAP, { 'tool.brush': [] });
    expect(merged['tool.brush']).toEqual([]);
  });
});
