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
    expect(top('rect threshold')).toMatchObject({ label: 'Shape · Rect · Window', target: { toolId: 'rectThreshold' } });
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
