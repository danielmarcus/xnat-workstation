/**
 * 3D segmentation QC (SegWorks parity branch 7, D9): builds a surface per connected
 * component of every member of the active Segmentation (in the compute worker), shows them
 * as vtk actors in the “2D + 3D QC” layout's 3D view, and applies the sheet's display
 * settings — per-label visibility, hide largest, stray/speck highlight, selection, lighting,
 * auto-rotate.
 *
 * Nothing rebuilds by itself: an edit marks the surfaces stale and the sheet offers Rebuild.
 */
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { viewportService } from './viewportService';
import { readSegmentVoxelGrid } from './segmentVoxelGrid';
import { onLabelmapModified } from './sliceTrack';
import { computeClient, ComputeCancelled } from '../compute/computeClient';
import { classifyComponents, type ComponentBand } from '../segmentation/qc3d/components';
import type { QcMesh } from '../segmentation/qc3d/build';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { useQc3dStore, type Qc3dLabelReport } from '../../stores/qc3dStore';
import { useUnifiedLayoutStore } from '../../stores/unifiedLayoutStore';
import { beginTransaction } from './labelmapTransaction';
import { sliceAxisFor } from './maskIslands';
import { sliceNumbering } from './sliceNumbering';
import { pickNearest } from '../segmentation/qc3d/pick';
import { scissorCut } from '../segmentation/qc3d/scissor';
import { indexToWorld, type Vec3 } from './segmentationService/voxelClipboard';
import { startPreview, discardPreview } from './maskPreview';
import type { Axis } from '../segmentation/maskOps/planeIO';

export const QC3D_ACTOR_PREFIX = 'qc3d:';
/** The 3D panel of the QC layout (mirrors hooks/useViewportLayout's QC_3D_PANEL_ID). */
export const QC3D_VIEWPORT_ID = 'panel_qc3d';

const STRAY_RGB: [number, number, number] = [251, 191, 36];
const SPECK_RGB: [number, number, number] = [248, 113, 113];
const SELECTED_RGB: [number, number, number] = [255, 255, 255];

type ActorLike = ReturnType<typeof vtkActor.newInstance>;

interface Built {
  segmentIndex: number;
  componentId: number;
  actor: ActorLike;
  mesh: QcMesh;
}

let built: Built[] = [];
let job: { cancel: () => void } | null = null;
let rotateTimer: ReturnType<typeof setInterval> | null = null;
let stopStaleWatch: (() => void) | null = null;

type Vp3d = {
  addActor: (e: { uid: string; actor: unknown }) => void;
  removeActors: (uids: string[]) => void;
  getActors: () => Array<{ uid: string; actor: { setVisibility?: (v: boolean) => void; getClassName?: () => string } }>;
  resetCamera: () => void;
  render: () => void;
  getVtkActiveCamera?: () => VtkCamera;
  getRenderer?: () => { resetCameraClippingRange: () => void } | undefined;
  getCamera: () => { position: number[]; focalPoint: number[]; viewUp: number[]; viewPlaneNormal: number[] };
  canvasToWorld: (p: number[]) => number[];
  worldToCanvas: (w: number[]) => number[];
  element: HTMLElement;
  setCamera: (c: { focalPoint: number[]; position: number[]; viewUp: number[]; parallelScale: number }) => void;
};

type VtkCamera = {
  azimuth: (deg: number) => void;
  elevation: (deg: number) => void;
  orthogonalizeViewUp: () => void;
};

/**
 * A three-quarter view (one-slice regions are edge-on from the front) fitted to the
 * surfaces, not the whole scan — a lesion should fill the view, not be a dot in it.
 */
