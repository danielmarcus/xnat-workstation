/**
 * Patch the Electron binary's Info.plist so macOS shows "XNAT Viewer"
 * in the menu bar and dock during development. This is only needed in
 * dev mode — electron-builder writes the correct name when packaging.
 *
 * Run via: node scripts/fix-dev-app-name.js
 * Or automatically via the "postinstall" npm script.
 */
const fs = require('fs');
const path = require('path');

const APP_NAME = 'XNAT Viewer';

const plistPath = path.join(
  __dirname, '..', 'node_modules', 'electron', 'dist',
  'Electron.app', 'Contents', 'Info.plist',
);

if (!fs.existsSync(plistPath)) {
  console.log('[fix-dev-app-name] Electron.app Info.plist not found — skipping');
  process.exit(0);
}

let plist = fs.readFileSync(plistPath, 'utf8');
let changed = false;

// Patch CFBundleName
const nameRe = /(<key>CFBundleName<\/key>\s*<string>)[^<]*(<\/string>)/;
if (nameRe.test(plist) && !plist.match(nameRe)[0].includes(APP_NAME)) {
  plist = plist.replace(nameRe, `$1${APP_NAME}$2`);
  changed = true;
}

// Patch CFBundleDisplayName (may not exist — add it after CFBundleName if missing)
const displayNameRe = /(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/;
if (displayNameRe.test(plist)) {
  if (!plist.match(displayNameRe)[0].includes(APP_NAME)) {
    plist = plist.replace(displayNameRe, `$1${APP_NAME}$2`);
    changed = true;
  }
} else {
  // Insert CFBundleDisplayName after CFBundleName
  plist = plist.replace(
    /(<key>CFBundleName<\/key>\s*<string>[^<]*<\/string>)/,
    `$1\n\t<key>CFBundleDisplayName</key>\n\t<string>${APP_NAME}</string>`,
  );
  changed = true;
}

if (changed) {
  fs.writeFileSync(plistPath, plist);
  console.log(`[fix-dev-app-name] Patched Info.plist: CFBundleName → "${APP_NAME}"`);
} else {
  console.log(`[fix-dev-app-name] Info.plist already has "${APP_NAME}" — no changes`);
}
