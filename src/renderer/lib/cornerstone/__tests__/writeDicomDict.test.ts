import { beforeEach, describe, expect, it, vi } from 'vitest';

const dcmjsMocks = vi.hoisted(() => {
  function WriteBufferStream() {}
  (WriteBufferStream as any).prototype.writeUint16 = vi.fn(function (value: number) {
    return value;
  });
  (WriteBufferStream as any).prototype.writeUint32 = vi.fn(function (value: number) {
    return value;
  });

  return {
    WriteBufferStream,
  };
});

vi.mock('dcmjs', () => ({
  data: {
    WriteBufferStream: dcmjsMocks.WriteBufferStream,
  },
}));

import { writeDicomDict } from '../writeDicomDict';

describe('writeDicomDict', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns result directly on successful first write', () => {
    const output = new ArrayBuffer(4);
    class DicomDict {
      dict: unknown;
      constructor(_meta: unknown) {}
      write(): ArrayBuffer {
        return output;
      }
    }

    const result = writeDicomDict(DicomDict, { a: 1 }, { b: 2 }, 'test');
    expect(result).toBe(output);
  });

  it('rethrows non-NaN errors without fallback patching', () => {
    class DicomDict {
      dict: unknown;
      constructor(_meta: unknown) {}
      write(): ArrayBuffer {
        throw new Error('other failure');
      }
    }

    expect(() => writeDicomDict(DicomDict, {}, {}, 'test')).toThrow('other failure');
  });

  it('retries with NaN-guard patch and restores prototype methods', () => {
    const writeUint16Before = (dcmjsMocks.WriteBufferStream as any).prototype.writeUint16;
    const writeUint32Before = (dcmjsMocks.WriteBufferStream as any).prototype.writeUint32;
    const output = new ArrayBuffer(16);

    let calls = 0;
    class DicomDict {
      dict: unknown;
      constructor(_meta: unknown) {}
      write(): ArrayBuffer {
        calls += 1;
        if (calls === 1) {
          throw new Error('Not a number');
        }
        return output;
      }
    }

    const result = writeDicomDict(DicomDict, {}, {}, 'segmentationService');
    expect(result).toBe(output);
    expect(calls).toBe(2);
    expect((dcmjsMocks.WriteBufferStream as any).prototype.writeUint16).toBe(writeUint16Before);
    expect((dcmjsMocks.WriteBufferStream as any).prototype.writeUint32).toBe(writeUint32Before);
  });

  it('falls back to second write when WriteBufferStream prototype is unavailable', () => {
    const original = (dcmjsMocks as any).WriteBufferStream;
    (dcmjsMocks as any).WriteBufferStream = undefined;

    let calls = 0;
    class DicomDict {
      dict: unknown;
      constructor(_meta: unknown) {}
      write(): ArrayBuffer {
        calls += 1;
        if (calls === 1) {
          throw new Error('Not a number');
        }
        return new ArrayBuffer(1);
      }
    }

    expect(writeDicomDict(DicomDict, {}, {}, 'fallback')).toBeInstanceOf(ArrayBuffer);
    expect(calls).toBe(2);
    (dcmjsMocks as any).WriteBufferStream = original;
  });
});
