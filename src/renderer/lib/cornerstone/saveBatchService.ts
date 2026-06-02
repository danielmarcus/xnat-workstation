/**
 * saveBatchService — orchestrates the Save All batch driven by
 * SaveAllPreflightDialog (spec §4.4.4).
 *
 * Sequenced, not parallel — keeps transport-side ordering predictable
 * and matches the existing `saveAllDirty` behaviour. The function
 * surfaces progress via `onProgress` so callers (the panel + the
 * SavingOverlay) can render the "Saving N of M — {name}…" UI, and
 * returns the list of failures so the overlay can switch to the
 * batch-failed mode.
 *
 * The save adapter is dependency-injected (DI seam matching the rest
 * of the cornerstone services). Default wiring uses
 * `uploadContainerToXnat`. A test-only `wireSaveBatchSaver` lets unit
 * tests substitute a deterministic stub.
 *
 * Note (target-name handling): the current `uploadSegmentationToXnat`
 * does not yet take a "save as new copy" name parameter; the dialog
 * collects the desired copy name but it is not yet threaded through
 * the transport layer (a follow-up to make the upload service accept
 * an optional `targetName`). The batch executor still respects skip
 * decisions and the action category, so the batch shape is correct.
 */
import * as containerBridge from './containerBridge';
import { uploadContainerToXnat } from './containerActions';

export type SaveAllAction = 'overwrite' | 'copy' | 'new' | 'skip';

export interface SaveAllDecision {
  containerId: string;
  action: SaveAllAction;
  /** Present when `action === 'copy'`. */
  copyName?: string;
}

export interface SaveBatchProgress {
  /** 1-based index of the decision currently being saved. */
  current: number;
  /** Total number of non-skipped decisions in the batch. */
  total: number;
  /** Display name of the container currently being saved. */
  currentName: string;
  /** Action being applied to the current row. */
  action: Exclude<SaveAllAction, 'skip'>;
}

export interface SaveBatchFailure {
  containerId: string;
  containerName: string;
  errorMessage: string;
}

export interface SaveBatchResult {
  saved: string[];
  failures: SaveBatchFailure[];
  skipped: string[];
}

export interface SaveBatchCallbacks {
  onProgress?: (progress: SaveBatchProgress) => void;
}

/**
 * The save adapter contract. Wired by `wireSaveBatchSaver` for tests.
 * Returns `'saved'` on success; anything else (including thrown
 * errors) becomes a batch failure.
 */
export type SaveAdapter = (
  containerId: string,
  decision: SaveAllDecision,
) => Promise<'saved' | 'failed' | string>;

let saveAdapter: SaveAdapter = async (containerId) => {
  const outcome = await uploadContainerToXnat(containerId);
  return outcome;
};

/** Test seam — swap the upload adapter. */
export function wireSaveBatchSaver(adapter: SaveAdapter): void {
  saveAdapter = adapter;
}

/** Test seam — restore the default adapter. */
export function resetSaveBatchSaver(): void {
  saveAdapter = async (containerId) => uploadContainerToXnat(containerId);
}

/**
 * Run the Save All batch in sequence. Returns saved / failures /
 * skipped lists once every non-skipped decision has been attempted.
 *
 * Skipped decisions stay dirty (the executor takes no action on them
 * beyond logging in the skipped list). Failures keep their dirty
 * flag too — the bridge marks containers clean only on successful
 * upload, which is the upload service's responsibility.
 */
export async function executeSaveAllBatch(
  decisions: ReadonlyArray<SaveAllDecision>,
  callbacks: SaveBatchCallbacks = {},
): Promise<SaveBatchResult> {
  const nonSkipped = decisions.filter((d) => d.action !== 'skip');
  const total = nonSkipped.length;

  const saved: string[] = [];
  const failures: SaveBatchFailure[] = [];
  const skipped: string[] = decisions
    .filter((d) => d.action === 'skip')
    .map((d) => d.containerId);

  for (let i = 0; i < nonSkipped.length; i++) {
    const decision = nonSkipped[i];
    const container = containerBridge.getContainer(decision.containerId);
    const containerName = container?.name ?? decision.containerId;
    callbacks.onProgress?.({
      current: i + 1,
      total,
      currentName: containerName,
      action: decision.action as Exclude<SaveAllAction, 'skip'>,
    });

    try {
      const outcome = await saveAdapter(decision.containerId, decision);
      if (outcome === 'saved') {
        saved.push(decision.containerId);
      } else {
        failures.push({
          containerId: decision.containerId,
          containerName,
          errorMessage: typeof outcome === 'string' && outcome !== 'failed' ? outcome : 'Upload failed',
        });
      }
    } catch (err) {
      failures.push({
        containerId: decision.containerId,
        containerName,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { saved, failures, skipped };
}
