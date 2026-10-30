// The main part (CommonJS: .cjs, so it stays CommonJS whatever package.json sits above it): it decides whether the extension is licensed, and holds the licence.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// The publisher's PUBLIC key, shipped with the extension. The private key never is.
const PUBLIC_KEY = fs.readFileSync(path.join(__dirname, 'public-key.pem'), 'utf8');

function verify(text) {
  const { licence, signature } = JSON.parse(text);
  const ok = crypto.verify(null, Buffer.from(JSON.stringify(licence)), PUBLIC_KEY, Buffer.from(signature, 'base64'));
  if (!ok) throw new Error('the signature does not match');
  return licence;
}

async function gate(ext) {
  const text = await ext.secureStorage.get('licence');
  if (!text) return { state: 'inactive', reason: 'No licence' };
  try {
    const licence = verify(text);
    if (new Date(licence.expires) < new Date()) return { state: 'inactive', reason: `Licence expired ${licence.expires}` };
    return { state: 'active', tier: licence.tier };
  } catch (err) {
    return { state: 'inactive', reason: `Invalid licence: ${err.message}` };
  }
}

module.exports = {
  activate(ext) {
    // The renderer part hands over a licence file's text; it is checked before it is kept.
    ext.channel.handle(async (message) => {
      if (message?.op !== 'install-licence') throw new Error('unknown request');
      verify(message.text);
      await ext.secureStorage.set('licence', message.text);
      await ext.gate.reevaluate();
      return 'installed';
    });
    return gate(ext);
  },
  evaluate: gate,
};
