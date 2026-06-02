/**
 * containerPanelResolver — bridges per-viewport visibility (owned by
 * the segmentation manager) into the panel's "which viewports show
 * this container" lookup. Spec §5.2 / §5.8.
 *
 * Pure derivation: takes a `(viewportId) → Set<containerId> | null`
 * resolver (the existing `segmentationManager
 * .getVisibleSegmentationIdsForViewport`) and inverts it across an
 * array of viewport ids to produce `containerId → panelIds[]`.
 *
 * `null` from the inner resolver means "show all segmentations on
 * that viewport" (the fallback path for local drag-and-drop files).
 * In that case, every container is considered present on that
 * viewport.
 *
 * Stable inversion + sorted output so React memoisation works.
 */

export type VisibleResolver = (viewportId: string) => Set<string> | null;

/**
 * Invert the per-viewport visibility map.
 *
 * @param viewportIds   The currently rendered viewports.
 * @param allContainerIds Every container in the session — needed so
 *   "show all" viewports include every container in their list.
 * @param resolve       Per-viewport visibility callback.
 *
 * @returns A plain object keyed by containerId; values are sorted
 *   viewportId arrays. Containers missing from any visibility set
 *   land in the map with an empty array.
 */
export function buildContainerPanelMap(
  viewportIds: ReadonlyArray<string>,
  allContainerIds: ReadonlyArray<string>,
  resolve: VisibleResolver,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const cid of allContainerIds) out[cid] = [];
  for (const vp of viewportIds) {
    const visible = resolve(vp);
    if (visible === null) {
      // "show all" viewport → every container is considered present.
      for (const cid of allContainerIds) out[cid].push(vp);
      continue;
    }
    for (const cid of visible) {
      if (!out[cid]) out[cid] = [];
      out[cid].push(vp);
    }
  }
  // Sort each panel list so output is deterministic.
  for (const cid of Object.keys(out)) out[cid].sort();
  return out;
}

/** Convenience: list the viewports that show a specific container. */
export function viewportsForContainer(
  containerId: string,
  viewportIds: ReadonlyArray<string>,
  resolve: VisibleResolver,
): string[] {
  const out: string[] = [];
  for (const vp of viewportIds) {
    const visible = resolve(vp);
    if (visible === null || visible.has(containerId)) out.push(vp);
  }
  return out.sort();
}

/**
 * Short label for the "↗ panel_X" / "↗ N panels" pill (spec §5.2).
 * Returns `null` when the container is on the active viewport (no
 * pill needed).
 */
export function pillLabelForContainer(
  panelIds: ReadonlyArray<string>,
  activeViewportId: string,
): string | null {
  if (panelIds.includes(activeViewportId)) return null;
  if (panelIds.length === 0) return '↗ not loaded';
  if (panelIds.length === 1) return `↗ ${panelIds[0]}`;
  return `↗ ${panelIds.length} panels`;
}

/** Tooltip text — verbose list of every panel a container is on. */
export function pillTooltipForContainer(panelIds: ReadonlyArray<string>): string {
  if (panelIds.length === 0) return 'Not currently shown on any viewport.';
  return `Shown on: ${panelIds.join(', ')}`;
}