function standardView(vp: Vp3d): void {
  vp.resetCamera();
  const cam = vp.getVtkActiveCamera?.();
  if (!cam) return;
  cam.azimuth(35);
  cam.elevation(25);
  cam.orthogonalizeViewUp();
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const b of built) {
    const P = b.mesh.positions;
    for (let v = 0; v < P.length; v += 3) for (let d = 0; d < 3; d++) {
      if (P[v + d] < lo[d]) lo[d] = P[v + d];
      if (P[v + d] > hi[d]) hi[d] = P[v + d];
    }
  }
  if (!(hi[0] >= lo[0])) return;
  const centre = [0, 1, 2].map((d) => (lo[d] + hi[d]) / 2);
  const radius = Math.max(5, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2);
  // Through Cornerstone's camera API: it keeps its own copy of the camera.
  const c = vp.getCamera();
  const dir = [0, 1, 2].map((d) => c.position[d] - c.focalPoint[d]);
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const dist = radius * 4;
  const aspect = vp.element.clientHeight ? vp.element.clientWidth / vp.element.clientHeight : 1;
  vp.setCamera({
    focalPoint: centre,
    position: centre.map((v, d) => v + (dir[d] / len) * dist),
    viewUp: c.viewUp,
    // parallelScale is half the view's HEIGHT: in a tall, narrow view the width binds.
    parallelScale: (radius * 1.15) / Math.min(1, aspect),
  });
  vp.getRenderer?.()?.resetCameraClippingRange();
}

function viewport3d(): Vp3d | null {
  const vp = viewportService.getViewport(QC3D_VIEWPORT_ID) as unknown as Vp3d | undefined;
  return vp && typeof vp.addActor === 'function' ? vp : null;
}

/** The 3D view exists once its volume is set (an actor that is not ours). */
async function waitFor3d(timeoutMs = 20_000): Promise<Vp3d | null> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const vp = viewport3d();
    if (vp && vp.getActors().some((a) => !a.uid.startsWith(QC3D_ACTOR_PREFIX))) return vp;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

function actorFor(mesh: QcMesh): ActorLike {
  const poly = vtkPolyData.newInstance();
  poly.getPoints().setData(mesh.positions, 3);
  const cells = new Uint32Array((mesh.indices.length / 3) * 4);
  for (let t = 0, c = 0; t < mesh.indices.length; t += 3) {
    cells[c++] = 3;
    cells[c++] = mesh.indices[t];
    cells[c++] = mesh.indices[t + 1];
    cells[c++] = mesh.indices[t + 2];
  }
  poly.getPolys().setData(cells);
  poly.getPointData().setNormals(vtkDataArray.newInstance({ numberOfComponents: 3, values: mesh.normals, name: 'Normals' }));
  const mapper = vtkMapper.newInstance();
  mapper.setInputData(poly);
  const actor = vtkActor.newInstance();
  actor.setMapper(mapper);
  return actor;
}

function bandsOf(report: Qc3dLabelReport): Map<number, ComponentBand> {
  const s = useQc3dStore.getState().settings;
  const bands = classifyComponents(report.components.map((c) => ({ ...c, centroid: [0, 0, 0] as [number, number, number] })), {
    strayVoxels: s.strayVoxels, speckVoxels: s.speckVoxels,
  });
  return new Map(report.components.map((c, i) => [c.id, bands[i]]));
}

