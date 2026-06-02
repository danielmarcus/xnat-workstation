/**
 * Toolbox tests — spec §4.8.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import Toolbox from './Toolbox';
import { ToolName } from '@shared/types/viewer';
import { useContainerStore } from '../../../stores/containerStore';
import { useContainerSelectionStore } from '../../../stores/containerSelectionStore';
import { useViewerStore } from '../../../stores/viewerStore';
import { usePreferencesStore } from '../../../stores/preferencesStore';
import {
  ANNOTATION_PANEL_DEFAULT_WIDTH,
  ANNOTATION_PANEL_COMPACT_TOOLS_WIDTH,
} from '@shared/types/preferences';
import type { Container, Member } from '../../../types/annotation';

function makeMember(overrides: Partial<Member> = {}): Member {
  return {
    id: 'm1',
    name: 'Member 1',
    color: [120, 180, 220],
    visibility: 'filled',
    locked: false,
    roiType: null,
    provenance: 'manual',
    interpolationState: 'none',
    segmentIndex: 1,
    modifiedAt: 0,
    ...overrides,
  } as Member;
}

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'c1',
    name: 'Container 1',
    kind: 'SEG',
    members: [makeMember()],
    sourceIdentity: null,
    approval: { approved: false, reviewerName: null, reviewedAt: null, history: [] },
    dirty: false,
    saveInFlight: false,
    versionToken: null,
    parseError: null,
    a2cOptedIn: false,
    ...overrides,
  } as Container;
}

function seed(c: Container, activeMemberId: string | null = 'm1') {
  useContainerStore.getState()._replaceAll(new Map([[c.id, c]]));
  useContainerSelectionStore.getState().setActive(activeMemberId);
}

beforeEach(() => {
  usePreferencesStore.getState().setAnnotationPanelWidth(ANNOTATION_PANEL_DEFAULT_WIDTH);
  useViewerStore.setState({
    activeViewportId: 'panel_0',
    activeTool: ToolName.WindowLevel,
  } as Partial<ReturnType<typeof useViewerStore.getState>>);
});

afterEach(() => {
  useContainerStore.getState()._replaceAll(new Map());
  useContainerSelectionStore.getState().setActive(null);
});

describe('Toolbox (spec §4.8)', () => {
  it('empty state — no active member', () => {
    render(<Toolbox />);
    const tb = screen.getByTestId('toolbox');
    expect(tb.dataset.state).toBe('empty');
    expect(tb.textContent).toMatch(/Select or create an annotation/);
  });

  it('SEG container active → 21 buttons in the grid', () => {
    seed(makeContainer({ kind: 'SEG' }));
    render(<Toolbox />);
    expect(screen.getByTestId('toolbox').dataset.state).toBe('active');
    expect(screen.getByTestId('toolbox').dataset.toolboxKind).toBe('SEG');
    expect(screen.queryByTestId('toolbox-btn:brush')).not.toBeNull();
    // Spot-check a sample of the 21 entries.
    expect(screen.queryByTestId('toolbox-btn:bidir')).not.toBeNull();
    expect(screen.queryAllByTestId(/^toolbox-btn:/).length).toBe(21);
  });

  it('RTSTRUCT container active → STRUCT toolbox kind + 4 buttons', () => {
    seed(makeContainer({ kind: 'RTSTRUCT' }));
    render(<Toolbox />);
    expect(screen.getByTestId('toolbox').dataset.toolboxKind).toBe('STRUCT');
    expect(screen.queryAllByTestId(/^toolbox-btn:/).length).toBe(4);
  });

  it('POI container active → MEAS toolbox kind + 9 buttons', () => {
    seed(makeContainer({ kind: 'POI' }));
    render(<Toolbox />);
    expect(screen.getByTestId('toolbox').dataset.toolboxKind).toBe('MEAS');
    expect(screen.queryAllByTestId(/^toolbox-btn:/).length).toBe(9);
  });

  it('locked member → amber banner, no grid', () => {
    seed(makeContainer({ members: [makeMember({ locked: true, name: 'Tumor' })] }));
    render(<Toolbox />);
    const tb = screen.getByTestId('toolbox');
    expect(tb.dataset.state).toBe('locked');
    expect(tb.textContent).toMatch(/Active Tumor is locked/);
    expect(screen.queryAllByTestId(/^toolbox-btn:/).length).toBe(0);
  });

  it('off-panel state — caller resolver returns a different viewport list', () => {
    seed(makeContainer({ kind: 'SEG' }));
    render(<Toolbox getContainerPanelIds={() => ['panel_2', 'panel_3']} />);
    const tb = screen.getByTestId('toolbox');
    expect(tb.dataset.state).toBe('off-panel');
    expect(tb.textContent).toMatch(/Switch to panel_2, panel_3/);
    expect(screen.queryAllByTestId(/^toolbox-btn:/).length).toBe(0);
  });

  it('multi-panel pill appears when the resolver reports >1 panels', () => {
    seed(makeContainer({ kind: 'SEG' }));
    render(<Toolbox getContainerPanelIds={() => ['panel_0', 'panel_2']} />);
    expect(screen.queryByTestId('toolbox-multi-panel-pill')).not.toBeNull();
  });

  it('multi-panel pill is hidden when the container is only on one panel', () => {
    seed(makeContainer({ kind: 'SEG' }));
    render(<Toolbox getContainerPanelIds={() => ['panel_0']} />);
    expect(screen.queryByTestId('toolbox-multi-panel-pill')).toBeNull();
  });

  it('wired button click → setActiveTool fires with the entry tool name', () => {
    seed(makeContainer({ kind: 'SEG' }));
    render(<Toolbox />);
    act(() => {
      fireEvent.click(screen.getByTestId('toolbox-btn:brush'));
    });
    expect(useViewerStore.getState().activeTool).toBe(ToolName.Brush);
  });

  it('unwired button click is a no-op + the button is disabled', () => {
    seed(makeContainer({ kind: 'SEG' }));
    render(<Toolbox />);
    const dyn = screen.getByTestId('toolbox-btn:dyn-thresh') as HTMLButtonElement;
    expect(dyn.disabled).toBe(true);
    const before = useViewerStore.getState().activeTool;
    act(() => fireEvent.click(dyn));
    expect(useViewerStore.getState().activeTool).toBe(before);
  });

  it('active button picks up the "active" data flag when its tool is the active tool', () => {
    seed(makeContainer({ kind: 'SEG' }));
    useViewerStore.setState({ activeTool: ToolName.Brush } as Partial<ReturnType<typeof useViewerStore.getState>>);
    render(<Toolbox />);
    const btn = screen.getByTestId('toolbox-btn:brush');
    expect(btn.dataset.active).toBe('true');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('Controls section reflects the active tool family', () => {
    seed(makeContainer({ kind: 'SEG' }));
    // Brush family
    useViewerStore.setState({ activeTool: ToolName.Brush } as Partial<ReturnType<typeof useViewerStore.getState>>);
    const { rerender } = render(<Toolbox />);
    expect(screen.getByTestId('toolbox-controls').dataset.family).toBe('brush');
    // Threshold family
    useViewerStore.setState({ activeTool: ToolName.ThresholdBrush } as Partial<ReturnType<typeof useViewerStore.getState>>);
    rerender(<Toolbox />);
    expect(screen.getByTestId('toolbox-controls').dataset.family).toBe('threshold-range');
  });

  it('compact-tools threshold (< 210 px) sets data-compact-tools on the grid', () => {
    seed(makeContainer({ kind: 'SEG' }));
    const { rerender } = render(<Toolbox panelWidth={300} />);
    expect(screen.getByTestId('toolbox-grid').dataset.compactTools).toBeUndefined();
    rerender(<Toolbox panelWidth={ANNOTATION_PANEL_COMPACT_TOOLS_WIDTH - 1} />);
    expect(screen.getByTestId('toolbox-grid').dataset.compactTools).toBe('true');
  });

  it('header shows the type label + container name', () => {
    seed(makeContainer({ kind: 'RTSTRUCT', name: 'Heart contours' }));
    render(<Toolbox />);
    expect(screen.getByTestId('toolbox').textContent).toMatch(/Structure · Heart contours/);
  });

  it('active member name + color swatch are reflected in the Controls header', () => {
    seed(makeContainer({
      kind: 'SEG',
      members: [makeMember({ name: 'Liver', color: [220, 50, 50] })],
    }));
    render(<Toolbox />);
    const chip = screen.getByTestId('toolbox-controls-active-member');
    expect(chip.textContent).toMatch(/Liver/);
    const swatch = chip.querySelector('span[aria-hidden]') as HTMLSpanElement | null;
    expect(swatch?.style.backgroundColor).toBe('rgb(220, 50, 50)');
  });
});
