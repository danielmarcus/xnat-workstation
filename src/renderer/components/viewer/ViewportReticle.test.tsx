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
  it('draws the guide lines at the projected point when the Crosshairs tool is active and a point is set', () => {
    useViewerStore.setState({ activeTool: ToolName.Crosshairs });
    useViewerStore.getState().setCrosshairWorldPoint([1, 2, 3], 'panel_0');
    render(<ViewportReticle panelId="panel_0" />);
    expect(screen.getByTestId('viewport-reticle:panel_0')).toBeInTheDocument();
    expect(screen.getByTestId('reticle-h:panel_0')).toHaveStyle({ top: '240px' });
    expect(screen.getByTestId('reticle-v:panel_0')).toHaveStyle({ left: '120px' });
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
