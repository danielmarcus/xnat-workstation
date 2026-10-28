/**
 * A minimal zip reader / writer for module packages (branch 9, M1). Packages are untrusted input,
 * so the reader is strict and small rather than general: stored or deflated entries only, no
 * encryption, no zip64, no symlinks, no absolute or `..` paths, and limits on entry count and
 * sizes checked BEFORE anything is inflated. Built on Node's zlib — no third-party zip code in the
 * path that handles untrusted packages.
 */
import * as zlib from 'zlib';

export interface ZipLimits {
  maxEntries: number;
  /** Largest single uncompressed entry, bytes. */
  maxEntryBytes: number;
  /** All uncompressed entries together, bytes. */
  maxTotalBytes: number;
}

export const PACKAGE_LIMITS: ZipLimits = { maxEntries: 500, maxEntryBytes: 128 * 2 ** 20, maxTotalBytes: 256 * 2 ** 20 };

export class ZipError extends Error {}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Device names Windows reserves in every folder, with any extension (`con.js` is the console). */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

/**
 * A package path is relative, forward-slashed and never escapes the package — and names the same
 * file on every OS the app runs on: no `:` (an NTFS alternate data stream, or a drive), no device
 * name Windows reserves, no part ending in a dot or space (Windows drops them, so `a.` is `a`).
 */
export function isSafePath(name: string): boolean {
  if (!name || name.length > 255 || name.startsWith('/') || name.includes('\\') || name.includes(':')) return false;
  if (name.includes('\0')) return false;
  return name.split('/').every((part, i, all) => {
    if (part === '') return i === all.length - 1; // a directory entry's trailing slash
    return part !== '..' && part !== '.' && !WINDOWS_RESERVED.test(part) && !/[. ]$/.test(part);
  });
}

/** Read every file in a zip. Directory entries are skipped; anything unsafe throws ZipError. */
export function readZip(buf: Buffer, limits: ZipLimits = PACKAGE_LIMITS): Map<string, Buffer> {
  // End of central directory: the last 22+ bytes (with up to 64 KiB of comment).
  const min = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new ZipError('not a zip file');
  const entries = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (entries === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) throw new ZipError('zip64 packages are not supported');
  if (entries > limits.maxEntries) throw new ZipError(`too many files (${entries} > ${limits.maxEntries})`);
  if (cdOffset + cdSize > eocd) throw new ZipError('corrupt central directory');

  const out = new Map<string, Buffer>();
  // Windows and macOS file systems ignore case: two names (or folders) differing only in case
  // would install as one, and the module then be refused at its first load. Lower case → as written.
  const folded = new Map<string, string>();
  let total = 0;
  let p = cdOffset;
  for (let n = 0; n < entries; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new ZipError('corrupt central directory entry');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const versionMadeBy = buf.readUInt16LE(p + 4);
    const externalAttrs = buf.readUInt32LE(p + 38);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (flags & 0x1) throw new ZipError(`${name}: encrypted entries are not supported`);
    if (csize === 0xffffffff || usize === 0xffffffff || localOffset === 0xffffffff) throw new ZipError('zip64 packages are not supported');
    // Unix symlinks (made by Unix, mode S_IFLNK) are refused: a package holds plain files only.
    if (versionMadeBy >> 8 === 3 && ((externalAttrs >>> 16) & 0o170000) === 0o120000) throw new ZipError(`${name}: symbolic links are not allowed`);
    if (!isSafePath(name)) throw new ZipError(`${name}: unsafe path`);
    if (name.endsWith('/')) continue; // directory
    if (method !== 0 && method !== 8) throw new ZipError(`${name}: compression method ${method} is not supported`);
    if (usize > limits.maxEntryBytes) throw new ZipError(`${name}: larger than ${limits.maxEntryBytes} bytes`);
    total += usize;
    if (total > limits.maxTotalBytes) throw new ZipError(`the package unpacks to more than ${limits.maxTotalBytes} bytes`);
    if (out.has(name)) throw new ZipError(`${name}: listed twice`);
    const parts = name.split('/');
    for (let k = 1; k <= parts.length; k++) {
      const prefix = parts.slice(0, k).join('/');
      const seen = folded.get(prefix.toLowerCase());
      if (seen !== undefined && seen !== prefix) throw new ZipError(`${name}: names that differ only in case (${seen})`);
      folded.set(prefix.toLowerCase(), prefix);
    }

    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new ZipError(`${name}: corrupt local header`);
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    if (start + csize > buf.length) throw new ZipError(`${name}: truncated`);
    const raw = buf.subarray(start, start + csize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else {
      try {
        data = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(1, usize) });
      } catch {
        throw new ZipError(`${name}: does not inflate to its declared size`);
      }
    }
    if (data.length !== usize) throw new ZipError(`${name}: size does not match its header`);
    if (crc32(data) !== crc) throw new ZipError(`${name}: checksum mismatch`);
    out.set(name, data);
  }
  return out;
}

/** Write files as a zip (deflated), in the order given. For the authoring tools and tests. */
export function writeZip(files: Map<string, Buffer> | Array<[string, Buffer]>): Buffer {
  const list = files instanceof Map ? [...files.entries()] : files;
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of list) {
    if (!isSafePath(name)) throw new ZipError(`${name}: unsafe path`);
    const nameBuf = Buffer.from(name, 'utf8');
    const comp = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(list.length, 8);
  end.writeUInt16LE(list.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
