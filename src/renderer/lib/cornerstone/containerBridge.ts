/**
 * Container Bridge — minimal `csSegmentationId → Container` 1:1 lookup.
 *
 * Phase 2.6 scaffolding. The full Container CRUD lives in `containerService`
 * (Phase 0 skeleton, lit up by Phase 3 list-panel work). The bridge is the
 * thin shim that gives `undoService` (Phase 2.7) and `transport.ts`
 * (Phase 2.8) a stable per-container subject without pulling the whole
 * container model forward.
 *
 * The bridge tracks one `Container` object per Cornerstone segmentation:
 *   - registered automatically on the `SEGMENTATION_ADDED` event;
 *   - unregistered automatically on `SEGMENTATION_REMOVED`;
 *   - kind inferred from the segmentationId prefix (`rtstruct_*` → RTSTRUCT,
 *     anything else → SEG); callers can override via the explicit
 *     `register(csSegId, { kind })` API.
 *
 * The `Container` objects stored here are summary records — name, kind,
 * approval, dirty/saveInFlight/versionToken bookkeeping. `members` stays
 * empty in v1 (Phase 3 wires the segments → members mapping); the
 * "active member" concept is implicit via `useSegmentationStore`'s
 * activeSegmentationId + activeSegmentIndex until then.
 *
 * Why a separate module instead of folding into `containerService.ts`:
 *
 *   - `containerService.ts` is the eventual CRUD surface (create / rename /
 *     approve / member-CRUD), bound to the list panel UX. Phase 2 doesn't
 *     need that surface; only the lookup. Partially-implementing
 *     containerService would violate §0.6 ("no partial implementations").
 *   - The bridge stays tiny (~150 LOC) and well-isolated, so Phase 3 can
 *     migrate its responsibilities into containerService cleanly without
 *     untangling cross-cutting state.
 *
 * Mirrors the lifecycle pattern of `sourceImageTracking.ts`: module-level
 * state, auto-cleanup listener tied to a Cornerstone event, explicit
 * `initialize()` / `dispose()` for the listener registration.
 */
import { eventTarget } from '@cornerstonejs/core';
import {
  Enums as ToolEnums,
  segmentation as csSegmentation,
} from '@cornerstonejs/tools';
import { useSegmentationStore } from '../../stores/segmentationStore';
import {
  DEFAULT_APPROVAL,
  type Container,
  type ContainerKind,
} from '../../types/annotation';

// ─── Module state ────────────────────────────────────────────────

const csToContainer = new Map<string, string>();   // csSegmentationId → containerId
const containers = new Map<string, Container>();    // containerId → Container
let containerCounter = 0;

// ─── Public API ──────────────────────────────────────────────────

export interface RegisterOpts {
  /** Display name. Defaults to the cs segmentation's `label`, or the csSegId. */
  name?: string;
  /** Container kind. Defaults to `inferContainerKind(csSegId)`. */
  kind?: ContainerKind;
}

/**
 * Register a Cornerstone segmentation as a Container. Idempotent — calling
 * with the same csSegId returns the existing containerId without creating
 * a duplicate.
 */
export function register(csSegId: string, opts: RegisterOpts = {}): string {
  if (!csSegId) {
    throw new Error('[containerBridge] register() called with empty csSegId');
  }
  const existing = csToContainer.get(csSegId);
  if (existing) return existing;

  const kind = opts.kind ?? inferContainerKind(csSegId);
  const name = opts.name ?? deriveNameFromCsSegmentation(csSegId);
  const container = buildContainer(name, kind);
  csToContainer.set(csSegId, container.id);
  containers.set(container.id, container);
  return container.id;
}

/** Drop a container by its Cornerstone segmentationId. Idempotent. */
export function unregister(csSegId: string): void {
  const containerId = csToContainer.get(csSegId);
  if (!containerId) return;
  csToContainer.delete(csSegId);
  containers.delete(containerId);
}

/** Resolve csSegmentationId → containerId, or null if not registered. */
export function getContainerId(csSegId: string): string | null {
  if (!csSegId) return null;
  return csToContainer.get(csSegId) ?? null;
}

/**
 * Resolve containerId → csSegmentationId. Linear scan — bridge is small
 * (one entry per segmentation in the session, dozens at most).
 */
export function getCsSegmentationId(containerId: string): string | null {
  if (!containerId) return null;
  for (const [csSegId, cId] of csToContainer.entries()) {
    if (cId === containerId) return csSegId;
  }
  return null;
}

/** Read the Container summary by containerId. */
export function getContainer(containerId: string): Container | null {
  if (!containerId) return null;
  return containers.get(containerId) ?? null;
}

/**
 * Resolve "what container is the user currently editing?" from the
 * active segmentation. Returns null when no active segmentation is set
 * or the active segmentation isn't in the bridge.
 */
