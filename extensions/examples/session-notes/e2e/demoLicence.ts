/**
 * Demonstration licences for Session notes' gate, signed with the THROWAWAY demo key beside this
 * file (see main.js). Test-only: shared by this extension's own E2E and the core's.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export const BASIC = ['notes'];
export const PRO = ['notes', 'count', 'all-notes'];

const canonical = (licence: Record<string, unknown>) =>
  JSON.stringify(Object.keys(licence).sort().reduce<Record<string, unknown>>((o, k) => ((o[k] = licence[k]), o), {}));

export function demoLicence(fields: { tier: string; features: string[]; expires?: string; server?: string; licensee?: string }): string {
  const licence: Record<string, unknown> = { licensee: fields.licensee ?? 'Example Hospital', tier: fields.tier, features: fields.features, expires: fields.expires ?? '2099-12-31' };
  if (fields.server) licence.server = fields.server;
  const key = fs.readFileSync(path.join(__dirname, 'demo-licence-private-key.pem'), 'utf8');
  const signature = crypto.sign(null, Buffer.from(canonical(licence)), key).toString('base64');
  return JSON.stringify({ licence, signature }, null, 2);
}
