import { describe, expect, it } from 'vitest';
import { projectContainers, type ProjectionInputs } from '../containerProjection';

/**
 * Rebuild Phase 3, Slice R3.1 — unified container projection.
 *
 * Pure: builds the unified `Container[]` model (src/shared/types/annotation.ts)
 * from the live UI-summary stores (segmentationStore segments + manager-store
 * presentation/dirty + annotationStore SR measurements + xnatOrigin). This is the
 * data foundation the list-panel rows read; verified here without any store or
 * Cornerstone, so the mapping (kind, members, presentation overrides, dirty,
 * source identity, SR grouping) is locked down before the visual rows are built.
 */
function baseInputs(): ProjectionInputs {
  return {
    segmentations: [],
    annotations: [],
    presentation: {},
    dirtySegIds: {},
    xnatOriginMap: {},
    kindOf: () => 'SEG',
  };
}

describe('projectContainers', () => {
  it('projects a SEG summary into a Container with mapped members + source + dirty', () => {
    const containers = projectContainers({
      ...baseInputs(),
      segmentations: [
        {
          segmentationId: 'seg-1',
          label: 'Organs',
          isActive: true,
          segments: [
            { segmentIndex: 1, label: 'Liver', color: [255, 0, 0, 255], visible: true, locked: false },
            { segmentIndex: 2, label: 'Spleen', color: [0, 255, 0, 255], visible: false, locked: true },
          ],
        },
      ],
      dirtySegIds: { 'seg-1': true },
      xnatOriginMap: { 'seg-1': { scanId: '3004', sourceScanId: '4', projectId: 'PRJ', sessionId: 'SESS' } },
    });

    expect(containers).toHaveLength(1);
    const c = containers[0];
    expect(c).toMatchObject({ id: 'seg-1', kind: 'SEG', label: 'Organs', dirty: true });
    expect(c.source).toMatchObject({ projectId: 'PRJ', sessionId: 'SESS', sourceScanId: '4', scanId: '3004' });
    expect(c.members).toHaveLength(2);
    expect(c.members[0]).toMatchObject({ id: '1', label: 'Liver', segmentIndex: 1, visible: true, locked: false, color: [255, 0, 0, 255] });
    expect(c.members[1]).toMatchObject({ id: '2', label: 'Spleen', segmentIndex: 2, visible: false, locked: true });
  });

  it('lets manager-store presentation overrides win over the summary color/visibility/lock', () => {
    const containers = projectContainers({
      ...baseInputs(),
      segmentations: [
        {
          segmentationId: 'seg-1',
          label: 'S',
          isActive: false,
          segments: [{ segmentIndex: 1, label: 'A', color: [10, 10, 10, 255], visible: true, locked: false }],
        },
      ],
      presentation: {
        'seg-1': { color: { 1: [200, 100, 50, 255] }, visibility: { 1: false }, locked: { 1: true } },
      },
    });
    expect(containers[0].members[0]).toMatchObject({ color: [200, 100, 50, 255], visible: false, locked: true });
  });

  it('uses the kindOf resolver to mark RTSTRUCT containers (members carry roiNumber)', () => {
    const containers = projectContainers({
      ...baseInputs(),
      segmentations: [
        { segmentationId: 'rt-1', label: 'Structure Set', isActive: false, segments: [{ segmentIndex: 1, label: 'GTV', color: [255, 0, 0, 255], visible: true, locked: false }] },
      ],
      kindOf: (id) => (id === 'rt-1' ? 'RTSTRUCT' : 'SEG'),
    });
    expect(containers[0].kind).toBe('RTSTRUCT');
    expect(containers[0].members[0]).toMatchObject({ roiNumber: 1, label: 'GTV' });
  });

  it('groups SR measurements into a single Measurement container with member tool identity', () => {
    const containers = projectContainers({
      ...baseInputs(),
      annotations: [
        { annotationUID: 'ann-1', toolName: 'Length', displayName: 'Length', displayText: '12.5 mm', label: 'lesion' },
        { annotationUID: 'ann-2', toolName: 'Angle', displayName: 'Angle', displayText: '45°', label: '' },
      ],
    });
    const sr = containers.find((c) => c.kind === 'SR');
    expect(sr).toBeDefined();
    expect(sr!.members).toHaveLength(2);
    expect(sr!.members[0]).toMatchObject({ id: 'ann-1', label: 'lesion', toolName: 'Length', annotationUID: 'ann-1' });
    expect(sr!.members[1].label).toBe('Angle'); // empty user label → falls back to displayName
  });

  it('emits no SR container when there are no measurements', () => {
    expect(projectContainers(baseInputs())).toEqual([]);
  });

  it('emits a created SR container even when empty, and routes affiliated measurements (D7.1)', () => {
    const containers = projectContainers({
      ...baseInputs(),
      srContainers: [{ id: 'sr:local:1', label: 'Lesions' }, { id: 'sr:local:2', label: 'Nodes' }],
      annotations: [
        { annotationUID: 'm1', toolName: 'Length', displayName: 'Length', displayText: '1mm', label: '' },
        { annotationUID: 'm2', toolName: 'Angle', displayName: 'Angle', displayText: '2°', label: '' },
      ],
      srAffiliation: { m1: 'sr:local:1' }, // m1 → Lesions; m2 unaffiliated
    });
    const lesions = containers.find((c) => c.id === 'sr:local:1');
    const nodes = containers.find((c) => c.id === 'sr:local:2');
    const fallback = containers.find((c) => c.id === 'sr:measurements');
    expect(lesions).toMatchObject({ kind: 'SR', label: 'Lesions' });
    expect(lesions!.members.map((m) => m.id)).toEqual(['m1']);
    expect(nodes!.members).toHaveLength(0); // created but empty — still listed
    expect(fallback!.members.map((m) => m.id)).toEqual(['m2']); // unaffiliated → default
  });

  it('does not emit a default container when every measurement is affiliated', () => {
    const containers = projectContainers({
      ...baseInputs(),
      srContainers: [{ id: 'sr:local:1', label: 'A' }],
      annotations: [{ annotationUID: 'm1', toolName: 'Length', displayName: 'Length', displayText: '1mm', label: '' }],
      srAffiliation: { m1: 'sr:local:1' },
    });
    expect(containers.find((c) => c.id === 'sr:measurements')).toBeUndefined();
    expect(containers.filter((c) => c.kind === 'SR')).toHaveLength(1);
  });

  it('orders SEG/RTSTRUCT containers (input order) before the SR container', () => {
    const containers = projectContainers({
      ...baseInputs(),
      segmentations: [
        { segmentationId: 'seg-1', label: 'A', isActive: false, segments: [] },
        { segmentationId: 'seg-2', label: 'B', isActive: false, segments: [] },
      ],
      annotations: [{ annotationUID: 'm1', toolName: 'Length', displayName: 'Length', displayText: '1mm', label: '' }],
    });
    expect(containers.map((c) => c.id)).toEqual(['seg-1', 'seg-2', containers[2].id]);
    expect(containers[2].kind).toBe('SR');
  });
});
