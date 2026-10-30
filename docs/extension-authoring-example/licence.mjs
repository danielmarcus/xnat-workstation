// The publisher's tool — never shipped. `node licence.mjs key` makes a key pair (keep
// private-key.pem secret, outside any repository); `node licence.mjs sign <tier> <expires>`
// prints a signed licence file.
import * as crypto from 'crypto';
import * as fs from 'fs';

const [cmd, tier = 'Standard', expires = '2099-12-31'] = process.argv.slice(2);
if (cmd === 'key') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync('public-key.pem', publicKey.export({ type: 'spki', format: 'pem' }));
  fs.writeFileSync('private-key.pem', privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
} else if (cmd === 'sign') {
  const licence = { licensee: 'Example Hospital', tier, expires };
  const signature = crypto.sign(null, Buffer.from(JSON.stringify(licence)), fs.readFileSync('private-key.pem', 'utf8')).toString('base64');
  process.stdout.write(JSON.stringify({ licence, signature }));
} else {
  console.error('usage: node licence.mjs key | sign <tier> <expires>');
  process.exit(1);
}