/** Apply visibility, colour and lighting from the store to the built actors, and render. */
export function applyQcDisplay(): void {
  const st = useQc3dStore.getState();
  const s = st.settings;
  const bandMaps = new Map(st.report.map((r) => [r.segmentIndex, bandsOf(r)]));
  for (const b of built) {
    const report = st.report.find((r) => r.segmentIndex === b.segmentIndex);
    const band = bandMaps.get(b.segmentIndex)?.get(b.componentId) ?? 'main';
    const hidden = st.hiddenSegments.includes(b.segmentIndex) || (s.hideLargest && band === 'main');
    b.actor.setVisibility(!hidden);
    const selected = st.selected?.segmentIndex === b.segmentIndex && st.selected.componentId === b.componentId;
    const rgb = selected ? SELECTED_RGB
      : s.showStrays && band === 'stray' ? STRAY_RGB
      : s.showStrays && band === 'speck' ? SPECK_RGB
      : report?.color ?? [200, 200, 200];
    const p = b.actor.getProperty();
    p.setColor(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
    p.setDiffuse(s.brightness);
    p.setAmbient(selected ? Math.max(0.6, s.ambient) : s.ambient);
    p.setSpecular(0.15);
  }
  viewport3d()?.render();
}

function detach(): void {
  const vp = viewport3d();
  if (vp) {
    vp.removeActors(vp.getActors().filter((a) => a.uid.startsWith(QC3D_ACTOR_PREFIX)).map((a) => a.uid));
    for (const a of vp.getActors()) a.actor.setVisibility?.(true);
    vp.render();
  }
}

const picking = new WeakSet<HTMLElement>();

/** A click (not a drag — that rotates) on the 3D view selects the component under it. */
function installPicking(vp: Vp3d): void {
  const el = vp.element;
  if (picking.has(el)) return;
  picking.add(el);
  let down: { x: number; y: number } | null = null;
  el.addEventListener('pointerdown', (e) => {
    down = e.button === 0 && !e.shiftKey && !useQc3dStore.getState().scissor.on ? { x: e.clientX, y: e.clientY } : null;
  });
  el.addEventListener('pointerup', (e) => {
    const d = down;
    down = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4 || !built.length) return;
    const v = viewport3d();
    if (!v) return;
    const r = v.element.getBoundingClientRect();
    const hit = qc3dService.pickAt(v.canvasToWorld([e.clientX - r.left, e.clientY - r.top]), v.getCamera().viewPlaneNormal);
    if (hit) qc3dService.select(hit.segmentIndex, hit.componentId);
    else useQc3dStore.getState().set({ selected: null });
  });
}

const scissorHosts = new WeakSet<HTMLElement>();
const LASSO_TESTID = 'qc3d-lasso';

/**
 * Scissor mode: a drag on the 3D view draws a lasso. The press is taken as a POINTER event
 * in the capture phase on the panel and cancelled, so Cornerstone's rotate tool (which
 * listens for the mouse events a cancelled pointerdown suppresses) never sees it — and a
 * handler elsewhere cancelling pointerdown (as the lock guard does) cannot starve us of a
 * mousedown that never comes.
 */
function installScissor(vp: Vp3d): void {
  const host = vp.element.parentElement;
  if (!host || scissorHosts.has(host)) return;
  scissorHosts.add(host);
  host.addEventListener('pointerdown', (e) => {
    if (!useQc3dStore.getState().scissor.on || e.button !== 0) return;
    const v = viewport3d();
    if (!v || !v.element.contains(e.target as Node)) return;
    e.preventDefault();
    e.stopPropagation();
    const r = v.element.getBoundingClientRect();
    const pts: Array<[number, number]> = [[e.clientX - r.left, e.clientY - r.top]];
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('data-testid', LASSO_TESTID);
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:7';
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('fill', 'rgba(250, 204, 21, 0.12)');
    line.setAttribute('stroke', 'rgb(250, 204, 21)');
    line.setAttribute('stroke-width', '1.5');
    line.setAttribute('stroke-dasharray', '5 3');
    svg.appendChild(line);
    v.element.appendChild(svg);
    const draw = () => line.setAttribute('points', pts.map((p) => p.join(',')).join(' '));
    const move = (ev: PointerEvent) => { pts.push([ev.clientX - r.left, ev.clientY - r.top]); draw(); };
    const up = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      svg.remove();
      if (pts.length >= 3) qc3dService.scissorCut(pts);
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
  }, true);
}

function attach(vp: Vp3d): void {
  installPicking(vp);
  installScissor(vp);
  vp.removeActors(vp.getActors().filter((a) => a.uid.startsWith(QC3D_ACTOR_PREFIX)).map((a) => a.uid));
  // The volume rendering would hide the surfaces; it comes back when QC closes.
  for (const a of vp.getActors()) a.actor.setVisibility?.(false);
  for (const b of built) vp.addActor({ uid: `${QC3D_ACTOR_PREFIX}${b.segmentIndex}:${b.componentId}`, actor: b.actor });
  standardView(vp);
  applyQcDisplay();
}

