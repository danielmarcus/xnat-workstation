/** Module types shared by the main process and the renderer (branch 9, M2). */
import type { ModuleManifest } from './manifest';

export type ModuleTier = 'bundled' | 'verified' | 'community';

export interface SignatureInfo {
  status: 'unsigned' | 'valid' | 'invalid';
  keyId?: string;
  /** Base64 SPKI DER of the signing key (valid signatures). */
  publicKey?: string;
  /** The publisher the signature names (informational; trust comes from the key). */
  signer?: string;
  reason?: string;
}

export interface TrustedKey {
  keyId: string;
  /** Base64 SPKI DER. */
  publicKey: string;
  /** The publisher's name, as the user saw it when trusting the key. */
  name: string;
}

export interface ModuleSettings {
  allowCommunity: boolean;
  trustedKeys: TrustedKey[];
  /** Enabled switch per module id (default on). */
  enabled: Record<string, boolean>;
}

/** What the UI shows about a module (installed, bundled, or about to be installed). */
export interface ModuleSummary {
  id: string;
  name: string;
  version: string;
  publisher: string;
  description: string;
  license: string;
  tier: ModuleTier;
  signature: SignatureInfo;
  reads: ModuleManifest['reads'];
  writes: ModuleManifest['writes'];
  bundled: boolean;
  enabled: boolean;
  /** The whole manifest — the operation a module becomes is built from it (M4). */
  manifest: ModuleManifest;
}

export type ModuleListing =
  | { status: 'ok'; summary: ModuleSummary }
  | { status: 'refused'; id: string; name?: string; reason: string; bundled: boolean };

/** A package the user picked, checked but not installed: install it by its token. */
export type ModuleInspection =
  | { ok: true; token: string; summary: ModuleSummary; installed: string | null; allowCommunity: boolean }
  | { ok: false; reason: string; canceled?: boolean };
