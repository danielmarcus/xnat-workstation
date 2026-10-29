const fs = require('fs');
const path = require('path');

// The edition being packaged (docs/editions.md): `npm run build:edition` (run by `npm run
// package`) writes it from edition.config.json, or from the configuration XNAT_EDITION names.
const editionFile = path.join(__dirname, 'build', 'edition', 'edition.json');
if (!fs.existsSync(editionFile)) {
  throw new Error('build/edition/edition.json is missing — run `npm run build:edition` (npm run package does) first');
}
const edition = JSON.parse(fs.readFileSync(editionFile, 'utf8'));

const windowsCertificateSha1 =
  process.env.WIN_CSC_CERT_SHA1 || process.env.SM_CODE_SIGNING_CERT_SHA1_HASH;
const windowsCertificateSubjectName = process.env.WIN_CSC_SUBJECT_NAME;

const win = {
  target: ['nsis', 'portable'],
};

if (windowsCertificateSha1 || windowsCertificateSubjectName) {
  win.signtoolOptions = {};

  if (windowsCertificateSha1) {
    win.signtoolOptions.certificateSha1 = windowsCertificateSha1;
  }

  if (windowsCertificateSubjectName) {
    win.signtoolOptions.certificateSubjectName = windowsCertificateSubjectName;
  }

  // KeyLocker signing is more reliable with explicit RFC 3161 + SHA-256 settings.
  win.signtoolOptions.rfc3161TimeStampServer = 'http://timestamp.digicert.com';
  win.signtoolOptions.timeStampServer = null;
  win.signtoolOptions.signingHashAlgorithms = ['sha256'];
}

module.exports = {
  appId: edition.appId,
  productName: edition.productName,
  extraMetadata: { productName: edition.productName },
  artifactName: `${edition.artifactPrefix}-\${version}-\${arch}.\${ext}`,
  directories: {
    buildResources: 'build',
    output: 'release',
  },
  // Another edition publishes where its configuration says — never to the open-source releases.
  publish: edition.publish ?? (edition.id === 'open-source'
    ? { provider: 'github', owner: 'danielmarcus', repo: 'xnat-workstation', releaseType: 'release' }
    : null),
  // Rollup's platform binary reaches the tree only through a dependency's packaging slip
  // (jpeg-lossless-decoder-js lists it as optional); the app never loads it.
  files: [
    'dist/**/*', 'package.json', '!**/node_modules/@rollup/**',
    // The edition's extensions go INSIDE the app archive, so the archive's integrity check
    // covers them (docs/extension-framework.md, design points 5 and 11).
    { from: 'build/edition/extensions', to: 'extensions', filter: ['**/*'] },
  ],
  extraResources: [
    {
      from: 'build/',
      to: 'build/',
      filter: ['*.png', '*.ico', '*.icns'],
    },
    // The licence and every third-party notice ship with the application.
    { from: 'LICENSE', to: 'licenses/LICENSE' },
    { from: 'THIRD-PARTY-NOTICES.txt', to: 'licenses/THIRD-PARTY-NOTICES.txt' },
    { from: 'node_modules/electron/dist/LICENSES.chromium.html', to: 'licenses/LICENSES.chromium.html' },
    // The edition: its record, and the modules it bundles (the Bundled tier) — inside the
    // signed application, covered by its signature.
    { from: 'build/edition/edition.json', to: 'edition.json' },
    { from: 'build/edition/modules', to: 'modules', filter: ['*.xwmodule'] },
  ],
  mac: {
    icon: 'build/icon.icns',
    target: ['dmg', 'zip'],
    category: 'public.app-category.medical',
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.inherit.plist',
    notarize: true,
  },
  win,
  nsis: {
    artifactName: `${edition.artifactPrefix}-\${version}-\${arch}-setup.\${ext}`,
  },
  portable: {
    artifactName: `${edition.artifactPrefix}-\${version}-\${arch}-portable.\${ext}`,
  },
  linux: {
    maintainer: 'Daniel Marcus <dmarcus@wustl.edu>',
    target: ['AppImage', 'deb'],
  },
};
