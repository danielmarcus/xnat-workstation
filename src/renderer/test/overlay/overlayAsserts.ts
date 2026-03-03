import { expect } from 'vitest';
import { screen } from '@testing-library/react';

export function expectOverlayVisible(panelId: string): void {
  expect(screen.getByTestId(`viewport-overlay:${panelId}`)).toBeInTheDocument();
}

export function expectOverlayHidden(panelId: string): void {
  expect(screen.queryByTestId(`viewport-overlay:${panelId}`)).not.toBeInTheDocument();
}

export function expectOverlayContains(text: string | RegExp): void {
  expect(screen.getByText(text)).toBeInTheDocument();
}
