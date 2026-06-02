import { describe, expect, it } from 'vitest';
import {
  formatBinding,
  formatActionBinding,
  formatKey,
  suffixTooltip,
} from './format';
import type { HotkeyMap } from '@shared/types/hotkeys';

describe('formatKey', () => {
  it('uppercases letter keys', () => {
    expect(formatKey('b')).toBe('B');
    expect(formatKey('z')).toBe('Z');
  });
  it('passes function keys through', () => {
    expect(formatKey('F1')).toBe('F1');
  });
  it('substitutes special key labels', () => {
    expect(formatKey('ArrowUp')).toBe('↑');
    expect(formatKey('Escape')).toBe('Esc');
    expect(formatKey(' ')).toBe('Space');
    expect(formatKey('PageDown')).toBe('PgDn');
  });
});

describe('formatBinding', () => {
  it('plain key — letter rendered uppercase, no modifiers', () => {
    expect(formatBinding({ key: 'b' }, false)).toBe('B');
    expect(formatBinding({ key: 'b' }, true)).toBe('B');
  });

  it('non-Mac uses "+" separators and "Ctrl"/"Alt" labels', () => {
    expect(formatBinding({ key: 'z', modifiers: { ctrl: true } }, false)).toBe('Ctrl+Z');
    expect(formatBinding({ key: 'r', modifiers: { shift: true } }, false)).toBe('⇧+R');
    expect(
      formatBinding({ key: 'z', modifiers: { ctrl: true, shift: true } }, false),
    ).toBe('Ctrl+⇧+Z');
  });

  it('Mac uses contiguous glyphs and ⌘ for meta', () => {
    expect(formatBinding({ key: 'z', modifiers: { meta: true } }, true)).toBe('⌘Z');
    expect(
      formatBinding({ key: 'z', modifiers: { meta: true, shift: true } }, true),
    ).toBe('⌘⇧Z');
    expect(
      formatBinding({ key: 'a', modifiers: { alt: true } }, true),
    ).toBe('⌥A');
  });

  it('Meta on non-Mac reads as "Ctrl"', () => {
    expect(
      formatBinding({ key: 'z', modifiers: { meta: true } }, false),
    ).toBe('Ctrl+Z');
  });

  it('empty / null binding → empty string', () => {
    expect(formatBinding(null, false)).toBe('');
    expect(formatBinding(undefined, false)).toBe('');
    expect(formatBinding({ key: '' }, false)).toBe('');
  });
});

describe('formatActionBinding', () => {
  const map: HotkeyMap = {
    'tool.brush': [{ key: 'b' }],
    'edit.undo': [{ key: 'z', modifiers: { meta: true } }],
    'slice.prev': [{ key: 'ArrowUp' }, { key: 'ArrowLeft' }],
  };

  it('returns the first binding label', () => {
    expect(formatActionBinding('tool.brush', map, true)).toBe('B');
    expect(formatActionBinding('edit.undo', map, true)).toBe('⌘Z');
    expect(formatActionBinding('slice.prev', map, true)).toBe('↑');
  });

  it('returns "" when the action is missing or has no bindings', () => {
    expect(formatActionBinding('tool.pan', map, true)).toBe('');
    expect(formatActionBinding('tool.brush', { 'tool.brush': [] }, true)).toBe('');
  });
});

describe('suffixTooltip', () => {
  const map: HotkeyMap = { 'tool.brush': [{ key: 'b' }] };
  it('appends "(label)" when a binding exists', () => {
    expect(suffixTooltip('Brush', 'tool.brush', map, false)).toBe('Brush (B)');
  });
  it('returns the bare text when the action has no binding', () => {
    expect(suffixTooltip('Settings', 'tool.pan', map, false)).toBe('Settings');
  });
});
