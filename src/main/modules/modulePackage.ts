/**
 * Module packages (branch 9, M1 — docs/segworks-parity.md §12): a `.xwmodule` zip holding
 * manifest.json, the entry script, optional .wasm and other files, and an optional
 * signature.json.
 *
 * Signing: Ed25519 over the package's canonical digest — SHA-256 of the sorted list of
 * "<path>\0<sha256 of the file>\n" for every file except signature.json — so ANY changed, added
 * or removed file breaks the signature. A key is named by its id: the first 16 hex digits of the
 * SHA-256 of its public key (SPKI, DER).
 *
 * Trust (design point 2): Bundled (inside the app bundle — the app's own signature covers it),
 * Verified (a valid signature by a trusted key), Community (unsigned, or a valid signature by a
 * key the user has not trusted), Refused (an invalid signature, an invalid package, or one this
 * host cannot run). A trusted key is matched by its whole public key, not just its 64-bit id
 * (#103), and a Verified package names its publisher by the trusted key's own name: the
 * `signer` text in signature.json is outside what the signature covers.
 */
import * as crypto from 'crypto';
import { readZip, writeZip, ZipError } from './zip';
import { checkCompatibility, validateManifest, type ModuleManifest } from '../../shared/modules/manifest';

export const SIGNATURE_FILE = 'signature.json';
export const SIGNATURE_FORMAT = 'xnat-module-signature/1';

export type { ModuleTier, SignatureInfo } from '../../shared/modules/types';
import type { ModuleTier, SignatureInfo, TrustedKey } from '../../shared/modules/types';

export type PackageResult =
  | { ok: true; manifest: ModuleManifest; files: Map<string, Buffer>; digest: string; signature: SignatureInfo; tier: ModuleTier }
  | { ok: false; reason: string; manifest?: ModuleManifest };

const sha256 = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest();

/** The canonical digest every signature covers. */
export function canonicalDigest(files: Map<string, Buffer>): Buffer {
  const names = [...files.keys()].filter((n) => n !== SIGNATURE_FILE).sort();
  const h = crypto.createHash('sha256');
  for (const n of names) h.update(`${n}\0${sha256(files.get(n)!).toString('hex')}\n`);
  return h.digest();
}

export function keyIdOf(publicKeySpkiDer: Buffer): string {
  return sha256(publicKeySpkiDer).toString('hex').slice(0, 16);
}

export interface ModuleKeyPair {
  keyId: string;
  /** Base64 SPKI DER. */
  publicKey: string;
  /** PKCS#8 PEM — keep secret. */
  privateKeyPem: string;
}

export function generateKeyPair(): ModuleKeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  return {
    keyId: keyIdOf(spki),
    publicKey: spki.toString('base64'),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

/** Sign the files (any existing signature.json is replaced). */
export function signFiles(files: Map<string, Buffer>, privateKeyPem: string, signer: string): Map<string, Buffer> {
  const key = crypto.createPrivateKey(privateKeyPem);
  const spki = crypto.createPublicKey(key).export({ type: 'spki', format: 'der' });
  const unsigned = new Map([...files].filter(([n]) => n !== SIGNATURE_FILE));
  const signature = crypto.sign(null, canonicalDigest(unsigned), key);
  const sig = { format: SIGNATURE_FORMAT, algorithm: 'ed25519', keyId: keyIdOf(spki), publicKey: spki.toString('base64'), signer, signature: signature.toString('base64') };
  return new Map([...unsigned, [SIGNATURE_FILE, Buffer.from(JSON.stringify(sig, null, 2))]]);
}

/** Check a package's signature (not yet whether its key is trusted). */
export function verifySignature(files: Map<string, Buffer>): SignatureInfo {
  const raw = files.get(SIGNATURE_FILE);
  if (!raw) return { status: 'unsigned' };
  let sig: Record<string, unknown>;
  try {
    sig = JSON.parse(raw.toString('utf8'));
  } catch {
    return { status: 'invalid', reason: 'signature.json is not valid JSON' };
  }
  if (sig.format !== SIGNATURE_FORMAT || sig.algorithm !== 'ed25519' || typeof sig.publicKey !== 'string' || typeof sig.signature !== 'string') {
    return { status: 'invalid', reason: 'signature.json is not an xnat-module signature' };
  }
  let spki: Buffer;
  let key: crypto.KeyObject;
  try {
    spki = Buffer.from(sig.publicKey, 'base64');
    key = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });
  } catch {
    return { status: 'invalid', reason: 'the signing key cannot be read' };
  }
  const keyId = keyIdOf(spki);
  if (sig.keyId !== keyId) return { status: 'invalid', keyId, reason: 'the key id does not match the signing key' };
  const ok = crypto.verify(null, canonicalDigest(files), key, Buffer.from(sig.signature, 'base64'));
  // signature.json's `signer` is not read: it is not covered by the signature, so anyone could
  // write any name there. A Verified package is named by the trusted key's own name instead.
  return ok
    ? { status: 'valid', keyId, publicKey: sig.publicKey }
    : { status: 'invalid', keyId, reason: 'the files do not match the signature — the package was changed after it was signed' };
}

