/**
 * Annotation container lifecycle — pure logic, no store or Cornerstone imports.
 *
 * `decideOrphans` (below) is the live rule: what happens to each loaded container when
 * the viewer loads a scan. It replaced A13/Change 1c's `decideSessionLifecycle`, which
 * asked only "did the session change?" and answered by retaining dirty work from the
 * session being left — see the note above decideOrphans for why that had to change.
 *
 * `sessionsWithUnsaved` remains: the cross-session unsaved-work banner still needs to
 * name the sessions holding unsaved work, whatever decided they were loaded.
 */
export interface LoadedContainerRef {
  containerId: string;
  /** The XNAT session this container belongs to. */
  sessionId: string;
  dirty: boolean;
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

// ─── Viewport-scoped orphaning (proposal §4.2) ───────────────────────────────
//
// The successor to decideSessionLifecycle. That function asked "did the session
// change?", and answered by RETAINING dirty work from the session being left — which
// is how a container ends up listed in the panel while rendering in no viewport, with
// a scan-id badge that is blank precisely because it was never saved. Unsaved work was
// never lost, but it also became unidentifiable.
//
// This asks a different question: "will this container still be shown anywhere once
// the load completes?" A container visible in another viewport is not leaving, whatever
// the session did. That is what makes a load into a SECOND viewport prompt-free (GH #75)
// by construction rather than by a carve-out, and it is the rule the user decided on
// (proposal §9.1).

export interface AttachedContainerRef extends LoadedContainerRef {
  /** Viewports this container currently renders on. Empty ⇒ already not shown. */
  viewportIds: string[];
}

/** The load that is about to happen, described before anything has been mutated. */
export interface PendingViewportLoad {
  /**
   * The viewport whose content is being replaced; its current containers detach.
   * `null` when nothing is being replaced — a derived scan (SEG / RTSTRUCT / SR) loads
   * as an OVERLAY onto the source images already shown, so it takes nothing away. Only
   * a session switch can orphan anything in that case.
   */
  viewportId: string | null;
  /** Session the incoming scan belongs to. */
  toSessionId: string;
  /** Session currently displayed; null on the first load of the app. */
  fromSessionId: string | null;
}

export type OrphanDisposition =
  /** Still shown somewhere afterwards — nothing to do. */
  | 'keep'
  /** Leaving, with nothing unsaved — unload it silently. */
  | 'unload'
  /** Leaving with unsaved work — ask the user before the load proceeds. */
  | 'prompt';

export interface OrphanDecision {
  containerId: string;
  disposition: OrphanDisposition;
}

export function decideOrphans(params: {
  load: PendingViewportLoad;
  containers: AttachedContainerRef[];
}): OrphanDecision[] {
  const { load, containers } = params;
  // A first load has nothing to leave: fromSessionId is null only before any session is
  // displayed, so treating it as a switch would prompt about containers on app start.
  const sessionSwitch = load.fromSessionId != null && load.fromSessionId !== load.toSessionId;

  return containers.map((c) => {
    // A container attached nowhere is already invisible; the load does not take anything
    // away from it, so it is not "leaving" and must not raise a prompt about this load.
    if (c.viewportIds.length === 0) return { containerId: c.containerId, disposition: 'keep' };

    // A session switch detaches every container that does not belong to the incoming
    // session, from every viewport at once — not just the one being loaded into.
    const remaining =
      sessionSwitch && c.sessionId !== load.toSessionId
        ? []
        : c.viewportIds.filter((vp) => vp !== load.viewportId);

    if (remaining.length > 0) return { containerId: c.containerId, disposition: 'keep' };
    return { containerId: c.containerId, disposition: c.dirty ? 'prompt' : 'unload' };
  });
}

/** The containers the user must decide about before the load can proceed. */
export function containersNeedingDecision(decisions: OrphanDecision[]): string[] {
  return decisions.filter((d) => d.disposition === 'prompt').map((d) => d.containerId);
}

/** The containers to unload once the user has decided (or when no one needed asking). */
export function containersToUnload(decisions: OrphanDecision[]): string[] {
  return decisions.filter((d) => d.disposition !== 'keep').map((d) => d.containerId);
}
