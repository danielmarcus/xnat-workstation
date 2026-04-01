#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const certificateSha1 =
  process.env.WIN_CSC_CERT_SHA1 || process.env.SM_CODE_SIGNING_CERT_SHA1_HASH;
const certificateSubjectName = process.env.WIN_CSC_SUBJECT_NAME;

if (process.platform !== 'win32') {
  console.error(
    'Windows packaging with DigiCert KeyLocker must run on a Windows machine or GitHub Actions windows-latest runner.',
  );
  process.exit(1);
}

if (!certificateSha1 && !certificateSubjectName) {
  console.error(
    'Missing WIN_CSC_CERT_SHA1 or WIN_CSC_SUBJECT_NAME. Configure a Windows certificate thumbprint or subject name before packaging.',
  );
  process.exit(1);
}

if (!process.env.SM_HOST || !process.env.SM_API_KEY || !process.env.SM_CLIENT_CERT_FILE || !process.env.SM_CLIENT_CERT_PASSWORD) {
  console.error(
    'Missing DigiCert KeyLocker environment. Expected SM_HOST, SM_API_KEY, SM_CLIENT_CERT_FILE, and SM_CLIENT_CERT_PASSWORD.',
  );
  process.exit(1);
}

const executable = path.join(
  process.cwd(),
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder',
);

const result = spawnSync(
  executable,
  ['--config', 'electron-builder.config.js', '--win', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: process.env,
  },
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