/** The trusted key that made a valid signature — the same key, not merely the same 64-bit id. */
export function trustedSigner(sig: SignatureInfo, trusted: readonly TrustedKey[]): TrustedKey | null {
  if (sig.status !== 'valid' || !sig.keyId || !sig.publicKey) return null;
  const spki = Buffer.from(sig.publicKey, 'base64');
  return trusted.find((k) => k.keyId === sig.keyId && Buffer.from(k.publicKey, 'base64').equals(spki)) ?? null;
}

/** The tier a signature earns, given the keys the app trusts. */
export function classify(sig: SignatureInfo, trusted: readonly TrustedKey[], bundled = false): ModuleTier | 'refused' {
  if (bundled) return 'bundled';
  if (sig.status === 'invalid') return 'refused';
  return trustedSigner(sig, trusted) ? 'verified' : 'community';
}

/** Read and check a package: format, manifest, entry, compatibility, signature, trust. */
export function readPackage(buf: Buffer, trusted: readonly TrustedKey[], opts: { bundled?: boolean } = {}): PackageResult {
  let files: Map<string, Buffer>;
  try {
    files = readZip(buf);
  } catch (e) {
    return { ok: false, reason: e instanceof ZipError ? `Not a valid module package: ${e.message}` : 'Not a valid module package' };
  }
  return checkFiles(files, trusted, opts);
}

/** The same checks on files already unpacked (an installed module, re-checked at every load). */
export function checkFiles(files: Map<string, Buffer>, trusted: readonly TrustedKey[], opts: { bundled?: boolean } = {}): PackageResult {
  const rawManifest = files.get('manifest.json');
  if (!rawManifest) return { ok: false, reason: 'The package has no manifest.json' };
  let json: unknown;
  try {
    json = JSON.parse(rawManifest.toString('utf8'));
  } catch {
    return { ok: false, reason: 'manifest.json is not valid JSON' };
  }
  const check = validateManifest(json);
  if (!check.ok) return { ok: false, reason: `The manifest is invalid: ${check.errors.join('; ')}` };
  const manifest = check.manifest;
  if (!files.has(manifest.entry)) return { ok: false, reason: `The entry script ${manifest.entry} is not in the package`, manifest };
  const compat = checkCompatibility(manifest);
  if (!compat.ok) return { ok: false, reason: `This module cannot run here: ${compat.reason}`, manifest };
  const signature = opts.bundled ? ({ status: 'unsigned' } as SignatureInfo) : verifySignature(files);
  const tier = classify(signature, trusted, opts.bundled);
  if (tier === 'refused') return { ok: false, reason: `The signature is invalid: ${signature.reason}`, manifest };
  if (tier === 'verified') signature.signer = trustedSigner(signature, trusted)!.name;
  return { ok: true, manifest, files, digest: canonicalDigest(files).toString('hex'), signature, tier };
}

/** Pack files into a package (authoring tools, tests). */
export function packFiles(files: Map<string, Buffer>): Buffer {
  return writeZip([...files.entries()].sort(([a], [b]) => (a === 'manifest.json' ? -1 : b === 'manifest.json' ? 1 : a.localeCompare(b))));
}
