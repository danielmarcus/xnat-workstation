/**
 * The content map from source files to E2E specs (scripts/spec-map.mjs), against this repo:
 * one link of each kind — a rendered test id or label, an E2E hook, a quoted message.
 */
import * as path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { buildSpecMap, relatedSpecs } from './spec-map.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const map = buildSpecMap(root);
const specsFor = (f) => [...relatedSpecs(map, f).keys()];

describe('spec map', () => {
  it('a component reaches the specs that use its labels', () => {
    expect(specsFor('src/renderer/components/annotations/MemberRow.tsx')).toContain('e2e/specs/annotations/measurement-delete.e2e.ts');
  });

  it('a service reaches the specs that call the E2E hooks built on it', () => {
    expect(specsFor('src/renderer/lib/cornerstone/maskOpsService.ts')).toContain('e2e/specs/annotations/mask-preview.e2e.ts');
  });

  it('a module reaches the specs that quote its message', () => {
    expect(specsFor('src/renderer/lib/cornerstone/growCutGpu.ts')).toContain('e2e/specs/tools/region-without-webgpu.e2e.ts');
  });

  it('strongest first, and a hub file does not reach every spec', () => {
    const rel = [...relatedSpecs(map, 'src/renderer/stores/viewerStore.ts').values()].map((v) => v.score);
    expect(rel).toEqual([...rel].sort((a, b) => b - a));
    expect(rel.length).toBeLessThan(map.specs.length);
  });
});
