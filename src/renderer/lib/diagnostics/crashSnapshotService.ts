/**
 * crashSnapshotService — automatic crash-report capture (MV-Phase 7.1,
 * spec §13.8).
 *
 * On any unhandled renderer error (React ErrorBoundary catch, unhandled
 * promise rejection, or window 'error' event) this module writes a
 * de-identified diagnostics snapshot to `<userData>/diagnostics/` via IPC.
 * On the next launch, App.tsx surfaces unsent snapshots with a banner
 * (Review / Send / Discard).
 *
 * Design constraints:
 *   - Never throws: capture is best-effort; a failing capture must not
 *     cascade into the crash path that triggered it.
 *   - Debounced per-message: a render-error loop (React re-throwing the
 *     same error on every recovery attempt) produces ONE snapshot, not N.
 *   - De-identified: messages and stacks run through the shared
 *     `deidentifyText` before leaving the renderer.
 */
import type { CrashSnapshotPayload, CrashSnapshotReason } from '@shared/types/diagnostics';
import { deidentifyText } from '@shared/diagnostics/deidentify';
import { getRendererLogEntries } from './rendererLogBuffer';

/** Suppress duplicate snapshots for the same message within this window. */
const DEDUPE_WINDOW_MS = 30_000;

const recentCaptures = new Map<string, number>();

function shouldCapture(message: string): boolean {
  const now = Date.now();
  // Prune stale entries opportunistically.
  for (const [key, ts] of recentCaptures) {
    if (now - ts > DEDUPE_WINDOW_MS) recentCaptures.delete(key);
  }
  const last = recentCaptures.get(message);
  if (last !== undefined && now - last <= DEDUPE_WINDOW_MS) return false;
  recentCaptures.set(message, now);
  return true;
}

/**
 * Capture a crash snapshot. Fire-and-forget — resolves to the snapshot id
 * on success, null when skipped (deduped) or failed. Never rejects.
 */
export async function captureCrashSnapshot(
  reason: CrashSnapshotReason,
  error: unknown,
  opts: { componentStack?: string; boundary?: string } = {},
): Promise<string | null> {
  try {
    const message = error instanceof Error ? error.message : String(error);
    if (!shouldCapture(`${reason}:${message}`)) return null;

    const payload: CrashSnapshotPayload = {
      reason,
      capturedAt: new Date().toISOString(),
      message: deidentifyText(message),
      stack: error instanceof Error && error.stack ? deidentifyText(error.stack) : undefined,
      componentStack: opts.componentStack ? deidentifyText(opts.componentStack) : undefined,
      boundary: opts.boundary,
      rendererLogs: getRendererLogEntries(100),
    };

    const result = await window.electronAPI?.diagnostics?.writeCrashSnapshot?.(payload);
    if (result?.ok) {
      console.warn(`[crashSnapshot] wrote ${result.id} (${reason}: ${message})`);
      return result.id;
    }
    console.warn('[crashSnapshot] write failed:', result && 'error' in result ? result.error : 'no diagnostics IPC');
    return null;
  } catch (err) {
    // Never let capture failures cascade into the crash path.
    console.warn('[crashSnapshot] capture threw:', err);
    return null;
  }
}

let listenersInstalled = false;

/**
 * Install global listeners for unhandled rejections and uncaught errors.
 * Idempotent. Called once from main.tsx at renderer startup.
 */
export function installCrashSnapshotListeners(): void {
  if (listenersInstalled) return;
  listenersInstalled = true;

  window.addEventListener('unhandledrejection', (event) => {
    void captureCrashSnapshot('unhandled-rejection', event.reason);
  });

  window.addEventListener('error', (event) => {
    // Resource-load errors (img/script) have no error object; skip those —
    // they're network noise, not crashes.
    if (!event.error) return;
    void captureCrashSnapshot('uncaught-error', event.error);
  });
}
