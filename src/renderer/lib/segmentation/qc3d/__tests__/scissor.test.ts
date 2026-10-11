/** The 3D scissor (branch 7 Q4): a lasso cuts through the volume along the view. */
import { describe, expect, it } from 'vitest';
import { insidePolygon, scissorCut, type IndexToCanvas } from '../scissor';

const N = 10;
const full = new Uint8Array(N * N * N).fill(1);
const count = (m: Uint8Array) => m.reduce((s, v) => s + v, 0);
/** Looking down k: canvas x = 10·i, y = 10·j (k does not move the projection). */
const down: IndexToCanvas = { c0: [0, 0], ci: [10, 0], cj: [0, 10], ck: [0, 0] };
const leftHalf: Array<[number, number]> = [[-5, -5], [45, -5], [45, 95], [-5, 95]];

describe('insidePolygon', () => {
  it('even–odd, including a concave lasso', () => {
    const L: Array<[number, number]> = [[0, 0], [10, 0], [10, 10], [5, 10], [5, 5], [0, 5]];
    expect(insidePolygon(2, 2, L)).toBe(true);
    expect(insidePolygon(7, 7, L)).toBe(true);
    expect(insidePolygon(2, 7, L)).toBe(false);
  });
});

describe('scissorCut', () => {
  it('removes what projects inside the lasso, through every slice along the view', () => {
    const cut = scissorCut(full, [N, N, N], down, leftHalf, 'inside');
    expect(count(cut)).toBe(5 * N * N); // i = 0..4, all j, all k
    expect(cut[4 + N * (3 + N * 9)]).toBe(1);
    expect(cut[5 + N * (3 + N * 9)]).toBe(0);
  });

  it('“keep inside” removes the rest', () => {
    const cut = scissorCut(full, [N, N, N], down, leftHalf, 'outside');
    expect(count(cut)).toBe(5 * N * N);
    expect(cut[5]).toBe(1);
    expect(cut[0]).toBe(0);
  });

  it('only member voxels are ever removed', () => {
    const one = new Uint8Array(N * N * N);
    one[2 + N * (2 + N * 2)] = 1;
    expect(count(scissorCut(one, [N, N, N], down, leftHalf, 'inside'))).toBe(1);
    expect(count(scissorCut(one, [N, N, N], down, leftHalf, 'outside'))).toBe(0);
  });

  it('a view along i: the lasso picks j, whatever i is', () => {
    const side: IndexToCanvas = { c0: [0, 0], ci: [0, 0], cj: [10, 0], ck: [0, 10] };
    const cut = scissorCut(full, [N, N, N], side, leftHalf, 'inside');
    expect(count(cut)).toBe(5 * N * N);
    expect(cut[9 + N * (4 + N * 0)]).toBe(1);
    expect(cut[0 + N * (5 + N * 0)]).toBe(0);
  });

  it('the slice axis moves the projection too: a top-half lasso in a side view picks k', () => {
    const side: IndexToCanvas = { c0: [0, 0], ci: [0, 0], cj: [10, 0], ck: [0, 10] };
    const topHalf: Array<[number, number]> = [[-5, -5], [95, -5], [95, 45], [-5, 45]];
    const cut = scissorCut(full, [N, N, N], side, topHalf, 'inside');
    expect(count(cut)).toBe(5 * N * N); // k = 0..4
    expect(cut[3 + N * (7 + N * 4)]).toBe(1);
    expect(cut[3 + N * (7 + N * 5)]).toBe(0);
  });

  it('a degenerate lasso cuts nothing', () => {
    expect(count(scissorCut(full, [N, N, N], down, [[0, 0], [10, 10]], 'inside'))).toBe(0);
  });
});
