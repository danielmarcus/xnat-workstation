/**
 * quitFlush — pure orchestration for the spec §12.7 quit-time flush.
 *
 * On app quit (or window close), the renderer runs a final backup
 * pass over every dirty container whose last backup is older than
 * the debounce window. The pass is sequential — Cornerstone exports
 * aren't thread-safe — and the result is summarised so the caller
 * can decide whether to:
 *  - quit silently (`'all-ok'`)
 *  - show the §12.7 confirm dialog ("Some changes couldn't be backed
 *    up. Quit anyway / Cancel / Open Backup folder") (`'partial-fail'`)
 *
 * Pure module — no IPC, no DOM, no Electron API. The renderer's
 * App.tsx supplies the `saveFn` (typically wrapping
 * `backupService.backupAllDirtySegmentations`) and consumes the
 * result. Tests use a synthetic `saveFn`.
 */

export interface QuitFlushItem {
  /** Container or segmentation id — purely a label for the failures list. */
  id: string;
  /** Display name, used by the confirm dialog when listing failed entries. */
  name: string;
}

export interface QuitFlushFailure {
  id: string;
  name: string;
  errorMessage: string;
}

export interface QuitFlushResult {
  /** `'all-ok'` when every item saved; `'partial-fail'` when ≥1 failed. */
  outcome: 'all-ok' | 'partial-fail' | 'noop';
  savedIds: string[];
  failures: QuitFlushFailure[];
  /** Total time the flush spent (ms). Useful for logging. */
  durationMs: number;
}

export type QuitFlushSaveFn = (item: QuitFlushItem) => Promise<'saved' | 'failed' | string>;

/**
 * Run the quit-time flush. Iterates `items` sequentially; awaits each
 * `saveFn(item)`. Anything other than `'saved'` (including a thrown
 * Error) becomes a failure entry. Returns a summarised result.
 *
 * `now` injectable so tests can pin the clock.
 */
export async function runQuitFlush(
  items: ReadonlyArray<QuitFlushItem>,
  saveFn: QuitFlushSaveFn,
  now: () => number = Date.now,
): Promise<QuitFlushResult> {
  const startedAt = now();
  if (items.length === 0) {
    return { outcome: 'noop', savedIds: [], failures: [], durationMs: now() - startedAt };
  }
  const savedIds: string[] = [];
  const failures: QuitFlushFailure[] = [];
  for (const item of items) {
    try {
      const result = await saveFn(item);
      if (result === 'saved') {
        savedIds.push(item.id);
      } else {
        failures.push({
          id: item.id,
          name: item.name,
          errorMessage: typeof result === 'string' && result !== 'failed' ? result : 'Backup failed',
        });
      }
    } catch (err) {
      failures.push({
        id: item.id,
        name: item.name,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return {
    outcome: failures.length === 0 ? 'all-ok' : 'partial-fail',
    savedIds,
    failures,
    durationMs: now() - startedAt,
  };
}

/**
 * Human-readable summary for the confirm dialog body. The dialog
 * shows up to `maxNames` failed names then a `(+N more)` tail.
 */
export function summarizeQuitFlush(result: QuitFlushResult, maxNames = 3): string {
  if (result.outcome === 'all-ok' || result.outcome === 'noop') {
    return 'All changes backed up.';
  }
  const head = result.failures.slice(0, maxNames).map((f) => f.name).join(', ');
  const more = Math.max(0, result.failures.length - maxNames);
  const suffix = more > 0 ? ` (+${more} more)` : '';
  return `Some changes couldn't be backed up: ${head}${suffix}.`;
}
