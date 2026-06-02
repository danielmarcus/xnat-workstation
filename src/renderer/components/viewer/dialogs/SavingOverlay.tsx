/**
 * SavingOverlay — spec §4.4.5
 *
 * Modal scrim shown during in-progress XNAT uploads. The caller
 * decides when to mount it (the spec says "any upload > 200 ms"; the
 * 200 ms gate lives outside this component).
 *
 * Three render modes:
 *
 *  - **single** — spinner + `Saving "{name}" to XNAT…`. After
 *    `cancelButtonAppearAt` ms (default 2200), a Cancel button slides
 *    in. `onCancel` is optional — when omitted Cancel is suppressed.
 *
 *  - **batch** — spinner + `Saving N of M — "{currentName}"…` + thin
 *    progress bar (width: `current / total`).
 *
 *  - **batch-failed** — the overlay turns red, lists the failed
 *    entries with a per-row Retry, plus footer Retry all / Cancel.
 *    Already-saved entries are not shown as failed.
 */
import { useEffect, useState } from 'react';

export interface SavingOverlayFailure {
  containerId: string;
  containerName: string;
  errorMessage?: string;
}

export interface SavingOverlayProps {
  open: boolean;
  /** "single" while saving one; "batch" while saving many; "batch-failed" on partial failure. */
  mode: 'single' | 'batch' | 'batch-failed';
  /** Name of the container currently being saved (single & batch). */
  currentName?: string;
  /** Batch progress: how many have been attempted so far (1-based). */
  current?: number;
  /** Batch total. */
  total?: number;
  /** Failed entries (batch-failed only). */
  failures?: SavingOverlayFailure[];
  /** Optional override (ms) for when the Cancel button appears in single mode. Spec default: 2200 ms. */
  cancelButtonAppearAt?: number;
  onCancel?: () => void;
  onRetry?: (containerId: string) => void;
  onRetryAll?: () => void;
}

const DEFAULT_CANCEL_DELAY_MS = 2200;

export default function SavingOverlay(props: SavingOverlayProps) {
  const {
    open,
    mode,
    currentName,
    current,
    total,
    failures,
    cancelButtonAppearAt = DEFAULT_CANCEL_DELAY_MS,
    onCancel,
    onRetry,
    onRetryAll,
  } = props;

  // Delayed Cancel button (single mode only). Reset every open or
  // when the appear-at changes.
  const [showLateCancel, setShowLateCancel] = useState(false);
  useEffect(() => {
    if (!open || mode !== 'single' || !onCancel) {
      setShowLateCancel(false);
      return;
    }
    setShowLateCancel(false);
    const id = setTimeout(() => setShowLateCancel(true), cancelButtonAppearAt);
    return () => clearTimeout(id);
  }, [open, mode, cancelButtonAppearAt, onCancel]);

  if (!open) return null;

  const isFailed = mode === 'batch-failed';

  return (
    <div
      data-testid="saving-overlay"
      data-mode={mode}
      role="dialog"
      aria-modal="true"
      aria-busy={!isFailed}
      aria-labelledby="saving-overlay-title"
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
    >
      <div className="absolute inset-0 bg-zinc-950/75" />

      <div
        className={`relative w-full max-w-md rounded-xl border shadow-2xl ${
          isFailed
            ? 'border-red-700/60 bg-red-950/40'
            : 'border-zinc-700 bg-zinc-900'
        }`}
      >
        {mode === 'single' && (
          <SingleBody
            currentName={currentName ?? ''}
            showLateCancel={showLateCancel}
            onCancel={onCancel}
          />
        )}

        {mode === 'batch' && (
          <BatchBody
            currentName={currentName ?? ''}
            current={current ?? 0}
            total={total ?? 0}
          />
        )}

        {mode === 'batch-failed' && (
          <BatchFailedBody
            failures={failures ?? []}
            onRetry={onRetry}
            onRetryAll={onRetryAll}
            onCancel={onCancel}
          />
        )}
      </div>
    </div>
  );
}

