import { beforeEach, describe, expect, it } from 'vitest';
import {
  showAlertDialog,
  showConfirmDialog,
  useDialogStore,
} from './dialogStore';

function resetStore(): void {
  useDialogStore.setState(useDialogStore.getInitialState(), true);
}

describe('useDialogStore', () => {
  beforeEach(() => {
    resetStore();
  });

  it('enqueues first dialog as active and queues subsequent dialogs', () => {
    const first = showConfirmDialog({ message: 'First?' });
    const second = showConfirmDialog({ message: 'Second?' });
    const state = useDialogStore.getState();

    expect(state.active?.message).toBe('First?');
    expect(state.queue).toHaveLength(1);
    expect(state.queue[0]?.message).toBe('Second?');

    state.resolveActive(true);
    state.resolveActive(false);

    return Promise.all([
      expect(first).resolves.toBe(true),
      expect(second).resolves.toBe(false),
    ]);
  });

  it('uses default labels and title for confirm dialogs', async () => {
    const pending = showConfirmDialog({ message: 'Delete item?' });
    const active = useDialogStore.getState().active;

    expect(active).not.toBeNull();
    expect(active?.title).toBe('Confirm Action');
    expect(active?.confirmLabel).toBe('Confirm');
    expect(active?.cancelLabel).toBe('Cancel');
    expect(active?.tone).toBe('default');

    useDialogStore.getState().resolveActive(true);
    await expect(pending).resolves.toBe(true);
  });

  it('resolves alert dialogs and handles resolveActive no-op', async () => {
    useDialogStore.getState().resolveActive(false);
    expect(useDialogStore.getState().active).toBeNull();

    const pending = showAlertDialog({ message: 'Saved.' });
    const active = useDialogStore.getState().active;
    expect(active?.kind).toBe('alert');
    expect(active?.title).toBe('Notice');
    expect(active?.confirmLabel).toBe('OK');

    useDialogStore.getState().resolveActive(true);
    await expect(pending).resolves.toBeUndefined();
  });
});
