import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolName } from '@shared/types/viewer';

// The reticle projects the world point via the geometry helper; mock it so the
// test controls the projected display point (the projection itself is unit-tested
// in unifiedCrosshair.test and pixel-confirmed on real data).
const getPanelDisplayPointForWorld = vi.fn();
vi.mock('../../lib/cornerstone/unifiedCrosshair', () => ({
  getPanelDisplayPointForWorld: (...a: unknown[]) => getPanelDisplayPointForWorld(...a),
}));

import ViewportReticle from './ViewportReticle';
import { useViewerStore } from '../../stores/viewerStore';

beforeEach(() => {
  useViewerStore.setState(useViewerStore.getInitialState(), true);
  useViewerStore.getState()._initPanel('panel_0');
  getPanelDisplayPointForWorld.mockReturnValue({ x: 120, y: 240, width: 512, height: 512 });
});
afterEach(() => vi.clearAllMocks());

describe('ViewportReticle', () => {
  it('draws gapped guide segments around the projected point (so the center pixel shows through)', () => {
    useViewerStore.setState({ activeTool: ToolName.Crosshairs });
    useViewerStore.getState().setCrosshairWorldPoint([1, 2, 3], 'panel_0');
    render(<ViewportReticle panelId="panel_0" />);
    expect(screen.getByTestId('viewport-reticle:panel_0')).toBeInTheDocument();
    // Point (120,240) in a 512×512 panel, GAP=12 ⇒ a 24px clear gap at the crossing.
    // Horizontal: left segment 0..108, right segment 132..512.
    expect(screen.getByTestId('reticle-h-left:panel_0')).toHaveStyle({ top: '240px', left: '0px', width: '108px' });
    expect(screen.getByTestId('reticle-h-right:panel_0')).toHaveStyle({ top: '240px', left: '132px', width: '380px' });
    // Vertical: top segment 0..228, bottom segment 252..512.
    expect(screen.getByTestId('reticle-v-top:panel_0')).toHaveStyle({ left: '120px', top: '0px', height: '228px' });
    expect(screen.getByTestId('reticle-v-bottom:panel_0')).toHaveStyle({ left: '120px', top: '252px', height: '260px' });
  });

  it('renders nothing when the Crosshairs tool is NOT active', () => {
    useViewerStore.setState({ activeTool: ToolName.Pan });
    useViewerStore.getState().setCrosshairWorldPoint([1, 2, 3], 'panel_0');
    render(<ViewportReticle panelId="panel_0" />);
    expect(screen.queryByTestId('viewport-reticle:panel_0')).toBeNull();
  });

  it('renders nothing when no crosshair point is set', () => {
    useViewerStore.setState({ activeTool: ToolName.Crosshairs });
    render(<ViewportReticle panelId="panel_0" />);
    expect(screen.queryByTestId('viewport-reticle:panel_0')).toBeNull();
  });

  it('renders nothing when the point projects off this panel', () => {
    getPanelDisplayPointForWorld.mockReturnValue(null);
    useViewerStore.setState({ activeTool: ToolName.Crosshairs });
    useViewerStore.getState().setCrosshairWorldPoint([1, 2, 3], 'panel_0');
    render(<ViewportReticle panelId="panel_0" />);
    expect(screen.queryByTestId('viewport-reticle:panel_0')).toBeNull();
  });
});
