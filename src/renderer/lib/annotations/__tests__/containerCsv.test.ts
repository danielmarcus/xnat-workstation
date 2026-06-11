import { describe, expect, it } from 'vitest';
import type { Container } from '@shared/types/annotation';
import { buildContainerCsv } from '../containerCsv';

function makeContainer(over: Partial<Container> = {}): Container {
  return {
    id: 'seg-1',
    kind: 'SEG',
    label: 'Liver',
    members: [
      { id: '1', label: 'Lesion A', visible: true, locked: false, segmentIndex: 1 },
      { id: '2', label: 'Lesion B', visible: false, locked: true, segmentIndex: 2 },
    ],
    source: { projectId: 'P', subjectId: 'S', sessionId: 'E', sourceScanId: '4', scanId: '3004' },
    ...over,
  };
}

describe('buildContainerCsv', () => {
  it('emits a header + one row per member with the structural fields', () => {
    const csv = buildContainerCsv(makeContainer());
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe('Container,Type,XNAT Scan,Source Scan,Member,Index,Visible,Locked');
    expect(lines[1]).toBe('Liver,SEG,3004,4,Lesion A,1,true,false');
    expect(lines[2]).toBe('Liver,SEG,3004,4,Lesion B,2,false,true');
    expect(csv.endsWith('\n')).toBe(true);
  });

  it('quotes cells containing commas or quotes (CSV-escapes)', () => {
    const csv = buildContainerCsv(
      makeContainer({ label: 'Liver, seg', members: [{ id: '1', label: 'a "b"', visible: true, locked: false, segmentIndex: 1 }] }),
    );
    const row = csv.trimEnd().split('\n')[1];
    expect(row).toContain('"Liver, seg"');
    expect(row).toContain('"a ""b"""');
  });

  it('emits the header even for an empty container', () => {
    const csv = buildContainerCsv(makeContainer({ members: [] }));
    expect(csv.trimEnd()).toBe('Container,Type,XNAT Scan,Source Scan,Member,Index,Visible,Locked');
  });

  it('falls back to roiNumber / id for the index when segmentIndex is absent (RTSTRUCT)', () => {
    const csv = buildContainerCsv(
      makeContainer({ kind: 'RTSTRUCT', members: [{ id: '7', label: 'GTV', visible: true, locked: false, roiNumber: 7 }] }),
    );
    expect(csv.trimEnd().split('\n')[1]).toBe('Liver,RTSTRUCT,3004,4,GTV,7,true,false');
  });
});
