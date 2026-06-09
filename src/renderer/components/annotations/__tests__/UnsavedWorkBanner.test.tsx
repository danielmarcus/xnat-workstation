import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UnsavedWorkBanner } from '../UnsavedWorkBanner';

/**
 * L3 unsaved-work banner (presentational). The connected container's live-store
 * selection is exercised end-to-end in the Electron E2E (spec 38); here we pin the
 * render contract: the banner shows the retained-session summary, pluralizes, and
 * dismisses; an empty summary renders nothing.
 */
describe('UnsavedWorkBanner', () => {
  it('renders nothing when there is no retained unsaved work', () => {
    const { container } = render(<UnsavedWorkBanner sessions={[]} onDismiss={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('summarizes counts across sessions and resolves friendly labels', () => {
    render(
      <UnsavedWorkBanner
        sessions={[{ sessionId: 'E1', count: 2 }, { sessionId: 'E2', count: 1 }]}
        sessionLabelOf={(id) => (id === 'E1' ? 'CT Brain' : undefined)}
        onDismiss={vi.fn()}
      />,
    );
    const banner = screen.getByTestId('unsaved-work-banner');
    expect(banner).toHaveTextContent('3 unsaved annotations retained in 2 other sessions');
    expect(banner).toHaveTextContent('CT Brain'); // label resolved
    expect(banner).toHaveTextContent('E2'); // falls back to id
  });

  it('uses singular wording for one session / one annotation', () => {
    render(<UnsavedWorkBanner sessions={[{ sessionId: 'E1', count: 1 }]} onDismiss={vi.fn()} />);
    expect(screen.getByTestId('unsaved-work-banner')).toHaveTextContent(
      '1 unsaved annotation retained in 1 other session',
    );
  });

  it('dismiss fires the callback', () => {
    const onDismiss = vi.fn();
    render(<UnsavedWorkBanner sessions={[{ sessionId: 'E1', count: 1 }]} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss unsaved-work banner' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