export function getActiveContainerId(): string | null {
  const activeSegId = useSegmentationStore.getState().activeSegmentationId;
  return activeSegId ? csToContainer.get(activeSegId) ?? null : null;
}

/**
 * List every registered (csSegmentationId, containerId) pair. Used by
 * transport.saveAll() and similar bulk operations in Phase 2.8.
 */
export function listAll(): Array<{ csSegmentationId: string; containerId: string }> {
  const out: Array<{ csSegmentationId: string; containerId: string }> = [];
  for (const [csSegId, cId] of csToContainer.entries()) {
    out.push({ csSegmentationId: csSegId, containerId: cId });
  }
  return out;
}

// ─── Bookkeeping setters (used by undoService / transport in 2.7 / 2.8) ─

/**
 * Set the dirty flag on a container. Called from the autoSave / event
 * pipeline when a per-container edit lands. Idempotent — no-op when the
 * container isn't registered.
 */
export function setDirty(containerId: string, dirty: boolean): void {
  const c = containers.get(containerId);
  if (c) c.dirty = dirty;
}

/** Set the saveInFlight flag (E2 queue-next-save coordination). */
export function setSaveInFlight(containerId: string, inFlight: boolean): void {
  const c = containers.get(containerId);
  if (c) c.saveInFlight = inFlight;
}

/** Apply a fresh version token after a successful save. */
export function setVersionToken(containerId: string, token: Container['versionToken']): void {
  const c = containers.get(containerId);
  if (c) c.versionToken = token;
}

// ─── Internals ───────────────────────────────────────────────────

function generateContainerId(): string {
  containerCounter++;
  return `container_${Date.now()}_${containerCounter}`;
}

function buildContainer(name: string, kind: ContainerKind): Container {
  return {
    id: generateContainerId(),
    kind,
    name,
    members: [],
    sourceIdentity: null,
    approval: { ...DEFAULT_APPROVAL, history: [] },
    dirty: false,
    saveInFlight: false,
    versionToken: null,
    parseError: null,
  };
}

/**
 * Heuristic: prefix-based mapping. Documented at the top of the file so
 * callers can override via `register(csSegId, { kind })` when they know
 * better (e.g., DICOM RTSTRUCT loads that don't follow the `rtstruct_*`
 * prefix convention but should still register as RTSTRUCT containers).
 */
export function inferContainerKind(csSegId: string): ContainerKind {
  if (typeof csSegId === 'string' && csSegId.startsWith('rtstruct_')) {
    return 'RTSTRUCT';
  }
  return 'SEG';
}

function deriveNameFromCsSegmentation(csSegId: string): string {
  try {
    const seg = csSegmentation.state.getSegmentation(csSegId) as
      | { label?: string }
      | undefined;
    return seg?.label ?? csSegId;
  } catch {
    return csSegId;
  }
}

// ─── Lifecycle ───────────────────────────────────────────────────

let initialized = false;
let onAdded: EventListener | null = null;
let onRemoved: EventListener | null = null;

/**
 * Subscribe to Cornerstone's SEGMENTATION_ADDED / SEGMENTATION_REMOVED
 * events so the bridge auto-tracks every segmentation lifecycle event.
 * Idempotent — call once during service init.
 */
export function initialize(): void {
  if (initialized) return;

  onAdded = (evt: Event) => {
    const detail = (evt as CustomEvent<{ segmentationId?: string }>).detail;
    const csSegId = detail?.segmentationId;
    if (typeof csSegId === 'string' && csSegId.length > 0 && !csToContainer.has(csSegId)) {
      register(csSegId);
    }
  };

  onRemoved = (evt: Event) => {
    const detail = (evt as CustomEvent<{ segmentationId?: string }>).detail;
    const csSegId = detail?.segmentationId;
    if (typeof csSegId === 'string' && csSegId.length > 0) {
      unregister(csSegId);
    }
  };

  eventTarget.addEventListener(ToolEnums.Events.SEGMENTATION_ADDED, onAdded);
  eventTarget.addEventListener(ToolEnums.Events.SEGMENTATION_REMOVED, onRemoved);
  initialized = true;
}

/** Tear down the listener and clear all tracked state. */
export function dispose(): void {
  if (initialized && onAdded) {
    eventTarget.removeEventListener(ToolEnums.Events.SEGMENTATION_ADDED, onAdded);
  }
  if (initialized && onRemoved) {
    eventTarget.removeEventListener(ToolEnums.Events.SEGMENTATION_REMOVED, onRemoved);
  }
  onAdded = null;
  onRemoved = null;
  initialized = false;
  clearAll();
}

/** Drop every entry. Used by tests + service.dispose(). */
export function clearAll(): void {
  csToContainer.clear();
  containers.clear();
  containerCounter = 0;
}
