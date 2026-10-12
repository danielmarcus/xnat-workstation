/**
 * Checkpoint voxel encoding (SegWorks parity D8): a segment's voxels as runs over the flat
 * grid index — [start, length, start, length, …] — then gzip and base64. Masks are mostly
 * empty or solid, so runs are small; gzip squeezes the rest.
 *
 * A payload starts with a one-character format tag: 'g' gzip, 'r' raw (where the runtime
 * has no CompressionStream). Decoding accepts both.
 */

/** Runs of indices where `isSet(i)` over [0, n). */
export function encodeRuns(n: number, isSet: (i: number) => boolean): Int32Array {
  const out: number[] = [];
  let i = 0;
  while (i < n) {
    if (!isSet(i)) { i++; continue; }
    const start = i;
    while (i < n && isSet(i)) i++;
    out.push(start, i - start);
  }
  return Int32Array.from(out);
}

/** Visit every index covered by `runs`. */
export function forEachInRuns(runs: Int32Array, fn: (i: number) => void): void {
  for (let r = 0; r + 1 < runs.length; r += 2) {
    const end = runs[r] + runs[r + 1];
    for (let i = runs[r]; i < end; i++) fn(i);
  }
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: ReadableWritablePair<Uint8Array, Uint8Array> | CompressionStream | DecompressionStream): Promise<Uint8Array> {
  // Plain web streams (no Blob/Response), so this runs the same in Chromium and in tests.
  const source = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(bytes); c.close(); },
  });
  const reader = source.pipeThrough(stream as never).getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out;
}

export async function packRuns(runs: Int32Array): Promise<string> {
  const bytes = new Uint8Array(runs.buffer, runs.byteOffset, runs.byteLength);
  if (typeof CompressionStream === 'function') {
    return 'g' + toBase64(await pipe(bytes, new CompressionStream('gzip')));
  }
  return 'r' + toBase64(bytes);
}

export async function unpackRuns(payload: string): Promise<Int32Array> {
  const tag = payload[0];
  let bytes = fromBase64(payload.slice(1));
  if (tag === 'g') bytes = await pipe(bytes, new DecompressionStream('gzip'));
  else if (tag !== 'r') throw new Error(`[checkpointCodec] unknown payload format '${tag}'`);
  const copy = new Uint8Array(bytes); // aligned for Int32Array
  return new Int32Array(copy.buffer, 0, Math.floor(copy.byteLength / 4));
}
