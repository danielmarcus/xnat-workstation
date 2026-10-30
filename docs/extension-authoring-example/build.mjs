// Build the extension into out/hello-licensed/: the manifest, the main part, the public key, and
// the renderer part bundled with `react` aliased to the SDK's — the app's own React.
import { build } from 'esbuild';
import * as fs from 'fs';

const out = 'out/hello-licensed';
fs.rmSync('out', { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of ['extension.json', 'main.cjs', 'public-key.pem']) fs.copyFileSync(f, `${out}/${f}`);
await build({
  entryPoints: ['src/renderer.tsx'],
  outfile: `${out}/renderer.js`,
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', jsx: 'automatic',
  alias: {
    react: '@nrgxnat/workstation-extension-api/react',
    'react/jsx-runtime': '@nrgxnat/workstation-extension-api/jsx-runtime',
  },
});
console.log(`built ${out}`);
