import { describe, expect, it } from 'vitest';
import {
  bindingsCollide,
  bindingToken,
  findConflictingActions,
} from './conflicts';
import type { HotkeyMap } from '@shared/types/hotkeys';

describe('bindingToken', () => {
  it('produces stable strings regardless of modifier object order', () => {
    expect(bindingToken({ key: 'z', modifiers: { ctrl: true, shift: true } }))
      .toBe(bindingToken({ key: 'z', modifiers: { shift: true, ctrl: true } }));
  });

  it('discriminates by modifier set', () => {
    expect(bindingToken({ key: 'z', modifiers: { ctrl: true } }))
      .not.toBe(bindingToken({ key: 'z' }));
  });
});

describe('bindingsCollide', () => {
  it('plain letter bindings collide when keys match', () => {
    expect(bindingsCollide({ key: 'b' }, { key: 'b' })).toBe(true);
    expect(bindingsCollide({ key: 'b' }, { key: 'p' })).toBe(false);
  });

  it('different modifier sets do NOT collide', () => {
    expect(bindingsCollide({ key: 'b' }, { key: 'b', modifiers: { ctrl: true } })).toBe(false);
    expect(
      bindingsCollide(
        { key: 'z', modifiers: { ctrl: true } },
        { key: 'z', modifiers: { ctrl: true, shift: true } },
      ),
    ).toBe(false);
  });

  it('same modifier set collides regardless of property order', () => {
    expect(
      bindingsCollide(
        { key: 'z', modifiers: { ctrl: true, shift: true } },
        { key: 'z', modifiers: { shift: true, ctrl: true } },
      ),
    ).toBe(true);
  });
});

describe('findConflictingActions (spec §8.3)', () => {
  const map: HotkeyMap = {
    'tool.brush': [{ key: 'b' }],
    'tool.pan':   [{ key: 'p' }],
    'edit.undo':  [{ key: 'z', modifiers: { ctrl: true } }],
    'slice.prev': [{ key: 'ArrowUp' }, { key: 'ArrowLeft' }],
  };

  it('returns conflicting actions for an in-use key', () => {
    expect(findConflictingActions(map, { key: 'b' }, null)).toEqual(['tool.brush']);
  });

  it('different modifier set is not a conflict', () => {
    expect(findConflictingActions(map, { key: 'z' }, null)).toEqual([]);
  });

  it('same-action remap (exceptAction) is filtered out', () => {
    expect(findConflictingActions(map, { key: 'b' }, 'tool.brush')).toEqual([]);
  });

  it('matches when any of the action\'s bindings collide', () => {
    expect(findConflictingActions(map, { key: 'ArrowLeft' }, null)).toEqual(['slice.prev']);
    expect(findConflictingActions(map, { key: 'ArrowUp' }, null)).toEqual(['slice.prev']);
  });

  it('multiple conflicting actions are all returned', () => {
    const m: HotkeyMap = {
      'tool.brush': [{ key: 'q' }],
      'tool.pan':   [{ key: 'q' }],
    };
    expect(findConflictingActions(m, { key: 'q' }, null).sort())
      .toEqual(['tool.brush', 'tool.pan']);
  });

  it('empty candidate key → no conflicts', () => {
    expect(findConflictingActions(map, { key: '' }, null)).toEqual([]);
  });

  it('absent action in map → no conflicts (no crash)', () => {
    const m: HotkeyMap = { 'tool.brush': undefined as any };
    expect(findConflictingActions(m, { key: 'b' }, null)).toEqual([]);
  });
});
