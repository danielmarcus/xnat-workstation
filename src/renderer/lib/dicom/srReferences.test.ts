import { beforeEach, describe, expect, it, vi } from 'vitest';

const dicomMocks = vi.hoisted(() => ({ parseDicom: vi.fn() }));
vi.mock('dicom-parser', () => ({ parseDicom: dicomMocks.parseDicom }));

import { getSrReferenceInfo } from './srReferences';

/** A sequence item exposing `string(tag)` lookups and optional nested sequences. */
function item(
  strings: Record<string, string> = {},
  elements: Record<string, unknown> = {},
): unknown {
  return {
    dataSet: {
      string: (tag: string) => strings[tag],
      elements,
    },
  };
}

const sopItem = (uid: string) => item({ x00081155: uid });

/** Evidence sequence: study item → ReferencedSeriesSequence → series item. */
function evidence(seriesUID: string, sopUids: string[]): unknown {
  return item({}, {
    x00081115: {
      items: [item({ x0020000e: seriesUID }, { x00081199: { items: sopUids.map(sopItem) } })],
    },
  });
}

describe('getSrReferenceInfo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads the series + SOP UIDs from CurrentRequestedProcedureEvidenceSequence', () => {
    dicomMocks.parseDicom.mockReturnValue({
      string: () => undefined,
      elements: { x0040a375: { items: [evidence('1.2.840.SERIES', ['sop-1', 'sop-2'])] } },
    });

    expect(getSrReferenceInfo(new ArrayBuffer(8))).toEqual({
      referencedSeriesUID: '1.2.840.SERIES',
      referencedSOPInstanceUIDs: ['sop-1', 'sop-2'],
    });
  });

  it('falls back to PertinentOtherEvidenceSequence', () => {
    dicomMocks.parseDicom.mockReturnValue({
      string: () => undefined,
      elements: { x0040a385: { items: [evidence('OTHER.SERIES', ['sop-9'])] } },
    });

    const info = getSrReferenceInfo(new ArrayBuffer(8));
    expect(info.referencedSeriesUID).toBe('OTHER.SERIES');
    expect(info.referencedSOPInstanceUIDs).toEqual(['sop-9']);
  });

  it('takes the FIRST series when the SR references several (one source panel)', () => {
    dicomMocks.parseDicom.mockReturnValue({
      string: () => undefined,
      elements: {
        x0040a375: {
          items: [evidence('FIRST.SERIES', ['sop-1']), evidence('SECOND.SERIES', ['sop-2'])],
        },
      },
    });

    const info = getSrReferenceInfo(new ArrayBuffer(8));
    expect(info.referencedSeriesUID).toBe('FIRST.SERIES');
    // …but every referenced SOP is still collected, for SOP-based source lookup.
    expect(info.referencedSOPInstanceUIDs).toEqual(['sop-1', 'sop-2']);
  });

  it('collects image references out of the content tree when there is no evidence sequence', () => {
    dicomMocks.parseDicom.mockReturnValue({
      string: () => undefined,
      elements: {
        x0040a730: {
          items: [
            item({}, { x00081199: { items: [sopItem('deep-sop-1')] } }),
            item({}, { x0040a730: { items: [item({}, { x00081199: { items: [sopItem('deep-sop-2')] } })] } }),
          ],
        },
      },
    });

    expect(getSrReferenceInfo(new ArrayBuffer(8))).toEqual({
      referencedSeriesUID: null,
      referencedSOPInstanceUIDs: ['deep-sop-1', 'deep-sop-2'],
    });
  });

  it('de-duplicates SOP UIDs referenced by several measurements', () => {
    dicomMocks.parseDicom.mockReturnValue({
      string: () => undefined,
      elements: { x0040a375: { items: [evidence('S', ['sop-1', 'sop-1', 'sop-2'])] } },
    });
    expect(getSrReferenceInfo(new ArrayBuffer(8)).referencedSOPInstanceUIDs).toEqual(['sop-1', 'sop-2']);
  });

  it('never throws on a malformed file — the caller falls back to the active panel', () => {
    dicomMocks.parseDicom.mockImplementation(() => {
      throw new Error('not a DICOM file');
    });
    expect(getSrReferenceInfo(new ArrayBuffer(2))).toEqual({
      referencedSeriesUID: null,
      referencedSOPInstanceUIDs: [],
    });
  });
});
