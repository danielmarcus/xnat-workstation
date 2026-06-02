/**
 * ErrorBoundary — React error boundary with crash-snapshot capture
 * (MV-Phase 7.1, spec §13.1).
 *
 * Two variants:
 *   - `app`: top-level boundary mounted in main.tsx around <App />. A crash
 *     renders a full recovery screen with "Reload renderer" and "Copy error
 *     report" actions. (The Settings modal lives inside the crashed App
 *     tree, so "Open Diagnostics" is not reachable here — copying the
 *     report to the clipboard is the diagnostics path that still works.)
 *   - `viewport`: per-viewport boundary mounted around each viewport cell
 *     in ViewportGrid. A crash in one viewport shows a compact in-cell
 *     "Render error — Reload viewport" recovery without taking down the
 *     rest of the app.
 *
 * Every catch writes a de-identified crash snapshot via
 * `crashSnapshotService` (deduped, never throws).
 */
import React from 'react';
import { captureCrashSnapshot } from '../lib/diagnostics/crashSnapshotService';

interface ErrorBoundaryProps {
  variant: 'app' | 'viewport';
  /** Identifies the boundary in crash snapshots (e.g. 'panel_0'). */
  label?: string;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  /** Bumped on reset so children remount with fresh state. */
  resetKey: number;
  /** Clipboard feedback for the app variant's "Copy error report". */
  copied: boolean;
}

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, resetKey: 0, copied: false };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    void captureCrashSnapshot('error-boundary', error, {
      componentStack: info.componentStack ?? undefined,
      boundary: this.props.label ?? this.props.variant,
    });
  }

  private reset = (): void => {
    this.setState((s) => ({ error: null, resetKey: s.resetKey + 1, copied: false }));
  };

  private reloadRenderer = (): void => {
    window.location.reload();
  };

  private copyErrorReport = async (): Promise<void> => {
    const { error } = this.state;
    try {
      // buildIssueReport collects app/runtime/system details + recent logs
      // (all de-identified). Prefix it with the crash specifics.
      const { buildIssueReport } = await import('../lib/diagnostics/issueReport');
      const report = await buildIssueReport(
        `Renderer crash caught by ErrorBoundary (${this.props.label ?? this.props.variant}):\n`
        + `${error?.message ?? 'unknown error'}\n\n${error?.stack ?? ''}`,
      );
      await navigator.clipboard.writeText(report);
      this.setState({ copied: true });
    } catch {
      // Clipboard or report generation failed — fall back to the raw error.
      try {
        await navigator.clipboard.writeText(`${error?.message ?? 'unknown error'}\n\n${error?.stack ?? ''}`);
        this.setState({ copied: true });
      } catch {
        /* nothing else to try */
      }
    }
  };

  render(): React.ReactNode {
    const { error, resetKey, copied } = this.state;
    const { variant, children } = this.props;

    if (!error) {
      // Key bump remounts the subtree after "Reload viewport".
      return <React.Fragment key={resetKey}>{children}</React.Fragment>;
    }

    if (variant === 'viewport') {
      return (
        <div
          data-testid="viewport-error-boundary"
          className="w-full h-full bg-black flex flex-col items-center justify-center gap-3 p-4"
        >
          <svg className="w-8 h-8 text-red-500/70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          </svg>
          <div className="text-center">
            <p className="text-sm text-zinc-300">Render error</p>
            <p className="text-xs text-zinc-500 mt-1 max-w-[260px] truncate" title={error.message}>
              {error.message}
            </p>
          </div>
          <button
            type="button"
            onClick={this.reset}
            className="px-3 py-1.5 text-xs font-medium rounded bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors"
          >
            Reload viewport
          </button>
        </div>
      );
    }

    // App-level recovery screen.
    return (
      <div
        data-testid="app-error-boundary"
        className="fixed inset-0 bg-zinc-950 flex items-center justify-center p-8 z-[1000]"
      >
        <div className="max-w-lg w-full bg-zinc-900 border border-zinc-700 rounded-lg p-6">
          <div className="flex items-start gap-3">
            <svg className="w-6 h-6 text-red-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            </svg>
            <div className="min-w-0">
              <h1 className="text-base font-semibold text-zinc-100">Something went wrong</h1>
              <p className="text-sm text-zinc-400 mt-1">
                The viewer hit an unexpected error. A diagnostic report was saved automatically
                and will be offered for review on the next launch.
              </p>
              <pre className="mt-3 p-3 bg-zinc-950 border border-zinc-800 rounded text-xs text-red-300 overflow-auto max-h-40 whitespace-pre-wrap break-words">
                {error.message}
              </pre>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button
              type="button"
              onClick={this.copyErrorReport}
              className="px-3 py-1.5 text-xs font-medium rounded bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors"
            >
              {copied ? 'Copied ✓' : 'Copy error report'}
            </button>
            <button
              type="button"
              onClick={this.reloadRenderer}
              className="px-3 py-1.5 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-500 transition-colors"
            >
              Reload renderer
            </button>
          </div>
        </div>
      </div>
    );
  }
}
