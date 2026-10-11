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
  getCamera: () => { position: number[]; focalPoint: number[]; viewUp: number[] };
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

function attach(vp: Vp3d): void {
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
          components: out.components.map((c) => ({ id: c.id, voxels: c.voxels, volumeCc: c.volumeCc, bbox: c.bbox, centroidWorld: c.centroidWorld })),
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

  /** For tests and picking: the built components (world-space meshes). */
  builtComponents(): ReadonlyArray<{ segmentIndex: number; componentId: number; mesh: QcMesh; visible: boolean }> {
    return built.map((b) => ({ segmentIndex: b.segmentIndex, componentId: b.componentId, mesh: b.mesh, visible: b.actor.getVisibility() }));
  },
};
