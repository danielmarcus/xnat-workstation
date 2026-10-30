#!/usr/bin/env node
/**
 * Build the extension SDK, @nrgxnat/workstation-extension-api (docs/extension-framework.md,
 * design point 6), into packages/extension-api/dist/: ES modules and their type definitions.
 *
 * The SDK has no API source of its own: its modules re-export the app's
 * (src/shared/extensions/api.ts, manifest.ts), so the SDK cannot drift from what the app
 * implements. This copies those files beside the SDK's own into a build folder, points the
 * imports at the copies, and compiles the lot with tsc. The package's version must name the API
 * it describes: its major.minor is EXTENSION_API_VERSION.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = path.join(root, 'packages', 'extension-api');
const build = path.join(pkgDir, '.build');
const out = path.join(pkgDir, 'dist');

// The version names the API.
const api = fs.readFileSync(path.join(root, 'src', 'shared', 'extensions', 'manifest.ts'), 'utf8').match(/EXTENSION_API_VERSION = '(\d+\.\d+)'/)[1];
const { version } = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
if (!version.startsWith(`${api}.`)) {
  console.error(`[build-sdk] the package is ${version}, but the API it describes is ${api}: set its version to ${api}.x`);
  process.exit(1);
}

fs.rmSync(build, { recursive: true, force: true });
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(build, 'shared'), { recursive: true });
for (const f of ['api.ts', 'manifest.ts']) {
  fs.copyFileSync(path.join(root, 'src', 'shared', 'extensions', f), path.join(build, 'shared', f));
}
for (const f of fs.readdirSync(path.join(pkgDir, 'src')).filter((x) => x.endsWith('.ts'))) {
  const text = fs.readFileSync(path.join(pkgDir, 'src', f), 'utf8').replaceAll("'../../../src/shared/extensions/", "'./shared/");
  fs.writeFileSync(path.join(build, f), text);
}
fs.writeFileSync(path.join(build, 'tsconfig.json'), JSON.stringify({
  compilerOptions: {
    target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', strict: true, skipLibCheck: true,
    declaration: true, outDir: out, rootDir: '.', types: ['node'], typeRoots: [path.join(root, 'node_modules', '@types')],
    // react / @playwright/test types come from the core's node_modules while building.
    baseUrl: '.',
    paths: {
      '@playwright/test': [path.join(root, 'node_modules', '@playwright', 'test')],
      react: [path.join(root, 'node_modules', '@types', 'react')],
      'react/jsx-runtime': [path.join(root, 'node_modules', '@types', 'react', 'jsx-runtime')],
    },
  },
  include: ['*.ts', 'shared/*.ts'],
}, null, 2));
execFileSync(path.join(root, 'node_modules', '.bin', 'tsc'), ['-p', build], { stdio: 'inherit', cwd: root });

// ES modules: relative imports need their extension.
for (const f of fs.readdirSync(out, { recursive: true }).map(String).filter((x) => x.endsWith('.js'))) {
  const p = path.join(out, f);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/(from\s+['"])(\.\.?\/[^'"]+?)(['"])/g, (m, a, spec, b) => (spec.endsWith('.js') ? m : `${a}${spec}.js${b}`)));
}
fs.rmSync(build, { recursive: true, force: true });
console.log(`[build-sdk] @nrgxnat/workstation-extension-api ${version} (API ${api}) → ${path.relative(root, out)}`);
