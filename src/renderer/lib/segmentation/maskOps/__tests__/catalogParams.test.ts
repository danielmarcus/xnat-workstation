/** Cleanup's parameters are rendered as sliders straight from the catalog: each default must be one a slider can hold. */
import { describe, expect, it } from 'vitest';
import { onSliderGrid, POST_STEP_OPS } from '@shared/modules/manifest';
import { CLEANUP_OPS } from '../catalog';

const numberParams = CLEANUP_OPS.flatMap((op) => op.params.flatMap((p) => (p.kind === 'number' ? [{ op: op.id, ...p }] : [])));

describe('Cleanup catalog parameters', () => {
  it.each(numberParams.map((p) => [`${p.op}.${p.key}`, p] as const))('%s: min ≤ default ≤ max, on the slider grid', (_name, p) => {
    expect(p.step).toBeGreaterThan(0);
    expect(p.default).toBeGreaterThanOrEqual(p.min);
    expect(p.default).toBeLessThanOrEqual(p.max);
    expect(onSliderGrid(p.default, p.min, p.step), `${p.default} is not ${p.min} + k·${p.step}`).toBe(true);
  });
});

describe('module post steps (#103 item 3)', () => {
  it('POST_STEP_OPS is exactly the mask-only Cleanup operations, with the catalog\'s parameters and ranges', () => {
    const maskOnly = CLEANUP_OPS.filter((op) => op.group === 'clean' && op.run && !op.usesImage);
    const fromCatalog = Object.fromEntries(maskOnly.map((op) => [op.id, Object.fromEntries(op.params.map((p) => {
      if (p.kind !== 'number') throw new Error(`${op.id}.${p.key}: post steps take number parameters only`);
      return [p.key, { min: p.min, max: p.max }];
    }))]));
    expect(POST_STEP_OPS).toEqual(fromCatalog);
  });
});