export const qc3dService = {
  /** Build surfaces for every member of the active Segmentation and show them. */
  async build(): Promise<boolean> {
    const store = useQc3dStore.getState();
    const seg = useSegmentationStore.getState();
    const containerId = seg.activeSegmentationId;
    const summary = seg.segmentations.find((c) => c.segmentationId === containerId);
    if (!containerId || !summary) {
      store.set({ message: 'Select a Segmentation first' });
      return false;
    }
    job?.cancel();
    const s = store.settings;
    const next: Built[] = [];
    const report: Qc3dLabelReport[] = [];
    store.set({ building: 0, message: null });
    const members = summary.segments;
    try {
      for (let m = 0; m < members.length; m++) {
        const member = members[m];
        const grid = readSegmentVoxelGrid(containerId, member.segmentIndex);
        if (!grid) continue;
        const mask = Uint8Array.from(grid.data as ArrayLike<number>, (v) => (v === grid.value ? 1 : 0));
        const g = grid.geometry;
        const run = computeClient.run('qcSurfaces', {
          mask,
          geometry: { dimensions: [g.dimensions[0], g.dimensions[1], g.dimensions[2]], spacing: [g.spacing[0], g.spacing[1], g.spacing[2]], origin: [g.origin[0], g.origin[1], g.origin[2]], direction: [...g.direction] },
          resolution: s.resolution, renderer: s.renderer, smoothIterations: s.smoothIterations, thinBoost: s.thinBoost,
        }, {
          onProgress: (f) => useQc3dStore.getState().set({ building: (m + f) / members.length }),
          transfer: [mask.buffer],
        });
        job = run;
        const out = await run.result;
        report.push({
          segmentIndex: member.segmentIndex,
          label: member.label,
          color: [member.color[0], member.color[1], member.color[2]],
          components: out.components.map((c) => ({ id: c.id, voxels: c.voxels, volumeCc: c.volumeCc, bbox: c.bbox, centroidWorld: c.centroidWorld, seed: c.seed })),
        });
        for (const mesh of out.meshes) next.push({ segmentIndex: member.segmentIndex, componentId: mesh.componentId, actor: actorFor(mesh), mesh });
      }
    } catch (e) {
      useQc3dStore.getState().set({ building: null });
      if (!(e instanceof ComputeCancelled)) {
        console.warn('[qc3dService] build failed:', e);
        useQc3dStore.getState().set({ message: 'The 3D build failed — see the log' });
      }
      return false;
    } finally {
      job = null;
    }
    built = next;
    useQc3dStore.getState().set({ containerId, report, building: null, stale: false, selected: null });
    const vp = await waitFor3d();
    if (!vp) {
      useQc3dStore.getState().set({ message: 'The 3D view is not available for this scan' });
      return false;
    }
    attach(vp);
    return true;
  },

  /** Begin a QC session: watch for edits (stale), keep auto-rotate in step. */
  start(): void {
    stopStaleWatch?.();
    stopStaleWatch = onLabelmapModified(() => {
      if (built.length && !useQc3dStore.getState().building) useQc3dStore.getState().set({ stale: true });
    });
  },

  /** End the session: cancel a build, remove the surfaces, bring the volume rendering back. */
  stop(): void {
    job?.cancel();
    job = null;
    stopStaleWatch?.();
    stopStaleWatch = null;
    qc3dService.setAutoRotate(false);
    detach();
    built = [];
    useQc3dStore.getState().set({ report: [], building: null, stale: false, selected: null, containerId: null, message: null });
  },

  setAutoRotate(on: boolean): void {
    if (rotateTimer) { clearInterval(rotateTimer); rotateTimer = null; }
    if (!on) return;
    rotateTimer = setInterval(() => {
      const vp = viewport3d();
      if (!vp?.getVtkActiveCamera) return;
      vp.getVtkActiveCamera().azimuth(1.5);
      vp.render();
    }, 40);
  },

  resetView(): void {
    const vp = viewport3d();
    if (!vp) return;
    standardView(vp);
    vp.render();
  },

  /**
   * The visible component a view ray hits first: through `point` (on the focal plane) along
   * −`normal` (Cornerstone's viewPlaneNormal points toward the camera).
   */
  pickAt(point: number[], normal: number[]): { segmentIndex: number; componentId: number } | null {
    const far = 1e5;
    const origin = point.map((v, d) => v + normal[d] * far);
    const dir = normal.map((v) => -v);
    const hit = pickNearest(
      built.filter((b) => b.actor.getVisibility()).map((b) => ({ key: `${b.segmentIndex}:${b.componentId}`, positions: b.mesh.positions, indices: b.mesh.indices })),
      origin, dir,
    );
    if (!hit) return null;
    const [segmentIndex, componentId] = hit.key.split(':').map(Number);
    return { segmentIndex, componentId };
  },

  /** Select a component (highlighted in 3D) and bring the 2D viewport to it. */
  select(segmentIndex: number, componentId: number): void {
    useQc3dStore.getState().set({ selected: { segmentIndex, componentId } });
    qc3dService.jumpTo(segmentIndex, componentId);
  },

  /** Move the QC layout's 2D viewport to the slice through a component's centroid (#253). */
  jumpTo(segmentIndex: number, componentId: number): boolean {
    const st = useQc3dStore.getState();
    const row = st.report.find((r) => r.segmentIndex === segmentIndex)?.components.find((c) => c.id === componentId);
    const layout = useUnifiedLayoutStore.getState().layout;
    if (!row || layout.kind !== 'qc-3d' || !st.containerId) return false;
    const vp = viewportService.getViewport(layout.source) as unknown as {
      type?: string; jumpToWorld?: (w: number[]) => boolean; render?: () => void;
      getCamera?: () => { viewPlaneNormal?: number[] };
    } | undefined;
    if (!vp) return false;
    if (vp.type && vp.type !== 'stack' && typeof vp.jumpToWorld === 'function') {
      vp.jumpToWorld(row.centroidWorld);
      vp.render?.();
      return true;
    }
    const grid = readSegmentVoxelGrid(st.containerId, segmentIndex);
    const normal = vp.getCamera?.()?.viewPlaneNormal;
    if (!grid || !normal) return false;
    const axis = sliceAxisFor(grid.geometry.direction, normal) as Axis;
    const numbering = sliceNumbering(layout.source, grid.geometry, axis);
    if (!numbering) return false;
    const k = Math.round((row.bbox[axis] + row.bbox[axis + 3]) / 2);
    viewportService.scrollToIndex(layout.source, numbering.toDisplay(k));
    return true;
  },

  /** A component's slice range as the 2D viewport numbers its slices (1-based), or null. */
  sliceRange(segmentIndex: number, bbox: number[]): [number, number] | null {
    const st = useQc3dStore.getState();
    const layout = useUnifiedLayoutStore.getState().layout;
    if (layout.kind !== 'qc-3d' || !st.containerId) return null;
    const vp = viewportService.getViewport(layout.source) as unknown as { getCamera?: () => { viewPlaneNormal?: number[] } } | undefined;
    const normal = vp?.getCamera?.()?.viewPlaneNormal;
    const grid = readSegmentVoxelGrid(st.containerId, segmentIndex);
    if (!normal || !grid) return null;
    const axis = sliceAxisFor(grid.geometry.direction, normal) as Axis;
    const numbering = sliceNumbering(layout.source, grid.geometry, axis);
    if (!numbering) return null;
    const a = numbering.toDisplay(bbox[axis]) + 1, b = numbering.toDisplay(bbox[axis + 3]) + 1;
    return [Math.min(a, b), Math.max(a, b)];
  },

  /**
   * Delete a component from its member (#255): a 26-connected flood fill from its seed voxel,
   * written through a LabelmapTransaction — one undo step (#257). The surfaces rebuild.
   */
  async deleteComponent(segmentIndex: number, componentId: number): Promise<'ok' | 'locked' | 'missing'> {
    const st = useQc3dStore.getState();
    const row = st.report.find((r) => r.segmentIndex === segmentIndex)?.components.find((c) => c.id === componentId);
    if (!row || !st.containerId) return 'missing';
    const member = { containerId: st.containerId, segmentIndex };
    const begun = beginTransaction([member]);
    if (!begun.ok) return begun.reason === 'locked' ? 'locked' : 'missing';
    const txn = begun.txn;
    const grid = txn.grid(member);
    if (!grid || !txn.has(member, row.seed)) { txn.discard(); return 'missing'; }
    const [nx, ny, nz] = grid.geometry.dimensions;
    const nxy = nx * ny;
    const stack = [row.seed];
    txn.set(member, row.seed, false);
    while (stack.length) {
      const p = stack.pop()!;
      const k = Math.floor(p / nxy), j = Math.floor((p - k * nxy) / nx), i = p - k * nxy - j * nx;
      for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const x = i + di, y = j + dj, z = k + dk;
        if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) continue;
        const q = x + nx * (y + ny * z);
        if (txn.has(member, q)) { txn.set(member, q, false); stack.push(q); }
      }
    }
    txn.commit();
    useQc3dStore.getState().set({ selected: null });
    await qc3dService.build();
    return 'ok';
  },

  /**
   * The 3D scissor (#256): remove the active member's voxels whose projection falls inside
   * the lasso (canvas points), or keep only those, through the whole volume along the view.
   * Previews (⏎ applies, one undo step; a locked segment previews read-only); applying rebuilds.
   */
  scissorCut(lasso: Array<[number, number]>): boolean {
    const st = useQc3dStore.getState();
    const seg = useSegmentationStore.getState();
    const layout = useUnifiedLayoutStore.getState().layout;
    const vp = viewport3d();
    if (!vp || layout.kind !== 'qc-3d' || !seg.activeSegmentationId || !(seg.activeSegmentIndex > 0)) return false;
    const member = { containerId: seg.activeSegmentationId, segmentIndex: seg.activeSegmentIndex };
    let lockedMember: typeof member | null = null;
    let begun = beginTransaction([member]);
    if (!begun.ok && begun.reason === 'locked') {
      lockedMember = member;
      begun = beginTransaction([member], undefined, { allowLocked: true });
    }
    if (!begun.ok) return false;
    const txn = begun.txn;
    const grid = txn.grid(member);
    if (!grid) { txn.discard(); return false; }
    const g = grid.geometry;
    const at = (i: number, j: number, k: number) => vp.worldToCanvas(indexToWorld(g, [i, j, k] as Vec3));
    const c0 = at(0, 0, 0), ci = at(1, 0, 0), cj = at(0, 1, 0), ck = at(0, 0, 1);
    const proj = {
      c0: [c0[0], c0[1]] as [number, number],
      ci: [ci[0] - c0[0], ci[1] - c0[1]] as [number, number],
      cj: [cj[0] - c0[0], cj[1] - c0[1]] as [number, number],
      ck: [ck[0] - c0[0], ck[1] - c0[1]] as [number, number],
    };
    const mask = Uint8Array.from(grid.data as ArrayLike<number>, (v) => (v === grid.value ? 1 : 0));
    const cut = scissorCut(mask, [g.dimensions[0], g.dimensions[1], g.dimensions[2]], proj, lasso, st.scissor.remove);
    let n = 0;
    for (let f = 0; f < cut.length; f++) if (cut[f]) { txn.set(member, f, false); n++; }
    if (!n) {
      txn.discard();
      useQc3dStore.getState().set({ message: 'The lasso does not cross the active segment' });
      return false;
    }
    discardPreview();
    useQc3dStore.getState().set({ message: null });
    startPreview({
      txn, label: '3D scissor', summary: `−${n.toLocaleString('en-US')} voxels`, viewportId: layout.source, lockedMember,
      onDone: (committed) => { if (committed) void qc3dService.build(); },
    });
    return true;
  },

  /** For tests and picking: the built components (world-space meshes). */
  builtComponents(): ReadonlyArray<{ segmentIndex: number; componentId: number; mesh: QcMesh; visible: boolean }> {
    return built.map((b) => ({ segmentIndex: b.segmentIndex, componentId: b.componentId, mesh: b.mesh, visible: b.actor.getVisibility() }));
  },
};
