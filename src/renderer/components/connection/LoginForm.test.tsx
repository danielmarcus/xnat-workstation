import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LoginForm from './LoginForm';
import { useConnectionStore } from '../../stores/connectionStore';
import { useOpenLinkStore } from '../../stores/openLinkStore';

const STORAGE_KEY = 'xnat-viewer:recent-connections';

function resetConnectionStore(): void {
  useConnectionStore.setState(useConnectionStore.getInitialState(), true);
}

describe('LoginForm', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    resetConnectionStore();
    useOpenLinkStore.setState({ pending: null });
    useConnectionStore.setState({
      ...useConnectionStore.getState(),
      status: 'disconnected',
      error: null,
      browserLogin: vi.fn(async () => true),
    });
  });

  it('prefills the most-recent server and supports dropdown selection', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { serverUrl: 'xnat-old.example', lastUsed: 1 },
        { serverUrl: 'xnat-new.example', lastUsed: 999 },
      ]),
    );

    render(<LoginForm />);

    const input = screen.getByLabelText('Server') as HTMLInputElement;
    expect(input.value).toBe('xnat-new.example');

    await user.click(screen.getByTitle('Recent connections'));
    await user.click(screen.getByRole('button', { name: /xnat-old\.example/i }));
    expect(input.value).toBe('xnat-old.example');
  });

  it('a link waiting for sign-in prefills its server over the recent one, and says why', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([{ serverUrl: 'https://xnat-new.example', lastUsed: 999 }]));
    useOpenLinkStore.setState({ pending: { server: 'https://linked.example.org', project: 'P1', session: 'E1' } });

    render(<LoginForm />);

    expect((screen.getByLabelText('Server') as HTMLInputElement).value).toBe('https://linked.example.org');
    expect(screen.getByTestId('login-link-hint')).toHaveTextContent('Sign in to open the linked session.');
  });

  it('without a waiting link there is no hint', () => {
    render(<LoginForm />);
    expect(screen.queryByTestId('login-link-hint')).toBeNull();
  });

  it('normalizes URL on submit and saves successful login in recent connections', async () => {
    const user = userEvent.setup();
    const browserLogin = vi.fn(async () => true);
    useConnectionStore.setState({
      ...useConnectionStore.getState(),
      browserLogin,
    });

    render(<LoginForm />);
    const input = screen.getByLabelText('Server');
    await user.clear(input);
    await user.type(input, 'xnat.example.com/');
    await user.click(screen.getByRole('button', { name: 'Sign In with XNAT' }));

    expect(browserLogin).toHaveBeenCalledWith('https://xnat.example.com');
    const recent = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    expect(recent[0]?.serverUrl).toBe('https://xnat.example.com');
  });

  it('warns for insecure HTTP (except localhost) and does not save on failed login', async () => {
    const user = userEvent.setup();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const browserLogin = vi.fn(async () => false);
    useConnectionStore.setState({
      ...useConnectionStore.getState(),
      browserLogin,
    });

    render(<LoginForm />);
    const input = screen.getByLabelText('Server');
    await user.clear(input);
    await user.type(input, 'http://prod.example');
    await user.click(screen.getByRole('button', { name: 'Sign In with XNAT' }));

    expect(browserLogin).toHaveBeenCalledWith('http://prod.example');
    expect(warnSpy).toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    warnSpy.mockRestore();
  });

  it('closes recent dropdown on outside click', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ serverUrl: 'xnat.example', lastUsed: 10 }]),
    );
    render(<LoginForm />);

    await user.click(screen.getByTitle('Recent connections'));
    expect(screen.getByText('Recent Servers')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('Recent Servers')).not.toBeInTheDocument();
  });

  it('says to continue in the browser while browser sign-in waits, with a way to cancel', async () => {
    const user = userEvent.setup();
    const cancelLogin = vi.fn(async () => undefined);
    useConnectionStore.setState({
      ...useConnectionStore.getState(),
      status: 'connecting',
      loginHost: 'idp.example.org',
      cancelLogin,
    });

    render(<LoginForm />);

    expect(screen.getByText('Continue in your browser')).toBeInTheDocument();
    expect(screen.getByText(/Sign in at idp\.example\.org/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(cancelLogin).toHaveBeenCalledTimes(1);
  });

  it('offers the XNAT login window after a failed browser sign-in', async () => {
    const user = userEvent.setup();
    const browserLogin = vi.fn(async () => true);
    useConnectionStore.setState({
      ...useConnectionStore.getState(),
      status: 'error',
      error: 'Sign-in timed out.',
      canUseLoginWindow: true,
      browserLogin,
    });

    render(<LoginForm />);
    const input = screen.getByLabelText('Server');
    await user.clear(input);
    await user.type(input, 'xnat.example.com');
    await user.click(screen.getByRole('button', { name: 'Use the XNAT login window instead' }));

    expect(browserLogin).toHaveBeenCalledWith('https://xnat.example.com', { useLoginWindow: true });
  });
});
