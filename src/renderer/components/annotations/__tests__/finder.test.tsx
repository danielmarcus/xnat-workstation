import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { findEntries, finderEntries } from '../finder';
import ToolFinder from '../ToolFinder';

/** annotation-panel-modes R4-A: the ⌘K finder. */
describe('finder entries', () => {
  const seg = finderEntries('SEG');
  const top = (q: string) => findEntries(seg, q)[0];

  it('finds a mode by the tool name it had before the families', () => {
    expect(top('threshold')).toMatchObject({ label: 'Brush · 2D · Window', target: { kind: 'tool', toolId: 'threshold' } });
    expect(top('sph. thresh')).toMatchObject({ target: { toolId: 'sphereThreshold' } });
    expect(top('rect multi')).toMatchObject({ label: 'Shape · Rect · Window', target: { toolId: 'rectMulti' } });
    expect(top('region+')).toMatchObject({ target: { toolId: 'regionPlus' } });
  });

  it('finds the moved-out tools where they went', () => {
    expect(top('random walker')).toMatchObject({ target: { kind: 'operation', operationId: 'seeded', seededMethod: 'randomWalker' } });
    expect(top('seg bidir')).toMatchObject({ target: { kind: 'measureSegment' } });
    expect(top('roi')).toMatchObject({ target: { kind: 'tool', toolId: 'roiLimit' } });
  });

  it('finds operations and modules, and ranks a label match above an alias match', () => {
    const withModule = finderEntries('SEG', [{ id: 'module:t', label: 'Intensity threshold', title: 'x', group: 'Modules' }]);
    expect(findEntries(withModule, 'intensity')[0]).toMatchObject({ target: { operationId: 'module:t' } });
    expect(findEntries(seg, 'interp')[0]).toMatchObject({ label: 'Interpolate', hint: 'Operation · Fill in' });
    // "Brush" starts the Brush modes' labels; Smart Brush (an alias of Brush · Edges) is not first.
    expect(findEntries(seg, 'brush')[0].label.startsWith('Brush')).toBe(true);
  });

  it('other kinds find their own tools only', () => {
    const sr = finderEntries('SR');
    expect(findEntries(sr, 'length')[0]).toMatchObject({ target: { toolId: 'length' } });
    expect(findEntries(sr, 'cleanup')).toEqual([]);
  });
});

describe('extension commands in the finder (extension framework X2, wireframe E6)', () => {
  const commands = [
    { extId: 'org.example.notes', extName: 'Session notes', id: 'next', title: 'Next note', action: 'ext:org.example.notes:next' as const, run: () => {} },
    { extId: 'org.example.notes', extName: 'Session notes', id: 'add', title: 'Add note', action: 'ext:org.example.notes:add' as const, run: () => {} },
  ];
  it('are listed for every annotation type, named with their extension, found by title or extension', () => {
    for (const kind of ['SEG', 'RTSTRUCT', 'SR'] as const) {
      const entries = finderEntries(kind, [], commands);
      expect(entries.find((e) => e.id === 'ext:org.example.notes:next')).toMatchObject({
        label: 'Next note', hint: 'Session notes', target: { kind: 'command', extId: 'org.example.notes', commandId: 'next' },
      });
    }
    const entries = finderEntries('SEG', [], commands);
    expect(findEntries(entries, 'note').map((e) => e.label).slice(0, 2)).toEqual(['Next note', 'Add note']);
    expect(findEntries(entries, 'session notes').map((e) => e.label)).toEqual(['Next note', 'Add note']);
  });
});

describe('ToolFinder', () => {
  it('typing filters, ↓ moves, ⏎ picks; ⎋ closes', () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    const entries = finderEntries('SEG');
    render(<ToolFinder entries={entries} onPick={onPick} onClose={onClose} />);
    const input = screen.getByRole('textbox', { name: 'Find a tool or operation' });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'brush' } });
    const options = screen.getAllByRole('option');
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(options.length).toBeGreaterThan(1);
    expect(onPick).toHaveBeenCalledWith(findEntries(entries, 'brush')[1]);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
