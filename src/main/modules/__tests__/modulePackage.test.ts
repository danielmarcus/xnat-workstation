/** Module packages (branch 9, M1): format, zip guards, signatures, trust. */
import { describe, expect, it } from 'vitest';
import * as zlib from 'zlib';
import { crc32, readZip, writeZip, ZipError } from '../zip';
import { canonicalDigest, checkFiles, classify, generateKeyPair, packFiles, readPackage, signFiles, verifySignature, SIGNATURE_FILE } from '../modulePackage';
import { checkCompatibility, validateManifest } from '../../../shared/modules/manifest';

const MANIFEST = {
  id: 'org.example.threshold',
  name: 'Threshold',
  version: '1.0.0',
  apiVersion: '1.0',
  runtime: 'wasm-worker',
  publisher: 'Example',
  license: 'MIT',
  description: 'Intensity threshold',
  entry: 'module.js',
  params: [{ key: 'lower', label: 'Lower', kind: 'number', min: -1000, max: 3000, step: 1, default: 0 }],
  reads: { image: true, members: 'none' },
  writes: { target: 'active', mode: 'add' },
  scopes: ['slice', 'volume'],
};

const files = (manifest: object = MANIFEST, extra: Array<[string, string]> = []) =>
  new Map<string, Buffer>([
    ['manifest.json', Buffer.from(JSON.stringify(manifest))],
    ['module.js', Buffer.from('export function run() { return {}; }')],
    ...extra.map(([n, c]) => [n, Buffer.from(c)] as [string, Buffer]),
  ]);

describe('manifest', () => {
  it('a complete manifest is valid', () => {
    expect(validateManifest(MANIFEST).ok).toBe(true);
  });

  it('reports every problem, not just the first', () => {
    const r = validateManifest({ ...MANIFEST, id: 'Not An Id', version: '1', entry: '../evil.js', scopes: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join('\n')).toMatch(/^id:/m);
      expect(r.errors.join('\n')).toMatch(/^version:/m);
      expect(r.errors.join('\n')).toMatch(/^entry:/m);
      expect(r.errors.join('\n')).toMatch(/^scopes:/m);
    }
  });

  it('checks parameters: default inside range, select default among options, unique keys', () => {
    const bad = (params: unknown[]) => validateManifest({ ...MANIFEST, params });
    expect(bad([{ key: 'a', label: 'A', kind: 'number', min: 0, max: 1, step: 0.1, default: 2 }]).ok).toBe(false);
    expect(bad([{ key: 'a', label: 'A', kind: 'number', min: -1024, max: 3000, step: 10, default: 200 }]).ok).toBe(false); // off the slider's grid
    expect(bad([{ key: 'a', label: 'A', kind: 'number', min: 0, max: 1, step: 0.1, default: 0.3 }]).ok).toBe(true);
    expect(bad([{ key: 'a', label: 'A', kind: 'select', options: [{ value: 'x', label: 'X' }], default: 'y' }]).ok).toBe(false);
    expect(bad([{ key: 'a', label: 'A', kind: 'boolean', default: true }, { key: 'a', label: 'B', kind: 'boolean', default: false }]).ok).toBe(false);
    expect(bad([{ key: 'a', label: 'A', kind: 'boolean', default: true }]).ok).toBe(true);
  });

  it('a new member to write needs its name and colour', () => {
    expect(validateManifest({ ...MANIFEST, writes: { target: 'new', mode: 'add' } }).ok).toBe(false);
    expect(validateManifest({ ...MANIFEST, writes: { target: 'new', mode: 'add', newMembers: [{ name: 'Edema', color: [255, 200, 0] }] } }).ok).toBe(true);
    expect(validateManifest({ ...MANIFEST, writes: { target: 'new', mode: 'add', newMembers: [{ name: 'Edema', color: [255, 200, 0] }, { name: 'Cavity', color: [249, 115, 22] }] } }).ok).toBe(true);
    expect(validateManifest({ ...MANIFEST, writes: { target: 'new', mode: 'add', newMembers: [] } }).ok).toBe(false);
  });

  it('compatibility: API major and runtime, refused by name', () => {
    expect(checkCompatibility({ apiVersion: '1.3', runtime: 'wasm-worker' }).ok).toBe(true);
    const api = checkCompatibility({ apiVersion: '2.0', runtime: 'wasm-worker' });
    expect(api.ok).toBe(false);
    if (!api.ok) expect(api.reason).toMatch(/API 2\.0/);
    const rt = checkCompatibility({ apiVersion: '1.0', runtime: 'native-process' });
    expect(rt.ok).toBe(false);
    if (!rt.ok) expect(rt.reason).toMatch(/"native-process"/);
  });
});

