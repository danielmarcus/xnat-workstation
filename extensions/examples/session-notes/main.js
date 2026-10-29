/**
 * Session notes — the main part (CommonJS), and its demonstration licence gate
 * (docs/extension-framework.md, design point 10).
 *
 * The gate shows the pattern a publisher builds on; the core holds no licence logic. A licence
 * is a JSON file `{ licence, signature }`: the licence names a licensee, a tier, its features,
 * an expiry date and, optionally, the XNAT server it is for; the signature is Ed25519 over the
 * licence. It is verified HERE, in the main part — the renderer part cannot enable its own
 * features — and kept in ext.secureStorage (the system keychain). The host asks again
 * (evaluate) on sign-in, sign-out and a change of server; importing a licence asks too.
 *
 * DEMONSTRATION ONLY: the key below is a throwaway, published with the example, and its private
 * half sits in e2e/ to sign test licences. A real extension keeps its private key off every
 * user's machine and out of every repository.
 */
const crypto = require('crypto');

const DEMO_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAXpMBn7TiRKznfUhjOG/N6r1NiP6lzCzBW1OXDbJsbu0=
-----END PUBLIC KEY-----`;

/** The signed form: the licence's fields in key order, so signing and checking agree. */
const canonical = (licence) => JSON.stringify(Object.keys(licence).sort().reduce((o, k) => ((o[k] = licence[k]), o), {}));

function verify(text) {
  let file;
  try { file = JSON.parse(text); } catch { throw new Error('it is not a licence file'); }
  if (!file || typeof file.licence !== 'object' || typeof file.signature !== 'string') throw new Error('it is not a licence file');
  const ok = crypto.verify(null, Buffer.from(canonical(file.licence)), DEMO_PUBLIC_KEY, Buffer.from(file.signature, 'base64'));
  if (!ok) throw new Error('its signature does not match');
  return file.licence;
}

const host = (url) => { try { return new URL(url).host; } catch { return String(url); } };
const sameServer = (a, b) => String(a).replace(/\/+$/, '').toLowerCase() === String(b).replace(/\/+$/, '').toLowerCase();

let ext = null;

/** The gate: the decision is this extension's own; the host only acts on it. */
async function gate(context) {
  const text = await context.secureStorage.get('licence');
  if (!text) return { state: 'inactive', reason: 'No licence. Import one in Settings › Extensions › Session notes.' };
  let licence;
  try { licence = verify(text); } catch (err) { return { state: 'inactive', reason: `The licence is not valid: ${err.message}` }; }
  const expires = new Date(`${licence.expires}T23:59:59Z`);
  if (!(expires.getTime() > Date.now())) return { state: 'inactive', reason: `Licence expired ${licence.expires}` };
  if (licence.server) {
    const user = await context.xnat.user();
    if (!user) return { state: 'inactive', reason: `Sign in to ${host(licence.server)} to use this licence` };
    if (!sameServer(user.serverUrl, licence.server)) return { state: 'inactive', reason: `No licence for this XNAT server (${host(user.serverUrl)})` };
  }
  return { state: 'active', tier: licence.tier, features: licence.features };
}

module.exports = {
  async activate(context) {
    ext = context;
    // The renderer part's Settings page reaches the licence through here.
    ext.channel.handle(async (message) => {
      if (message?.op === 'licence') {
        const text = await ext.secureStorage.get('licence');
        if (!text) return null;
        try { const l = verify(text); return { licensee: l.licensee, tier: l.tier, expires: l.expires, server: l.server ?? null }; } catch { return null; }
      }
      if (message?.op === 'install-licence') {
        verify(String(message.text)); // refused before it is kept
        await ext.secureStorage.set('licence', String(message.text));
        await ext.gate.reevaluate();
        return 'installed';
      }
      if (message?.op === 'remove-licence') {
        await ext.secureStorage.delete('licence');
        await ext.gate.reevaluate();
        return 'removed';
      }
      throw new Error(`Unknown request ${JSON.stringify(message)}`);
    });
    ext.log(`main part started (API ${ext.apiVersion})`);
    return gate(ext);
  },
  evaluate: gate,
  deactivate() {
    ext?.log('main part stopped');
    ext = null;
  },
};
