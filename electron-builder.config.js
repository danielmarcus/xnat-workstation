const windowsCertificateSha1 =
  process.env.WIN_CSC_CERT_SHA1 || process.env.SM_CODE_SIGNING_CERT_SHA1_HASH;
const windowsCertificateSubjectName = process.env.WIN_CSC_SUBJECT_NAME;

const win = {
  target: ['nsis', 'portable'],
};

if (windowsCertificateSha1) {
  win.certificateSha1 = windowsCertificateSha1;
}

if (windowsCertificateSubjectName) {
  win.certificateSubjectName = windowsCertificateSubjectName;
}

module.exports = {
  appId: 'com.xnat.workstation',
  productName: 'XNAT Workstation',
  artifactName: 'XNAT-Workstation-${version}-${arch}.${ext}',
  directories: {
    buildResources: 'build',
    output: 'release',
  },
  publish: {
    provider: 'github',
    owner: 'danielmarcus',
    repo: 'xnat-workstation',
    releaseType: 'release',
  },
  files: ['dist/**/*', 'package.json'],
  extraResources: [
    {
      from: 'build/',
      to: 'build/',
      filter: ['*.png', '*.ico', '*.icns'],
    },
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
  linux: {
    maintainer: 'Daniel Marcus <dmarcus@wustl.edu>',
    target: ['AppImage', 'deb'],
  },
};
