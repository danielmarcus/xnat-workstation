/**
 * X4 (#95): a mask operation reads only the planes it needs, straight from the labelmap
 * images. `readSegmentVoxelGrid` used to copy every member's whole stack into a new array —
 * a one-slice Cleanup on 10 members of 512² × 300 allocated ~1.5 GB. Here a stack-backed
 * multi-layer group is driven through the real reader, transaction and plane runner, and
 * every read of a labelmap image's pixels is counted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const images = new Map<string, unknown>();
const planes = new Map<string, unknown>();
const segmentations = new Map<string, unknown>();

vi.mock('@cornerstonejs/core', () => ({
  cache: { getImage: (id: string) => images.get(id), getVolume: () => undefined },
  metaData: { get: (type: string, id: string) => (type === 'imagePlaneModule' ? planes.get(id) : undefined) },
  utilities: {},
}));
vi.mock('@cornerstonejs/tools', () => ({
  segmentation: { state: { getSegmentation: (id: string) => segmentations.get(id), getViewportIdsWithSegmentation: () => [] } },
  utilities: { segmentation: {} },
}));
vi.mock('../multiLayerGroup', () => ({
  isMultiLayerGroup: (id: string) => id === 'G',
  resolveSubSegId: (_id: string, segmentIndex: number) => `G_layer_${segmentIndex}`,
}));

import { readSegmentVoxelGrid } from '../segmentVoxelGrid';
import { beginTransaction, type TransactionDeps } from '../labelmapTransaction';
import { runPlaneOp } from '../../segmentation/maskOps/scope';
import { fillHoles } from '../../segmentation/maskOps/cleanup';

const NX = 32;
const NY = 24;
const NZ = 30;
const MEMBERS = 10;

/** reads[`${member}|${k}`] = pixel-array reads of member's labelmap image for grid slice k. */
let reads: Map<string, number>;
let pixels: Map<string, Uint8Array>;

function setup() {
  images.clear();
  planes.clear();
  segmentations.clear();
  reads = new Map();
  pixels = new Map();
  for (let m = 1; m <= MEMBERS; m++) {
    const imageIds: string[] = [];
    // Stack order deliberately reversed against the slice normal: grid k = NZ - 1 - stack index.
    for (let s = 0; s < NZ; s++) {
      const k = NZ - 1 - s;
      const id = `lm:${m}:${k}`;
      const px = new Uint8Array(NX * NY);
      // Member m: a ring with a one-pixel hole, centred at (2 + 3m, 12), on every slice.
      const cx = 2 + 3 * (m - 1) + 1;
      for (let y = 10; y <= 12; y++) for (let x = cx - 1; x <= cx + 1; x++) px[x + y * NX] = 1;
      px[cx + 11 * NX] = 0;
      pixels.set(`${m}|${k}`, px);
      images.set(id, {
        referencedImageId: `src:${k}`,
        voxelManager: {
          getScalarData: () => {
            reads.set(`${m}|${k}`, (reads.get(`${m}|${k}`) ?? 0) + 1);
            return px;
          },
          setAtIndex: (i: number, v: number) => { px[i] = v; },
        },
      });
      planes.set(id, {
        rows: NY, columns: NX, imagePositionPatient: [0, 0, 2 * k], rowCosines: [1, 0, 0], columnCosines: [0, 1, 0],
        rowPixelSpacing: 1, columnPixelSpacing: 1,
      });
      imageIds.push(id);
    }
    segmentations.set(`G_layer_${m}`, { representationData: { Labelmap: { imageIds } } });
  }
}

const deps: TransactionDeps = {
  readGrid: readSegmentVoxelGrid,
  isLocked: () => false,
  pushMemos: () => {},
  notifyChanged: () => {},
};
const all = Array.from({ length: MEMBERS }, (_, i) => ({ containerId: 'G', segmentIndex: i + 1 }));

describe('readSegmentVoxelGrid on a stack (X4)', () => {
  beforeEach(setup);

  it('a one-slice Cleanup over every member reads only that slice\'s labelmap images', () => {
    const slice = 17;
    const r = beginTransaction(all, deps);
    if (!r.ok) throw new Error('begin');
    const res = runPlaneOp({
      txn: r.txn, members: all, allMembers: all, axis: 2, slices: [slice],
      op: (p, c) => fillHoles(p, c.spacing),
    });
    expect(res.added).toBe(MEMBERS);
    r.txn.commit();

    const touched = [...reads.keys()].filter((key) => (reads.get(key) ?? 0) > 0);
    const offSlice = touched.filter((key) => !key.endsWith(`|${slice}`));
    expect(offSlice).toEqual([]); // no other slice of any member was read (no whole-stack copy)
    // ... and the cleanup landed on the right images.
    for (let m = 1; m <= MEMBERS; m++) {
      const cx = 2 + 3 * (m - 1) + 1;
      expect(pixels.get(`${m}|${slice}`)![cx + 11 * NX]).toBe(1);
      expect(pixels.get(`${m}|${slice - 1}`)![cx + 11 * NX]).toBe(0);
    }
  });

  it('places the stack by position and still offers the whole grid as data', () => {
    const g = readSegmentVoxelGrid('G', 3)!;
    expect(g.geometry.dimensions).toEqual([NX, NY, NZ]);
    expect(reads.size).toBe(0); // reading the grid copies nothing
    const cx = 2 + 3 * 2 + 1;
    const flat = (x: number, y: number, k: number) => x + y * NX + k * NX * NY;
    expect(g.at!(flat(cx + 1, 11, 5))).toBe(1);
    expect(g.data[flat(cx + 1, 11, 5)]).toBe(1);
    expect(g.data[flat(cx, 11, 5)]).toBe(0);
    g.write(flat(cx, 11, 5), 1);
    expect(pixels.get(`3|5`)![cx + 11 * NX]).toBe(1);
  });

  it('copies the stack once: data is the same array on every access', () => {
    const g = readSegmentVoxelGrid('G', 3)!;
    const first = g.data;
    expect(g.data).toBe(first);
  });
});
