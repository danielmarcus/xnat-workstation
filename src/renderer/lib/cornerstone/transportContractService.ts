/**
 * Transport Contract Service — the multi-viewport side of the H contract
 * with the XNAT integration workstream.
 *
 * Per requirements §H. The transport (XNAT-specific implementation) is
 * registered against this service via `setTransportAdapter`. The multi-
 * viewport layer never speaks to XNAT directly; it only emits dirty
 * events, exposes serialize, and reacts to outcomes the transport reports.
 *
 * See:
 *   - docs/multiviewport-annotation-requirements.md §H
 *   - docs/multiviewport-annotation-design.md §4.2, §5
 *
 * Phase 0: skeleton with method shapes only. The XNAT integration
 * workstream provides the adapter; multi-viewport-side wiring lands in
 * Phase 2.
 */
import type {
  Container,
  ParseError,
  SourceIdentity,
  VersionToken,
} from '../../types/annotation';
import type { TransportError } from '../../stores/transportStore';

// ─── Adapter interface — implemented by the transport workstream ───────

/**
 * The transport adapter the XNAT integration workstream provides. The
 * adapter implements load/save/version-poll for a specific backend; the
 * multi-viewport layer is agnostic to the backend.
 */
export interface TransportAdapter {
  /**
   * Serialize and upload a container. Returns a new VersionToken on success,
   * or rejects with a TransportError indicating outcome category.
   */
  saveContainer(container: Container): Promise<SaveOutcome>;

  /**
   * Optional: poll for an external change to a container. Returns true if the
   * server's version differs from the local versionToken. Adapters that don't
   * support polling can stub this to always return false.
   */
  checkExternalChange?(
    containerId: string,
    versionToken: VersionToken | null,
  ): Promise<boolean>;
}

export type SaveOutcome =
  | { kind: 'success'; versionToken: VersionToken }
  | { kind: 'conflict' }
  | { kind: 'transient-failure'; error: TransportError }
  | { kind: 'permanent-failure'; error: TransportError };

// ─── Conflict resolution flow (H7) ──────────────────────────────────────

export type ConflictResolution = 'keep-local' | 'discard-local' | 'inspect';

// ─── Service surface ────────────────────────────────────────────────────

export interface TransportContractService {
  /**
   * Register the transport adapter. Called once at app init by the XNAT
   * integration entry point. Subsequent calls replace the adapter.
   */
  setTransportAdapter(adapter: TransportAdapter): void;

  // ─── H3: dirty signal ────────────────────────────────────────────────

  /**
   * Notify the service that a container's state has diverged from its
   * last-saved state. The service handles autosave debouncing per
   * preferencesStore.autosaveEnabled / .autosaveDebounceMs.
   */
  notifyDirty(containerId: string): void;

  /**
   * Cancel a pending debounced autosave for a container (e.g., on container
   * delete or sign-out).
   */
  cancelPendingSave(containerId: string): void;

  // ─── H4: explicit save ───────────────────────────────────────────────

  /**
   * Save a single container immediately, flushing any pending debounce.
   * Returns when the save completes (success or failure).
   */
  saveNow(containerId: string): Promise<SaveOutcome>;

  /** Save all dirty containers. */
  saveAll(): Promise<Map<string, SaveOutcome>>;

  // ─── H6: external change ─────────────────────────────────────────────

  /**
   * Notify the service of an external change to a container (the transport
   * adapter detected a server-side update). Triggers H7 if the container is
   * dirty, otherwise allows silent reload per E3.
   */
  notifyExternalChange(containerId: string): void;

  // ─── H7: conflict resolution ─────────────────────────────────────────

  /**
   * The user has chosen how to resolve a conflict on a container. The
   * service executes the chosen action and updates store state.
   */
  resolveConflict(containerId: string, resolution: ConflictResolution): Promise<void>;

  // ─── H9: load ────────────────────────────────────────────────────────

  /**
   * Ingest a parsed container delivered by the transport. Wires it into
   * stores, attaches segmentation representations to FoR-eligible viewports.
   */
  ingestLoadedContainer(container: Container, sourceIdentity: SourceIdentity): void;

  /**
   * Ingest a parse failure. Surfaces a placeholder container row in the
   * list panel with the error per D7.9.
   */
  ingestParseError(uri: string, error: ParseError): void;
}

function notImplemented(method: string): never {
  throw new Error(`[transportContractService] ${method} not yet implemented (multi-viewport rewrite is in Phase 0)`);
}

export const transportContractService: TransportContractService = {
  setTransportAdapter: () => notImplemented('setTransportAdapter'),
  notifyDirty: () => notImplemented('notifyDirty'),
  cancelPendingSave: () => notImplemented('cancelPendingSave'),
  saveNow: () => notImplemented('saveNow'),
  saveAll: () => notImplemented('saveAll'),
  notifyExternalChange: () => notImplemented('notifyExternalChange'),
  resolveConflict: () => notImplemented('resolveConflict'),
  ingestLoadedContainer: () => notImplemented('ingestLoadedContainer'),
  ingestParseError: () => notImplemented('ingestParseError'),
};