describe('zip', () => {
  it('round-trips files, checksummed', () => {
    const f = files();
    const back = readZip(writeZip(f));
    expect([...back.keys()]).toEqual([...f.keys()]);
    expect(back.get('module.js')!.toString()).toBe(f.get('module.js')!.toString());
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });

  it('refuses unsafe paths, before inflating anything', () => {
    for (const name of ['../evil.js', '/etc/passwd', 'a/../../b', 'C:/x', 'a\\b']) {
      const zip = writeZip([['ok.txt', Buffer.from('x')]]);
      // Patch the stored name in place to the unsafe one (same length padding not needed: rebuild by hand).
      const evil = rawZip([[name, Buffer.from('x')]]);
      expect(() => readZip(evil), name).toThrow(ZipError);
      expect(readZip(zip).size).toBe(1);
    }
  });

  it('refuses symlinks, encryption, zip bombs and too many files', () => {
    expect(() => readZip(rawZip([['link', Buffer.from('/etc')]], { symlink: true }))).toThrow(/symbolic link/);
    expect(() => readZip(rawZip([['x', Buffer.from('x')]], { encrypted: true }))).toThrow(/encrypted/);
    const bomb = rawZip([['big', Buffer.alloc(4096)]], { lieSize: 10 });
    expect(() => readZip(bomb)).toThrow(ZipError);
    const many = writeZip(Array.from({ length: 6 }, (_, i) => [`f${i}`, Buffer.from('x')] as [string, Buffer]));
    expect(() => readZip(many, { maxEntries: 5, maxEntryBytes: 1e6, maxTotalBytes: 1e6 })).toThrow(/too many files/);
    expect(() => readZip(writeZip([['a', Buffer.alloc(100)]]), { maxEntries: 5, maxEntryBytes: 50, maxTotalBytes: 1e6 })).toThrow(/larger than/);
  });

  it('refuses an entry whose stored size disagrees with its header', () => {
    expect(() => readZip(rawZip([['a.txt', Buffer.from('hello world')]], { stored: true, lieSize: 5 }))).toThrow(/size does not match/);
  });

  it('refuses a changed byte (checksum)', () => {
    const z = rawZip([['a.txt', Buffer.from('hello world')]], { stored: true });
    const at = z.indexOf(Buffer.from('hello'));
    z[at] = 'j'.charCodeAt(0);
    expect(() => readZip(z)).toThrow(/checksum/);
  });

  it('is not a zip: says so', () => {
    expect(() => readZip(Buffer.from('not a zip at all, just text'))).toThrow(/not a zip/);
  });
});

