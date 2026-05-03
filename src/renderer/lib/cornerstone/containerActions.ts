/**
 * Container Actions — high-level Save / Revert / Export entry points
 * called from the §D7.6 list-panel buttons. Routes through:
 *   - `transport.flushNow` for Save (E2 queue-next-save coordinator)
 *   - the existing legacy export path (`exportToDicomSeg` /
 *     `exportToRtStruct`) for Export. When the multi-viewport-aware
 *     export path lands (XNAT integration workstream) the wrapper here
 *     swaps without changing the UI surface.
 *   - Revert is currently a deferred no-op — the transport-side reload
 *     path lives behind the XNAT integration workstream. This module
 *     exposes the entry point so the UI button can wire to it now and
 *     future work just swaps the implementation.
 *
 * All exports are pure functions taking a containerId; they look up the
 * Container from `containerBridge` to dispatch the right path.
 *
 * The DI seam (`wireContainerActions`) lets tests inject stubs without
 * pulling in the full segmentationService graph.
 */
import type { Container } from '../../types/annotation';
import * as containerBridge from './containerBridge';
import * as transport from './segmentationService/transport';

export interface ContainerActionsDeps {
  /** Export a SEG container's primary segmentation as DICOM SEG base64. */
  exportToDicomSeg: (csSegmentationId: string) => Promise<string>;
  /** Export an RTSTRUCT container's primary segmentation as DICOM RTSTRUCT base64. */
  exportToRtStruct: (csSegmentationId: string) => Promise<string>;
  /** Persist a DICOM SEG base64 payload to disk via Electron's save dialog. */
  saveDicomSeg: (base64: string, defaultName: string) => Promise<string | null>;
  /** Persist a DICOM RTSTRUCT base64 payload to disk via Electron's save dialog. */
  saveDicomRtStruct: (base64: string, defaultName: string) => Promise<string | null>;
}

const NOOP_DEPS: ContainerActionsDeps = {
  exportToDicomSeg: () => Promise.reject(new Error('[containerActions] exportToDicomSeg not wired')),
  exportToRtStruct: () => Promise.reject(new Error('[containerActions] exportToRtStruct not wired')),
  saveDicomSeg: () => Promise.resolve(null),
  saveDicomRtStruct: () => Promise.resolve(null),
};

let deps: ContainerActionsDeps = NOOP_DEPS;

/** Inject the runtime deps. Called once at segmentationService.initialize(). */
export function wireContainerActions(injected: Partial<ContainerActionsDeps>): void {
  deps = { ...NOOP_DEPS, ...injected };
}

export function resetContainerActionsWiring(): void {
  deps = NOOP_DEPS;
}

function csIdFor(container: Container): string | null {
  // SEG / POI containers are 1:1 with a Cornerstone segmentation. RTSTRUCT
  // members are independent annotations but share the container's bridged
  // segmentationId for export purposes (per the legacy SegmentationPanel
  // route — exportToRtStruct accepts the structure-set's segmentationId).
  return container.members[0]?.csSegmentationId ?? null;
}

/**
 * Trigger a save round-trip immediately. Returns the SaveOutcome (or null
 * when no save was needed because the container is not dirty). Logs but
 * does not throw on transport-side failures — the transportStore records
 * them and the UI surfaces them via the container-row indicator.
 */
export async function saveContainer(containerId: string): Promise<void> {
  if (!containerId) return;
  const container = containerBridge.getContainer(containerId);
  if (!container) return;
  if (!container.dirty) return;
  try {
    await transport.flushNow(containerId);
  } catch (err) {
    console.warn('[containerActions] saveContainer: transport.flushNow failed', { containerId, err });
  }
}

/**
 * Discard local changes for a container. Currently a deferred no-op —
 * the reload-from-server path is XNAT-integration-workstream territory.
 * The UI wires a button now; the implementation backfills later.
 */
export async function revertContainer(containerId: string): Promise<void> {
  if (!containerId) return;
  const container = containerBridge.getContainer(containerId);
  if (!container) return;
  console.warn(
    '[containerActions] revertContainer: not yet implemented (XNAT integration workstream)',
    { containerId, name: container.name },
  );
}

/**
 * Export a container as DICOM SEG / RTSTRUCT and prompt the user to save
 * the file to disk. Returns the chosen file path on success, or null when
 * the user cancels the save dialog.
 */
export async function exportContainer(containerId: string): Promise<string | null> {
  if (!containerId) return null;
  const container = containerBridge.getContainer(containerId);
  if (!container) return null;
  const csSegId = csIdFor(container);
  if (!csSegId) {
    console.warn('[containerActions] exportContainer: no csSegmentationId on container', { containerId });
    return null;
  }
  const safeName = (container.name || `container_${containerId}`).replace(/[^A-Za-z0-9._-]/g, '_');
  try {
    if (container.kind === 'RTSTRUCT') {
      const base64 = await deps.exportToRtStruct(csSegId);
      return await deps.saveDicomRtStruct(base64, `${safeName}.dcm`);
    } else if (container.kind === 'SEG') {
      const base64 = await deps.exportToDicomSeg(csSegId);
      return await deps.saveDicomSeg(base64, `${safeName}.dcm`);
    } else {
      console.warn('[containerActions] exportContainer: POI export not yet supported', { containerId });
      return null;
    }
  } catch (err) {
    console.warn('[containerActions] exportContainer failed', { containerId, kind: container.kind, err });
    return null;
  }
}

/**
 * Save every dirty container in one pass (D7.6 session-level "Save All"
 * action). Sequenced (not parallel) to keep transport-side ordering
 * predictable — a parallel storm could starve the queue-next-save state
 * machine.
 */
export async function saveAllDirty(): Promise<void> {
  const dirtyIds: string[] = [];
  for (const { containerId } of containerBridge.listAll()) {
    const c = containerBridge.getContainer(containerId);
    if (c?.dirty) dirtyIds.push(containerId);
  }
  for (const id of dirtyIds) {
    await saveContainer(id);
  }
}
