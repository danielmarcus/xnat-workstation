import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { FitLabel } from '../FitLabel';

/** jsdom has no layout: stub the full label's width and the space it has. */
function widths(full: number, box: number) {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(full);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(box);
}

describe('FitLabel', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows the full label when it fits', () => {
    widths(60, 80);
    const { container } = render(<FitLabel label="Rectangle" short="Rect" />);
    expect(container.textContent).toBe('RectangleRectangle'); // the invisible measuring copy + the label
  });

  it('abbreviates only when the full label would be cut off', () => {
    widths(60, 40);
    const { container } = render(<FitLabel label="Rectangle" short="Rect" />);
    expect(container.textContent).toBe('RectangleRect');
  });

  it('never abbreviates a label without a short form', () => {
    widths(60, 40);
    const { container } = render(<FitLabel label="Circle" />);
    expect(container.textContent).toBe('Circle');
  });
});
