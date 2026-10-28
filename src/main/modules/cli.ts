/**
 * Module authoring tools (branch 9, M1): the same code the app verifies packages with.
 *
 *   npm run module:keygen -- <name> [--publisher "<publisher>"]   writes <name>.private.pem (keep secret) and <name>.public.json
 *   npm run module:pack   -- <dir> <out.xwmodule> [--key <private.pem>]
 *   npm run module:sign   -- <in.xwmodule> <out.xwmodule> --key <private.pem>
 *   npm run module:verify -- <in.xwmodule> [--trust <public.json> ...]
 *
 * A key's public.json is what users add as a trusted publisher (Settings › Modules); the
 * publisher's name in it is the name a Verified module is shown with. (`--signer` is still
 * accepted by pack and sign and written into signature.json, but the signature does not cover
 * it, so nothing shows it — #103.)
 */
import * as fs from 'fs';
import * as path from 'path';
import { readZip } from './zip';
import { generateKeyPair, packFiles, readPackage, signFiles } from './modulePackage';

function arg(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}
function all(args: string[], flag: string): string[] {
  return args.flatMap((a, i) => (a === flag && args[i + 1] ? [args[i + 1]] : []));
}

/** Every file under a directory, by its package path (forward slashes). */
function readDir(dir: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(d, e.name);
      if (e.isSymbolicLink()) throw new Error(`${full}: symbolic links cannot be packed`);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && !e.name.startsWith('.')) out.set(path.relative(dir, full).split(path.sep).join('/'), fs.readFileSync(full));
    }
  };
  walk(dir);
  return out;
}

export function runCli(argv: string[], log: (s: string) => void = console.log): number {
  const [cmd, ...args] = argv;
  try {
    if (cmd === 'keygen') {
      const name = args[0];
      if (!name) throw new Error('usage: keygen <name>');
      const k = generateKeyPair();
      fs.writeFileSync(`${name}.private.pem`, k.privateKeyPem, { mode: 0o600 });
      fs.writeFileSync(`${name}.public.json`, JSON.stringify({ keyId: k.keyId, publicKey: k.publicKey, name: arg(args, '--publisher') ?? name }, null, 2));
      log(`key ${k.keyId}: ${name}.private.pem (keep it secret) and ${name}.public.json (share it)`);
      return 0;
    }
    if (cmd === 'pack' || cmd === 'sign') {
      const [input, out] = args;
      if (!input || !out) throw new Error(`usage: ${cmd} <${cmd === 'pack' ? 'dir' : 'in.xwmodule'}> <out.xwmodule> ${cmd === 'sign' ? '--key <private.pem>' : '[--key <private.pem>]'}`);
      let files = cmd === 'pack' ? readDir(input) : readZip(fs.readFileSync(input));
      const key = arg(args, '--key');
      if (cmd === 'sign' && !key) throw new Error('sign needs --key');
      if (key) files = signFiles(files, fs.readFileSync(key, 'utf8'), arg(args, '--signer') ?? 'unknown');
      const buf = packFiles(files);
      const check = readPackage(buf, []);
      if (!check.ok) throw new Error(check.reason);
      fs.writeFileSync(out, buf);
      log(`${out}: ${check.manifest.id} ${check.manifest.version} — ${check.signature.status === 'valid' ? `signed by key ${check.signature.keyId}` : 'unsigned'}`);
      return 0;
    }
    if (cmd === 'verify') {
      const input = args[0];
      if (!input) throw new Error('usage: verify <in.xwmodule> [--trust <public.json> ...]');
      const trusted = all(args, '--trust').map((f) => {
        const k = JSON.parse(fs.readFileSync(f, 'utf8')) as { keyId: string; publicKey: string; name?: string };
        return { keyId: k.keyId, publicKey: k.publicKey, name: k.name || `Key ${k.keyId}` };
      });
      const r = readPackage(fs.readFileSync(input), trusted);
      if (!r.ok) { log(`REFUSED: ${r.reason}`); return 1; }
      log(`${r.manifest.id} ${r.manifest.version} (${r.manifest.runtime}, API ${r.manifest.apiVersion}) — ${r.tier.toUpperCase()}`);
      // The name is the trusted key's (from its public.json), never signature.json's unsigned text.
      log(r.signature.status === 'valid' ? `signed by key ${r.signature.keyId}${r.signature.signer ? ` (${r.signature.signer})` : ''}` : 'unsigned');
      return 0;
    }
    throw new Error('commands: keygen, pack, sign, verify');
  } catch (e) {
    log(`error: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

if (require.main === module) process.exit(runCli(process.argv.slice(2)));
