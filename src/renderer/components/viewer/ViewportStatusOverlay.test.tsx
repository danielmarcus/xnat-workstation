import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ViewportStatusOverlay from './ViewportStatusOverlay';

describe('ViewportStatusOverlay', () => {
  it('shows a spinner while loading', () => {
    render(<ViewportStatusOverlay panelId="panel_0" state="loading" />);
    expect(screen.getByTestId('viewport-status:panel_0')).toBeInTheDocument();
    expect(screen.getByTestId('viewport-loading:panel_0')).toBeInTheDocument();
    expect(screen.queryByTestId('viewport-error:panel_0')).toBeNull();
  });

  it('shows a failure message on error', () => {
    render(<ViewportStatusOverlay panelId="panel_0" state="error" />);
    expect(screen.getByTestId('viewport-error:panel_0')).toHaveTextContent('Failed to load');
    expect(screen.queryByTestId('viewport-loading:panel_0')).toBeNull();
  });

  it('renders nothing once ready', () => {
    render(<ViewportStatusOverlay panelId="panel_0" state="ready" />);
    expect(screen.queryByTestId('viewport-status:panel_0')).toBeNull();
  });
});
