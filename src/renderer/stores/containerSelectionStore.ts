/**
 * Container Selection Store — the §A11 / §D7.5 active-member + selection-set
 * + hover-member surface for the multi-viewport list panel.
 *
 * Phase 3.5a. Three orthogonal pieces of state live here, each exposed
 * separately so subscribers can scope re-renders to just what they care
 * about:
 *
 *   - `activeMemberId`: the global "pen" — exactly one member is active
 *     at any time (per §A6 / §D7.5). Drawing tools write to this member.
 *   - `selectionSet`: a Set<memberId> for inspection. Multiple members
 *     can be selected simultaneously; selection is independent of which
 *     member is active.
 *   - `hoverMemberId`: transient hover state used by Phase 3.5b for the
 *     row ↔ viewport sync (D7.8).
 *
 * Why a dedicated store instead of folding into viewerStore: viewerStore
 * is already large (~120 fields) and its concerns are layout / panels /
 * hanging protocols / MPR. Member-level selection is a separate concern
 * that components and the containerService both consume; a dedicated
 * store keeps the surface clear and avoids viewerStore bloat.
 *
 * The store does NOT mutate Cornerstone state — that's containerService's
 * job. setActive here is a pure store mutation; containerService.setActiveMember
 * additionally wires through to segmentationService.setActiveSegmentationId /
 * setActiveSegmentIndex.
 */
import { create } from 'zustand';

interface ContainerSelectionState {
  activeMemberId: string | null;
  selectionSet: ReadonlySet<string>;
  hoverMemberId: string | null;

  /**
   * Set the active member. Pass null to clear. Drawing tools read this
   * via containerService.getActiveMember.
   */
  setActive: (memberId: string | null) => void;

  /**
   * Replace the selection set with a single member (or clear). Used by
   * single-click in the list panel (D7.5).
   */
  setSelection: (memberId: string | null) => void;

  /**
   * Replace the selection set with an arbitrary set. Used by bulk
   * operations (Phase 3.7).
   */
  setSelectionSet: (memberIds: Iterable<string>) => void;

  /**
   * Toggle a member's membership in the selection set. Used by
   * shift/ctrl-click in the list panel (D7.5 multi-select).
   */
  toggleSelection: (memberId: string) => void;

  /** Clear the selection set entirely. */
  clearSelection: () => void;

  /** Set the hover member (D2 / D7.8). Pass null to clear. */
  setHover: (memberId: string | null) => void;
}

export const useContainerSelectionStore = create<ContainerSelectionState>((set) => ({
  activeMemberId: null,
  selectionSet: new Set<string>(),
  hoverMemberId: null,

  setActive: (memberId) =>
    set((state) => (state.activeMemberId === memberId ? {} : { activeMemberId: memberId })),

  setSelection: (memberId) =>
    set(() => ({
      selectionSet: memberId ? new Set([memberId]) : new Set<string>(),
    })),

  setSelectionSet: (memberIds) =>
    set(() => ({
      selectionSet: new Set(memberIds),
    })),

  toggleSelection: (memberId) =>
    set((state) => {
      if (!memberId) return {};
      const next = new Set(state.selectionSet);
      if (next.has(memberId)) {
        next.delete(memberId);
      } else {
        next.add(memberId);
      }
      return { selectionSet: next };
    }),

  clearSelection: () => set({ selectionSet: new Set<string>() }),

  setHover: (memberId) =>
    set((state) => (state.hoverMemberId === memberId ? {} : { hoverMemberId: memberId })),
}));
