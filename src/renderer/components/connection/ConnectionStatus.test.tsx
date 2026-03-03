import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ConnectionStatus from './ConnectionStatus';
import { useConnectionStore } from '../../stores/connectionStore';
import { useSegmentationStore } from '../../stores/segmentationStore';

const mocks = vi.hoisted(() => ({
  hasDirtySegmentations: vi.fn(() => false),
  flushAutoSaveNow: vi.fn(async () => true),
  clearServerScopedStorage: vi.fn(),
  showConfirmDialog: vi.fn(async () => true),
}));

vi.mock('../../lib/segmentation/segmentationManagerSingleton', () => ({
  segmentationManager: {
    hasDirtySegmentations: mocks.hasDirtySegmentations,
  },
}));

vi.mock('../../lib/cornerstone/segmentationService', () => ({
  segmentationService: {
    flushAutoSaveNow: mocks.flushAutoSaveNow,
  },
}));

vi.mock('../../lib/pinnedItems', () => ({
  clearServerScopedStorage: mocks.clearServerScopedStorage,
}));

vi.mock('../../stores/dialogStore', () => ({
  showConfirmDialog: mocks.showConfirmDialog,
}));

function resetStores(): void {
  useConnectionStore.setState(useConnectionStore.getInitialState(), true);
  useSegmentationStore.setState(useSegmentationStore.getInitialState(), true);
}

describe('ConnectionStatus', () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
    useConnectionStore.setState({
      ...useConnectionStore.getState(),
      connection: {
        serverUrl: 'https://xnat.example.com',
        username: 'dan',
        connectedAt: Date.now(),
      },
      status: 'connected',
      logout: vi.fn(async () => {}),
    });
  });

  it('renders hostname and username when connected', () => {
    render(<ConnectionStatus />);
    expect(screen.getByText('xnat.example.com')).toBeInTheDocument();
    expect(screen.getByText('dan')).toBeInTheDocument();
  });

  it('disconnects immediately when there are no unsaved changes', async () => {
    const user = userEvent.setup();
    const logout = vi.fn(async () => {});
    useConnectionStore.setState({
      ...useConnectionStore.getState(),
      logout,
    });
    useSegmentationStore.setState({
      ...useSegmentationStore.getState(),
      hasUnsavedChanges: false,
    });
    mocks.hasDirtySegmentations.mockReturnValue(false);

    render(<ConnectionStatus />);
    await user.click(screen.getByTitle('Disconnect from XNAT'));

    expect(mocks.showConfirmDialog).not.toHaveBeenCalled();
    expect(mocks.clearServerScopedStorage).not.toHaveBeenCalled();
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('handles unsaved-save-draft failure with stay-connected path', async () => {
    const user = userEvent.setup();
    const logout = vi.fn(async () => {});
    useConnectionStore.setState({
      ...useConnectionStore.getState(),
      logout,
    });
    useSegmentationStore.setState({
      ...useSegmentationStore.getState(),
      hasUnsavedChanges: true,
    });
    mocks.hasDirtySegmentations.mockReturnValue(false);
    mocks.showConfirmDialog
      .mockResolvedValueOnce(true) // Save Draft
      .mockResolvedValueOnce(false); // Stay Connected after save failure
    mocks.flushAutoSaveNow.mockResolvedValueOnce(false);

    render(<ConnectionStatus />);
    await user.click(screen.getByTitle('Disconnect from XNAT'));

    expect(mocks.flushAutoSaveNow).toHaveBeenCalledTimes(1);
    expect(logout).not.toHaveBeenCalled();
    expect(mocks.clearServerScopedStorage).not.toHaveBeenCalled();
  });

  it('handles unsaved-discard confirmation path', async () => {
    const user = userEvent.setup();
    const logout = vi.fn(async () => {});
    useConnectionStore.setState({
      ...useConnectionStore.getState(),
      logout,
    });
    useSegmentationStore.setState({
      ...useSegmentationStore.getState(),
      hasUnsavedChanges: true,
    });
    mocks.hasDirtySegmentations.mockReturnValue(true);
    mocks.showConfirmDialog
      .mockResolvedValueOnce(false) // Discard branch
      .mockResolvedValueOnce(true); // Confirm discard disconnect

    render(<ConnectionStatus />);
    await user.click(screen.getByTitle('Disconnect from XNAT'));

    expect(mocks.showConfirmDialog).toHaveBeenCalledTimes(2);
    expect(logout).toHaveBeenCalledTimes(1);
    expect(mocks.clearServerScopedStorage).not.toHaveBeenCalled();
  });
});
