/**
 * Session lifecycle decision (Lifecycle track L1 — A13).
 *
 * Pure logic for what happens to each loaded annotation container when the viewer
 * moves between sessions (or navigates scans within one):
 *  - **Same session** (scan-navigate within a session): every container is KEPT —
 *    the panel is preserved; only per-viewport FoR-eligibility re-renders (A2).
 *  - **Session switch**: containers belonging to the session being switched TO are
 *    KEPT; containers of OTHER sessions are UNLOADED if clean, but RETAINED (in
 *    memory, unsaved) if dirty — so unsaved work is never silently dropped (E5).
 *    Retained-dirty sessions surface via the unsaved-work banner (L3).
 *
 * No store/Cornerstone imports — the App/segmentationManager integration (L2) reads
 * loaded containers + dirty flags and applies these dispositions.
 */
export interface LoadedContainerRef {
  containerId: string;
  /** The XNAT session this container belongs to. */
  sessionId: string;
  dirty: boolean;
}

export type ContainerDisposition = 'keep' | 'retain-unsaved' | 'unload';

export interface LifecycleDecision {
  containerId: string;
  disposition: ContainerDisposition;
}

export function decideSessionLifecycle(params: {
  fromSessionId: string | null;
  toSessionId: string;
  containers: LoadedContainerRef[];
}): LifecycleDecision[] {
  const { fromSessionId, toSessionId, containers } = params;
  const sameSession = fromSessionId === toSessionId;
  return containers.map((c) => {
    if (sameSession) return { containerId: c.containerId, disposition: 'keep' };
    if (c.sessionId === toSessionId) return { containerId: c.containerId, disposition: 'keep' };
    return { containerId: c.containerId, disposition: c.dirty ? 'retain-unsaved' : 'unload' };
  });
}

/**
 * Distinct OTHER-session ids whose dirty containers are retained (drives the
 * unsaved-work banner). Containers of the active session are excluded.
 */
export function sessionsWithUnsaved(containers: LoadedContainerRef[], activeSessionId: string): string[] {
  const out = new Set<string>();
  for (const c of containers) {
    if (c.dirty && c.sessionId !== activeSessionId) out.add(c.sessionId);
  }
  return Array.from(out);
}

/** Per-session count of retained, unsaved OTHER-session containers (L3 banner row). */
export interface UnsavedSessionSummary {
  sessionId: string;
  count: number;
}

/**
 * Summarize retained unsaved work by OTHER session for the unsaved-work banner
 * (L3 / A13 / E5). Reads the projected container shape directly (source.sessionId
 * + dirty). Containers of the active session, or with no session (unsaved local /
 * not-yet-on-XNAT), are excluded — the banner is about work stranded on a session
 * you've navigated away from. Pure: no store/Cornerstone imports.
 */
export function unsavedWorkBySession(
  containers: Array<{ source: { sessionId: string }; dirty?: boolean }>,
  activeSessionId: string | null,
): UnsavedSessionSummary[] {
  const counts = new Map<string, number>();
  for (const c of containers) {
    const sid = c.source.sessionId;
    if (!sid || sid === activeSessionId) continue;
    if (!c.dirty) continue;
    counts.set(sid, (counts.get(sid) ?? 0) + 1);
  }
  return Array.from(counts, ([sessionId, count]) => ({ sessionId, count }));
}