describe('signatures and trust', () => {
  const key = generateKeyPair();
  const trusted = new Set([key.keyId]);

  it('unsigned → Community; signed by a trusted key → Verified; by an unknown key → Community', () => {
    const unsigned = readPackage(packFiles(files()), trusted);
    expect(unsigned.ok && unsigned.tier).toBe('community');
    expect(unsigned.ok && unsigned.signature.status).toBe('unsigned');
    const signed = readPackage(packFiles(signFiles(files(), key.privateKeyPem, 'Example')), trusted);
    expect(signed.ok && signed.tier).toBe('verified');
    const other = generateKeyPair();
    const stranger = readPackage(packFiles(signFiles(files(), other.privateKeyPem, 'Someone')), trusted);
    expect(stranger.ok && stranger.tier).toBe('community');
    expect(stranger.ok && stranger.signature.keyId).toBe(other.keyId);
  });

  it('any change after signing is refused: a changed file, an added file, a removed file', () => {
    const signed = signFiles(files(undefined, [['data.bin', 'abc']]), key.privateKeyPem, 'Example');
    const changed = new Map(signed); changed.set('module.js', Buffer.from('export function run() { steal(); }'));
    const added = new Map(signed); added.set('extra.js', Buffer.from('x'));
    const removed = new Map(signed); removed.delete('data.bin');
    for (const [label, f] of [['changed', changed], ['added', added], ['removed', removed]] as const) {
      const r = checkFiles(f, trusted);
      expect(r.ok, label).toBe(false);
      if (!r.ok) expect(r.reason, label).toMatch(/signature is invalid/);
    }
  });

  it('a signature naming another key id, or garbage, is invalid', () => {
    const signed = signFiles(files(), key.privateKeyPem, 'Example');
    const sig = JSON.parse(signed.get(SIGNATURE_FILE)!.toString());
    const forged = new Map(signed); forged.set(SIGNATURE_FILE, Buffer.from(JSON.stringify({ ...sig, keyId: '0000000000000000' })));
    expect(verifySignature(forged).status).toBe('invalid');
    const junk = new Map(signed); junk.set(SIGNATURE_FILE, Buffer.from('{not json'));
    expect(verifySignature(junk).status).toBe('invalid');
    expect(classify({ status: 'invalid' }, trusted)).toBe('refused');
  });

  it('bundled modules are covered by the app\'s signature: Bundled, signature not consulted', () => {
    const r = readPackage(packFiles(files()), new Set(), { bundled: true });
    expect(r.ok && r.tier).toBe('bundled');
  });

  it('the digest ignores signature.json and file order, and covers every other file', () => {
    const a = files();
    const b = new Map([...a].reverse());
    expect(canonicalDigest(a).equals(canonicalDigest(b))).toBe(true);
    const withSig = new Map(a); withSig.set(SIGNATURE_FILE, Buffer.from('{}'));
    expect(canonicalDigest(withSig).equals(canonicalDigest(a))).toBe(true);
    const more = new Map(a); more.set('x', Buffer.from(''));
    expect(canonicalDigest(more).equals(canonicalDigest(a))).toBe(false);
  });

  it('package checks: no manifest, a missing entry, an unsupported runtime — each refused with its reason', () => {
    const noManifest = new Map(files()); noManifest.delete('manifest.json');
    expect(checkFiles(noManifest, trusted)).toMatchObject({ ok: false, reason: expect.stringMatching(/no manifest/) });
    const noEntry = new Map(files()); noEntry.delete('module.js');
    expect(checkFiles(noEntry, trusted)).toMatchObject({ ok: false, reason: expect.stringMatching(/module\.js is not in the package/) });
    expect(checkFiles(files({ ...MANIFEST, runtime: 'xnat-container' }), trusted)).toMatchObject({ ok: false, reason: expect.stringMatching(/"xnat-container"/) });
  });
});

/** A zip built by hand, to make the malformed packages writeZip will not. */
function rawZip(list: Array<[string, Buffer]>, o: { symlink?: boolean; encrypted?: boolean; lieSize?: number; stored?: boolean } = {}): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of list) {
    const nameBuf = Buffer.from(name);
    const body = o.stored ? data : zlib.deflateRawSync(data);
    const size = o.lieSize ?? data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(o.encrypted ? 1 : 0, 6); local.writeUInt16LE(o.stored ? 0 : 8, 8);
    local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(size, 22); local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(o.symlink ? (3 << 8) | 20 : 20, 4); c.writeUInt16LE(o.encrypted ? 1 : 0, 8); c.writeUInt16LE(o.stored ? 0 : 8, 10);
    c.writeUInt32LE(crc32(data), 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(size, 24); c.writeUInt16LE(nameBuf.length, 28);
    if (o.symlink) c.writeUInt32LE((0o120777 << 16) >>> 0, 38);
    c.writeUInt32LE(offset, 42);
    centrals.push(c, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(list.length, 8); end.writeUInt16LE(list.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
