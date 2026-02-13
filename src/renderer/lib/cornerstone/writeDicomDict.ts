/**
 * writeDicomDict — shared DICOM serialization with NaN-guard fallback.
 *
 * Serialize a denaturalized DICOM dataset to an ArrayBuffer via dcmjs.
 *
 * First attempts a normal DicomDict.write(). If dcmjs throws "Not a number"
 * (caused by NaN in its internal byte-count arithmetic, not our dataset values),
 * retries once with a scoped NaN-guard on WriteBufferStream.prototype. The
 * guard is removed in a finally block — no permanent prototype mutation.
 *
 * Shared between segmentationService and rtStructService to avoid duplication.
 */
import { data as dcmjsData } from 'dcmjs';

export function writeDicomDict(
  DicomDictClass: any,
  denaturalizedMeta: any,
  denaturalizedDict: any,
  callerTag = 'writeDicomDict',
): ArrayBuffer {
  const dict = new DicomDictClass(denaturalizedMeta);
  dict.dict = denaturalizedDict;

  // Attempt 1: normal write — no prototype patching
  try {
    return dict.write();
  } catch (firstErr: any) {
    if (!(firstErr instanceof Error) || !firstErr.message.includes('Not a number')) {
      throw firstErr; // not the NaN error — rethrow
    }
    console.warn(
      `[${callerTag}] DicomDict.write() hit NaN in dcmjs internals; retrying with NaN guard`,
    );
  }

  // Attempt 2: scoped NaN-guard fallback
  const { WriteBufferStream } = dcmjsData as any;
  const proto = WriteBufferStream?.prototype;
  if (!proto) {
    // Can't access prototype — rethrow by trying again (will fail the same way)
    return dict.write();
  }

  const origWrite16 = proto.writeUint16;
  const origWrite32 = proto.writeUint32;
  try {
    proto.writeUint16 = function (value: any) {
      return origWrite16.call(this, isNaN(value) ? 0 : value);
    };
    proto.writeUint32 = function (value: any) {
      return origWrite32.call(this, isNaN(value) ? 0 : value);
    };

    // Fresh DicomDict — the first write() may have left internal state inconsistent
    const retryDict = new DicomDictClass(denaturalizedMeta);
    retryDict.dict = denaturalizedDict;
    return retryDict.write();
  } finally {
    proto.writeUint16 = origWrite16;
    proto.writeUint32 = origWrite32;
  }
}
