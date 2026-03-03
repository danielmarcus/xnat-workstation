import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

function ToggleChip() {
  const [enabled, setEnabled] = useState(false);
  return (
    <button type="button" onClick={() => setEnabled((v) => !v)}>
      {enabled ? 'Enabled' : 'Disabled'}
    </button>
  );
}

describe('renderer sample test', () => {
  it('updates state on click', async () => {
    const user = userEvent.setup();
    render(<ToggleChip />);

    const button = screen.getByRole('button', { name: 'Disabled' });
    expect(button).toHaveTextContent('Disabled');

    await user.click(button);
    expect(button).toHaveTextContent('Enabled');
  });
});
