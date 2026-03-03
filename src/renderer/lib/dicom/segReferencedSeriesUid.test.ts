import { beforeEach, describe, expect, it, vi } from 'vitest';

const dicomMocks = vi.hoisted(() => ({
  parseDicom: vi.fn(),
}));

vi.mock('dicom-parser', () => ({
  parseDicom: dicomMocks.parseDicom,
}));

import { getReferencedSeriesUID, getSegReferenceInfo } from './segReferencedSeriesUid';

function seqItemWithSop(uid: string): { dataSet: { string: (tag: string) => string | undefined } } {
  return {
    dataSet: {
      string: (tag: string) => (tag === 'x00081155' ? uid : undefined),
    },
  };
}

describe('getSegReferenceInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefers ReferencedSeriesSequence UID and aggregates referenced SOP instance UIDs', () => {
    dicomMocks.parseDicom.mockReturnValue({
      elements: {
        x00082112: { items: [seqItemWithSop('1.2.3.4')] },
        x00081115: {
          items: [
            {
              dataSet: {
                string: (tag: string) => (tag === 'x0020000e' ? '9.8.7.6' : undefined),
                elements: {
                  x0008114a: { items: [seqItemWithSop('2.3.4.5')] },
                },
              },
            },
          ],
        },
      },
      string: vi.fn(() => 'self-series'),
    });

    expect(getSegReferenceInfo(new ArrayBuffer(0))).toEqual({
      referencedSeriesUID: '9.8.7.6',
      referencedSOPInstanceUIDs: expect.arrayContaining(['1.2.3.4', '2.3.4.5']),
    });
  });

  it('falls back to ReferencedFrameOfReferenceSequence series UID when needed', () => {
    dicomMocks.parseDicom.mockReturnValue({
      elements: {
        x30060010: {
          items: [
            {
              dataSet: {
                elements: {
                  x30060012: {
                    items: [
                      {
                        dataSet: {
                          elements: {
                            x30060014: {
                              items: [
                                {
                                  dataSet: {
                                    string: (tag: string) => (tag === 'x0020000e' ? '7.7.7.7' : undefined),
                                  },
                                },
                              ],
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
      string: vi.fn(() => 'self-series'),
    });

    expect(getSegReferenceInfo(new ArrayBuffer(0))).toEqual({
      referencedSeriesUID: '7.7.7.7',
      referencedSOPInstanceUIDs: [],
    });
    expect(getReferencedSeriesUID(new ArrayBuffer(0))).toBe('7.7.7.7');
  });

  it('returns null series UID and preserves fallback SOP references when no series linkage exists', () => {
    dicomMocks.parseDicom.mockReturnValue({
      elements: {
        x52009230: {
          items: [
            {
              dataSet: {
                elements: {
                  x00089124: {
                    items: [
                      {
                        dataSet: {
                          elements: {
                            x00082112: { items: [seqItemWithSop('5.5.5.5')] },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
      string: vi.fn(() => 'self-series'),
    });

    expect(getSegReferenceInfo(new ArrayBuffer(0))).toEqual({
      referencedSeriesUID: null,
      referencedSOPInstanceUIDs: ['5.5.5.5'],
    });
  });

  it('handles parse errors safely', () => {
    dicomMocks.parseDicom.mockImplementation(() => {
      throw new Error('bad dicom');
    });

    expect(getSegReferenceInfo(new ArrayBuffer(0))).toEqual({
      referencedSeriesUID: null,
      referencedSOPInstanceUIDs: [],
    });
  });
});
