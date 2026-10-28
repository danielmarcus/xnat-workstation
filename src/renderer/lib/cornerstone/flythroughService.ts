/**
 * Auto Review flythrough engine (SegWorks parity D6, #213–221).
 *
 * Steps a viewport through the slices occupied by a segmentation — the bounds of the
 * chosen segments, in the viewport's own numbering — dwelling on each. With flicker on,
 * each slice shows the anatomy alone first, then the masks, so the outline can be judged
 * against the image. Pause, resume and stop; stopping always restores the masks.
 *
 * The flicker hides the labelmap on THIS viewport only and does not touch the panel's
 * visibility state (it is a temporary display, not an edit); segments the user had
 * hidden stay hidden. A shared volume labelmap's visibility is viewport-wide in
 * Cornerstone, so on an MPR the flicker shows in its sibling planes too.
 */
import { Enums as ToolEnums, segmentation as csSegmentation, utilities as csToolUtilities } from '@cornerstonejs/tools';
import * as mlg from './multiLayerGroup';
import { viewportService } from './viewportService';
import { occupiedDisplaySlices } from './sliceTrack';
import { discardPreview } from './maskPreview';
import { hotkeyService } from '../hotkeys/hotkeyService';
import { useFlythroughStore } from '../../stores/flythroughStore';
import { useHudStore } from '../../stores/hudStore';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { useSegmentationManagerStore } from '../../stores/segmentationManagerStore';
import { useViewerStore } from '../../stores/viewerStore';

/** Slices to visit, in order: the bounds [lo, hi], from an end or from the current slice. */
export function flythroughSequence(
  lo: number,
  hi: number,
  direction: 'forward' | 'backward',
  startFrom: 'bounds' | 'current',
  current: number,
): number[] {
  if (hi < lo) return [];
  const out: number[] = [];
  if (direction === 'forward') {
    const start = startFrom === 'current' ? Math.min(hi, Math.max(lo, current)) : lo;
    for (let d = start; d <= hi; d++) out.push(d);
  } else {
    const start = startFrom === 'current' ? Math.min(hi, Math.max(lo, current)) : hi;
    for (let d = start; d >= lo; d--) out.push(d);
  }
  return out;
}

interface Run {
  viewportId: string;
  /** (Cornerstone segmentation id, value) pairs flickered on this viewport. */
  layers: Array<{ csSegmentationId: string; value: number }>;
  sequence: number[];
  i: number;
  timer: ReturnType<typeof setTimeout> | null;
  removeKeyLayer: () => void;
}

let run: Run | null = null;

function setLayersVisible(r: Run, visible: boolean): void {
  for (const { csSegmentationId, value } of r.layers) {
    try {
      csSegmentation.config.visibility.setSegmentIndexVisibility(
        r.viewportId,
        { segmentationId: csSegmentationId, type: ToolEnums.SegmentationRepresentations.Labelmap },
        value,
        visible,
      );
    } catch { /* not on this viewport */ }
  }
  try { csToolUtilities.segmentation.triggerSegmentationRender(r.viewportId); } catch { /* best-effort */ }
}

function schedule(fn: () => void, ms: number): void {
  if (!run) return;
  run.timer = setTimeout(fn, ms);
}

function visit(): void {
  const r = run;
  if (!r) return;
  const st = useFlythroughStore.getState();
  if (st.paused) return;
  if (r.i >= r.sequence.length) {
    stopFlythrough();
    return;
  }
  viewportService.scrollToSlice(r.viewportId, r.sequence[r.i]);
  useFlythroughStore.setState({ step: r.i + 1 });
  const next = () => {
    if (!run) return;
    run.i += 1;
    visit();
  };
  if (st.flicker && r.layers.length) {
    setLayersVisible(r, false);
    useFlythroughStore.setState({ anatomyPhase: true });
    schedule(() => {
      if (!run) return;
      setLayersVisible(run, true);
      useFlythroughStore.setState({ anatomyPhase: false });
      schedule(next, useFlythroughStore.getState().maskMs);
    }, st.anatomyMs);
  } else {
    schedule(next, st.maskMs);
  }
}

