/**
 * transportService — assembles the full save path: xnatTransport adapter (over an
 * injected XNAT api) + transportSaver bridge + feeds the transportStore (version
 * token on success, conflict/error marker on H5). This is the production-injectable
 * `saveContainer` the saveQueue calls via segmentationService.setSaveTransport; the
 * E2E injects `createMockXnatApi()` as `api` to drive save/conflict offline.
 *
 * Production wiring (the careful live pass): `api` = electronAPI.xnat wrapped as an
 * XnatUploadApi (once the IPC handlers return version tokens), `serialize` =
 * exportToDicomSeg/exportToRtStruct, `kindOf` = getPreferredDicomType; autosave to
 * XNAT stays an explicit opt-in. The single store-updater here avoids double-writes
 * with the saveQueue's generic onPhase (which only sets the in-flight 'saving').
 */
import { useTransportStore } from '../../stores/transportStore';
import { createXnatTransport, type XnatUploadApi } from './xnatTransport';
import { createTransportSaver, type TransportSaver } from './transportSaver';
import type { SerializedContainer } from './annotationTransport';
import type { ContainerKind } from '@shared/types/annotation';

export interface XnatTransportServiceDeps {
  api: XnatUploadApi;
  serialize: (containerId: string) => Promise<SerializedContainer | null>;
  kindOf: (containerId: string) => ContainerKind;
  /** Clock for lastSavedAt (injectable for deterministic tests). */
  now?: () => number;
}

export function createXnatTransportService(deps: XnatTransportServiceDeps): TransportSaver {
  const now = deps.now ?? (() => Date.now());
  return createTransportSaver({
    transport: createXnatTransport(deps.api),
    serialize: deps.serialize,
    onResult: (containerId, result) => {
      const store = useTransportStore.getState();
      const kind = deps.kindOf(containerId);
      if (result.ok) {
        store.setPhase(containerId, kind, 'saving'); // ensure the entry exists
        store.markSaved(containerId, now(), result.versionToken);
      } else {
        store.setError(containerId, kind, result.kind, result.error, result.serverVersionToken);
      }
    },
  });
}
