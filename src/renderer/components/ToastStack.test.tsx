/**
 * <ToastStack /> tests (MV-Phase 7.2, spec §11).
 *
 * Covers: renders nothing when empty, renders each kind with the correct
 * ARIA role + live region, click dismisses, hover pause + resume,
 * action button invokes onClick and dismisses, stack cap honored.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
  __resetToastIdCounterForTests,
  toastService,
  useToastStore,
} from '../lib/toast/toastService';
import ToastStack from './ToastStack';

beforeEach(() => {
  useToastStore.getState().clearAll();
  __resetToastIdCounterForTests();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('<ToastStack />', () => {
  it('renders no toast items when the store is empty', () => {
    render(<ToastStack />);
    expect(screen.getByTestId('toast-stack').children).toHaveLength(0);
  });

  it('renders one toast per notify call', () => {
    render(<ToastStack />);
    act(() => {
      toastService.notify({ kind: 'success', message: 'Saved' });
      toastService.notify({ kind: 'info', message: 'Loaded' });
    });
    const stack = screen.getByTestId('toast-stack');
    expect(stack.children).toHaveLength(2);
    expect(screen.getByText('Saved')).toBeTruthy();
    expect(screen.getByText('Loaded')).toBeTruthy();
  });

  it('newest toast renders first (top)', () => {
    render(<ToastStack />);
    act(() => {
      toastService.notify({ kind: 'info', message: 'first' });
      toastService.notify({ kind: 'info', message: 'second' });
    });
    const stack = screen.getByTestId('toast-stack');
    expect(stack.children[0].textContent).toContain('second');
    expect(stack.children[1].textContent).toContain('first');
  });

  it('renders the detail line when provided', () => {
    render(<ToastStack />);
    act(() => {
      toastService.notify({ kind: 'success', message: 'Saved', detail: 'to scan #3004' });
    });
    expect(screen.getByText('to scan #3004')).toBeTruthy();
  });

  it('uses aria-live="polite" + role="status" for success and info', () => {
    render(<ToastStack />);
    act(() => {
      toastService.notify({ kind: 'success', message: 'A' });
      toastService.notify({ kind: 'info', message: 'B' });
    });
    const items = screen.getByTestId('toast-stack').querySelectorAll('[data-toast-id]');
    items.forEach((el) => {
      expect(el.getAttribute('aria-live')).toBe('polite');
      expect(el.getAttribute('role')).toBe('status');
    });
  });

  it('uses aria-live="assertive" + role="alert" for warning and error', () => {
    render(<ToastStack />);
    act(() => {
      toastService.notify({ kind: 'warning', message: 'W' });
      toastService.notify({ kind: 'error', message: 'E' });
    });
    const items = screen.getByTestId('toast-stack').querySelectorAll('[data-toast-id]');
    items.forEach((el) => {
      expect(el.getAttribute('aria-live')).toBe('assertive');
      expect(el.getAttribute('role')).toBe('alert');
    });
  });

  it('clicking a toast dismisses it', () => {
    render(<ToastStack />);
    act(() => {
      toastService.notify({ kind: 'info', message: 'Hello' });
    });
    expect(useToastStore.getState().toasts).toHaveLength(1);
    const item = screen.getByTestId('toast-stack').firstElementChild as HTMLElement;
    fireEvent.click(item);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('hover pauses the auto-dismiss timer; mouseleave resumes it', () => {
    render(<ToastStack />);
    act(() => {
      toastService.notify({ kind: 'success', message: 'A' }); // 3000 ms
    });
    const item = screen.getByTestId('toast-stack').firstElementChild as HTMLElement;

    act(() => { vi.advanceTimersByTime(1000); });
    fireEvent.mouseEnter(item);
    expect(useToastStore.getState().toasts[0].remainingMs).toBe(2000);

    act(() => { vi.advanceTimersByTime(10_000); });
    expect(useToastStore.getState().toasts).toHaveLength(1); // paused

    fireEvent.mouseLeave(item);
    expect(useToastStore.getState().toasts[0].remainingMs).toBeNull();

    act(() => { vi.advanceTimersByTime(2000); });
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('action button invokes onClick AND dismisses the toast', () => {
    const onAction = vi.fn();
    render(<ToastStack />);
    act(() => {
      toastService.notify({
        kind: 'error',
        message: 'Upload failed',
        action: { label: 'Retry', onClick: onAction },
      });
    });

    const button = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(button);

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('action button click does not also fire the toast-dismiss click', () => {
    // The button's onClick calls stopPropagation; without it, the parent
    // toast div's onClick would dismiss BEFORE the action runs and the
    // toast click handler would double-dismiss.
    const onAction = vi.fn();
    render(<ToastStack />);
    act(() => {
      toastService.notify({
        kind: 'info',
        message: 'Saved',
        action: { label: 'Undo', onClick: onAction },
      });
    });
    const button = screen.getByRole('button', { name: 'Undo' });
    fireEvent.click(button);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('stack cap keeps at most 3 items visible (oldest dropped FIFO)', () => {
    render(<ToastStack />);
    act(() => {
      toastService.notify({ kind: 'info', message: '1' });
      toastService.notify({ kind: 'info', message: '2' });
      toastService.notify({ kind: 'info', message: '3' });
      toastService.notify({ kind: 'info', message: '4' });
    });
    const stack = screen.getByTestId('toast-stack');
    expect(stack.children).toHaveLength(3);
    // Newest first, oldest survivor last.
    expect(stack.textContent).toContain('4');
    expect(stack.textContent).toContain('3');
    expect(stack.textContent).toContain('2');
    expect(stack.textContent).not.toContain('1');
  });
});