export type StartResult = { ok: true; steps: number } | { ok: false; reason: 'no-container' | 'nothing-segmented' };

/** Start reviewing `containerId` on `viewportId` (defaults: the active ones). Restarts if running. */
export function startFlythrough(containerId?: string | null, viewportId?: string | null): StartResult {
  stopFlythrough();
  const seg = useSegmentationStore.getState();
  const cid = containerId ?? seg.activeSegmentationId;
  const vpId = viewportId ?? useViewerStore.getState().activeViewportId;
  const summary = seg.segmentations.find((s) => s.segmentationId === cid);
  if (!cid || !vpId || !summary) return { ok: false, reason: 'no-container' };

  const st = useFlythroughStore.getState();
  // The segment filter belongs to the container it was chosen in: segment numbers mean nothing
  // in another (its review found "nothing segmented", or only some segments).
  const filtered = st.segmentIndices.length && st.segmentIndicesFor === cid;
  if (st.segmentIndices.length && !filtered) useFlythroughStore.setState({ segmentIndices: [], segmentIndicesFor: null });
  const chosen = filtered
    ? summary.segments.filter((m) => st.segmentIndices.includes(m.segmentIndex))
    : summary.segments;
  const occupied = new Set<number>();
  for (const m of chosen) for (const d of occupiedDisplaySlices(vpId, cid, m.segmentIndex) ?? []) occupied.add(d);
  if (occupied.size === 0) {
    useHudStore.getState().show('Nothing segmented to review');
    return { ok: false, reason: 'nothing-segmented' };
  }
  const lo = Math.min(...occupied);
  const hi = Math.max(...occupied);
  const current = useViewerStore.getState().viewports[vpId]?.imageIndex ?? lo;
  const sequence = flythroughSequence(lo, hi, st.direction, st.startFrom, current);

  // Flicker only segments that are showing now (as the panel shows them).
  const pres = useSegmentationManagerStore.getState().presentation[cid];
  const layers = summary.segments
    .filter((m) => pres?.visibility?.[m.segmentIndex] ?? m.visible)
    .map((m) => mlg.isMultiLayerGroup(cid)
      ? { csSegmentationId: mlg.resolveSubSegId(cid, m.segmentIndex) ?? '', value: 1 }
      : { csSegmentationId: cid, value: m.segmentIndex })
    .filter((l) => l.csSegmentationId);

  discardPreview(); // the player takes the preview bar's place
  const removeKeyLayer = hotkeyService.pushKeyLayer({
    onKeyDown: (e) => {
      if (e.key === 'Escape') { stopFlythrough(); return true; }
      if (e.key === ' ' && !e.shiftKey && !e.ctrlKey && !e.metaKey) { togglePause(); return true; }
      return false;
    },
  });
  run = { viewportId: vpId, layers, sequence, i: 0, timer: null, removeKeyLayer };
  useFlythroughStore.setState({
    running: true, paused: false, viewportId: vpId, containerId: cid, lo, hi, step: 0, steps: sequence.length, anatomyPhase: false,
  });
  visit();
  return { ok: true, steps: sequence.length };
}

export function togglePause(): void {
  if (!run) return;
  const paused = !useFlythroughStore.getState().paused;
  if (run.timer) clearTimeout(run.timer);
  run.timer = null;
  setLayersVisible(run, true); // never leave the masks off while paused
  useFlythroughStore.setState({ paused, anatomyPhase: false });
  if (!paused) visit();
}

export function stopFlythrough(): void {
  const r = run;
  if (!r) return;
  run = null;
  if (r.timer) clearTimeout(r.timer);
  setLayersVisible(r, true);
  r.removeKeyLayer();
  useFlythroughStore.setState({ running: false, paused: false, anatomyPhase: false, step: 0 });
}

export function isFlythroughRunning(): boolean {
  return run !== null;
}
