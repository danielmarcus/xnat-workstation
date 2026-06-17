/**
 * transportSaver (Transport track TR2) — bridges the saveQueue's injected
 * `saveContainer(id)` to the §H transport. It serializes the container, calls
 * `transport.save(serialized, baseVersionToken)`, maps the H5 SaveResult to the
 * queue's SaveOutcome, and tracks the per-container base version token so a normal
 * follow-up save isn't treated as a self-conflict. On a conflict it stashes the
 * server token; `rebaseToServer` adopts it (the H7 keep-local resolution: re-base
 * then re-save). Pure wiring over an injected transport + serialize — unit-testable
 * with the in-memory double; the real path injects the IPC transport + the DICOM
 * export as `serialize`.
 */
import type { AnnotationTransport, SaveResult, SerializedContainer } from './annotationTransport';
import type { SaveOutcome } from './segmentationService/saveQueue';

export interface TransportSaverDeps {
  transport: AnnotationTransport;
  /** Serialize a container to its §H4 payload, or null if it can't be serialized. */
  serialize: (containerId: string) => Promise<SerializedContainer | null>;
  /** Observe each raw H5 result (e.g. to feed transportStore version/conflict state). */
  onResult?: (containerId: string, result: SaveResult) => void;
}

export interface TransportSaver {
  /** The function injected into the saveQueue as `saveContainer`. */
  saveContainer: (containerId: string) => Promise<SaveOutcome>;
  /** Adopt the server's current version as the base (H7 keep-local: then re-save wins). */
  rebaseToServer: (containerId: string) => Promise<void>;
  /** Current base version token for a container (null if never saved here). */
  baseToken: (containerId: string) => string | null;
  /** Drop all per-container token state (service reset / container removal). */
  reset: () => void;
}

export function createTransportSaver(deps: TransportSaverDeps): TransportSaver {
  const baseTokens = new Map<string, string>();

  return {
    async saveContainer(containerId: string): Promise<SaveOutcome> {
      let serialized: SerializedContainer | null;
      try {
        serialized = await deps.serialize(containerId);
      } catch (err) {
        return { ok: false, kind: 'transient', error: err instanceof Error ? err.message : String(err) };
      }
      if (!serialized) {
        // Nothing to serialize (no exportable content / unknown container) — not
        // retryable; surface as permanent so the queue stops re-attempting.
        return { ok: false, kind: 'permanent', error: 'container has no serializable content' };
      }

      const base = baseTokens.get(containerId) ?? null;
      const result = await deps.transport.save(serialized, base);
      deps.onResult?.(containerId, result);

      if (result.ok) {
        // Re-base on the server's STORED version (a GET via getServerVersion), not
        // the PUT-response token. XNAT issues a token on PUT that does NOT match a
        // later GET of the same file (it re-encodes / re-derives), so using the
        // PUT token as the base would false-positive the NEXT save's pre-overwrite
        // check (getVersion polls via GET). Sourcing both the base and the pre-check
        // from getServerVersion (the same GET observable) makes a clean repeat-save
        // match while still catching real external edits. Falls back to the PUT
        // token if the poll is unavailable (null).
        let nextBase = result.versionToken;
        try {
          const stored = await deps.transport.getServerVersion(containerId);
          if (stored) nextBase = stored;
        } catch {
          // keep the PUT-response token as the base
        }
        baseTokens.set(containerId, nextBase);
        return { ok: true };
      }
      return { ok: false, kind: result.kind, error: result.error };
    },

    async rebaseToServer(containerId: string): Promise<void> {
      const server = await deps.transport.getServerVersion(containerId);
      if (server) baseTokens.set(containerId, server);
      else baseTokens.delete(containerId);
    },

    baseToken: (containerId: string) => baseTokens.get(containerId) ?? null,
    reset: () => baseTokens.clear(),
  };
}
