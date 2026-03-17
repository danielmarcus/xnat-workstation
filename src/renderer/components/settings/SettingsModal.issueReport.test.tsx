import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsModal from './SettingsModal';
import { usePreferencesStore } from '../../stores/preferencesStore';

const buildIssueReportMock = vi.fn<(notes: string) => Promise<string>>();
const clipboardWriteTextMock = vi.fn(async () => undefined);

vi.mock('../../lib/diagnostics/issueReport', () => ({
  buildIssueReport: (notes: string) => buildIssueReportMock(notes),
}));

function resetPreferencesStore(): void {
  usePreferencesStore.setState(usePreferencesStore.getInitialState(), true);
}

function getIssueTextareas(): { notes: HTMLTextAreaElement; report: HTMLTextAreaElement } {
  const areas = screen.getAllByRole('textbox') as HTMLTextAreaElement[];
  return { notes: areas[0], report: areas[areas.length - 1] };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('SettingsModal issue report panel', () => {
  beforeEach(() => {
    resetPreferencesStore();
    buildIssueReportMock.mockReset();
    clipboardWriteTextMock.mockClear();

    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {} as any,
    });

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      writable: true,
      value: {
        writeText: clipboardWriteTextMock,
      },
    });
  });

  it('auto-generates a report on tab open and enables copy once loaded', async () => {
    const user = userEvent.setup();
    buildIssueReportMock.mockResolvedValueOnce('AUTO REPORT CONTENT');

    render(<SettingsModal open onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Issue Report' }));

    expect(buildIssueReportMock).toHaveBeenCalledWith('');
    const { report } = getIssueTextareas();
    await waitFor(() => {
      expect(report.value).toBe('AUTO REPORT CONTENT');
    });
    expect(screen.getByRole('button', { name: 'Copy Report' })).toBeEnabled();
  });

  it('shows loading state and keeps copy disabled while report is pending', async () => {
    const user = userEvent.setup();
    const pending = createDeferred<string>();
    buildIssueReportMock.mockReturnValueOnce(pending.promise);

    render(<SettingsModal open onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Issue Report' }));

    expect(screen.getByRole('button', { name: 'Refreshing...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Copy Report' })).toBeDisabled();

    pending.resolve('READY');
    const { report } = getIssueTextareas();
    await waitFor(() => {
      expect(report.value).toBe('READY');
    });
  });

  it('refreshes report using latest notes value', async () => {
    const user = userEvent.setup();
    buildIssueReportMock
      .mockResolvedValueOnce('INITIAL')
      .mockResolvedValueOnce('REFRESHED WITH NOTES');

    render(<SettingsModal open onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Issue Report' }));
    await waitFor(() => {
      expect(getIssueTextareas().report.value).toBe('INITIAL');
    });

    const { notes, report } = getIssueTextareas();
    await user.type(notes, 'Repro: click zoom 3 times');
    await user.click(screen.getByRole('button', { name: 'Refresh Report' }));

    expect(buildIssueReportMock).toHaveBeenLastCalledWith('Repro: click zoom 3 times');
    await waitFor(() => {
      expect(report.value).toBe('REFRESHED WITH NOTES');
    });
  });

  it('rebuilds on copy and writes latest content to clipboard', async () => {
    const user = userEvent.setup();
    buildIssueReportMock
      .mockResolvedValueOnce('INITIAL REPORT')
      .mockResolvedValueOnce('LATEST REPORT FOR EMAIL');

    render(<SettingsModal open onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Issue Report' }));
    await waitFor(() => {
      expect(getIssueTextareas().report.value).toBe('INITIAL REPORT');
    });

    await user.click(screen.getByRole('button', { name: 'Copy Report' }));

    expect(buildIssueReportMock).toHaveBeenNthCalledWith(2, '');
    await waitFor(() => {
      expect(getIssueTextareas().report.value).toBe('LATEST REPORT FOR EMAIL');
    });
    expect(screen.getByText('Copied')).toBeInTheDocument();
  });

  it('shows copy failure state when copy-time report generation fails', async () => {
    const user = userEvent.setup();
    buildIssueReportMock
      .mockResolvedValueOnce('INITIAL REPORT')
      .mockRejectedValueOnce(new Error('copy regeneration failed'));

    render(<SettingsModal open onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Issue Report' }));
    await waitFor(() => {
      expect(getIssueTextareas().report.value).toBe('INITIAL REPORT');
    });

    await user.click(screen.getByRole('button', { name: 'Copy Report' }));
    expect(await screen.findByText('Copy failed')).toBeInTheDocument();
  });

  it('renders a failure message when report generation throws', async () => {
    const user = userEvent.setup();
    buildIssueReportMock.mockRejectedValueOnce(new Error('diagnostics unavailable'));

    render(<SettingsModal open onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Issue Report' }));

    await waitFor(() => {
      expect(getIssueTextareas().report.value).toContain(
        'Failed to generate issue report: diagnostics unavailable',
      );
    });
  });
});