function SingleBody({
  currentName,
  showLateCancel,
  onCancel,
}: {
  currentName: string;
  showLateCancel: boolean;
  onCancel?: () => void;
}) {
  return (
    <div className="px-5 py-6 flex flex-col items-center gap-3">
      <Spinner />
      <p
        id="saving-overlay-title"
        data-testid="saving-overlay-single-title"
        className="text-sm text-zinc-100"
      >
        Saving &ldquo;{currentName}&rdquo; to XNAT…
      </p>
      {showLateCancel && onCancel && (
        <button
          type="button"
          data-testid="saving-overlay-cancel"
          onClick={onCancel}
          className="mt-1 rounded bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700"
        >
          Cancel
        </button>
      )}
    </div>
  );
}

function BatchBody({
  currentName,
  current,
  total,
}: {
  currentName: string;
  current: number;
  total: number;
}) {
  const pct = total > 0 ? Math.round((Math.min(current, total) / total) * 100) : 0;
  return (
    <div className="px-5 py-6 flex flex-col items-center gap-3">
      <Spinner />
      <p
        id="saving-overlay-title"
        data-testid="saving-overlay-batch-title"
        className="text-sm text-zinc-100"
      >
        Saving {current} of {total} — &ldquo;{currentName}&rdquo;…
      </p>
      <div
        className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={Math.min(current, total)}
      >
        <div
          data-testid="saving-overlay-progress-fill"
          className="h-full bg-blue-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function BatchFailedBody({
  failures,
  onRetry,
  onRetryAll,
  onCancel,
}: {
  failures: SavingOverlayFailure[];
  onRetry?: (containerId: string) => void;
  onRetryAll?: () => void;
  onCancel?: () => void;
}) {
  return (
    <>
      <div className="border-b border-red-800/60 px-4 py-3">
        <h3
          id="saving-overlay-title"
          data-testid="saving-overlay-failed-title"
          className="text-sm font-semibold text-red-200"
        >
          {failures.length === 1
            ? '1 save failed'
            : `${failures.length} saves failed`}
        </h3>
        <p className="text-[11px] text-red-300/80 mt-0.5">
          Already-saved entries were kept. Retry the failed ones below.
        </p>
      </div>
      <ul
        data-testid="saving-overlay-failure-list"
        className="max-h-60 overflow-y-auto divide-y divide-red-900/40"
      >
        {failures.map((f) => (
          <li
            key={f.containerId}
            data-testid={`saving-overlay-failure-row:${f.containerId}`}
            className="flex items-center justify-between gap-2 px-4 py-2 text-xs"
          >
            <div className="min-w-0">
              <div className="text-zinc-100 truncate">{f.containerName}</div>
              {f.errorMessage && (
                <div className="text-red-300/80 truncate text-[11px]">{f.errorMessage}</div>
              )}
            </div>
            {onRetry && (
              <button
                type="button"
                data-testid={`saving-overlay-retry:${f.containerId}`}
                onClick={() => onRetry(f.containerId)}
                className="rounded bg-red-800/40 hover:bg-red-700/60 text-red-100 px-2 py-1"
              >
                Retry
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-end gap-2 border-t border-red-800/60 px-4 py-3">
        {onCancel && (
          <button
            type="button"
            data-testid="saving-overlay-cancel"
            onClick={onCancel}
            className="rounded bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700"
          >
            Cancel
          </button>
        )}
        {onRetryAll && failures.length > 0 && (
          <button
            type="button"
            data-testid="saving-overlay-retry-all"
            onClick={onRetryAll}
            className="rounded bg-red-600 px-3 py-1.5 text-xs text-white hover:bg-red-500"
          >
            Retry all
          </button>
        )}
      </div>
    </>
  );
}

function Spinner() {
  return (
    <div
      role="presentation"
      className="w-6 h-6 border-2 border-zinc-700 border-t-blue-400 rounded-full animate-spin"
    />
  );
}
