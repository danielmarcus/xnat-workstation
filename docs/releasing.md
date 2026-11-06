# Releasing

Building signed packages and publishing a release. Moved from the README (2026-11).

## GitHub Actions CI and releases

This repo can be managed through GitHub Actions in `.github/workflows/`:

- `ci.yml` runs the tiered checks on every pull request and the full checks on every push to `main` (CLAUDE.md, "Testing: what to run when").
- `release.yml` publishes release artifacts when you push a version tag like `v0.5.4`, after the full checks (`verify`), the evidence of the manual release checks (`release-evidence`) and the release owner's sign-off on the `release` environment.

Required GitHub Actions secrets:

- `MACOS_CERT_P12_BASE64` — base64-encoded Developer ID Application `.p12`
- `MACOS_CERT_PASSWORD` — password for the macOS signing certificate
- `APPLE_API_KEY_P8_BASE64` — base64-encoded App Store Connect API key `.p8`
- `APPLE_API_KEY_ID` — App Store Connect API key ID
- `APPLE_API_ISSUER` — App Store Connect issuer UUID
- `SM_API_KEY` — DigiCert KeyLocker API key for a service user
- `SM_CLIENT_CERT_FILE_B64` — base64-encoded DigiCert KeyLocker service-user client certificate `.p12`
- `SM_CLIENT_CERT_PASSWORD` — password for the DigiCert service-user client certificate
- `SM_CODE_SIGNING_CERT_SHA1_HASH` — Windows code-signing certificate thumbprint from DigiCert

Required GitHub Actions variables:

- `SM_HOST` — DigiCert ONE / KeyLocker environment URL

Optional GitHub Actions variables:

- `SM_KEYPAIR_ALIAS` — DigiCert keypair alias used for `smctl windows certsync`
- `WIN_CSC_SUBJECT_NAME` — fallback Windows certificate subject name if you prefer subject lookup over thumbprint

Recommended release flow:

1. Update the app version in `package.json` and `package-lock.json`.
2. Merge the release-ready PR into `main`.
3. On that commit, on a machine with a GPU and the test XNAT's `.env.e2e`, run `npm run release:check`; it posts the results of the manual suites to the commit.
4. Push a tag like `v0.5.4`, and approve the sign-off when `release.yml` asks.
5. Let `release.yml` publish the signed macOS release and Linux artifacts automatically.
6. Enable the Windows job once the DigiCert KeyLocker secrets and variables are configured.

## Windows packaging with DigiCert KeyLocker

Windows signing is handled in GitHub Actions on `windows-latest`; no local Windows machine is required.

The release workflow uses DigiCert's GitHub Action to install KeyLocker tooling, runs `smctl healthcheck`, syncs the certificate into the Windows user certificate store with `smctl windows certsync --keypair-alias=...`, and then packages the app with Electron Builder using the synced certificate thumbprint or subject name.

`npm run package:win` is intended for Windows CI or a Windows developer machine that already has the DigiCert KeyLocker environment configured. It expects:

- `SM_HOST`
- `SM_API_KEY`
- `SM_CLIENT_CERT_FILE`
- `SM_CLIENT_CERT_PASSWORD`
- `WIN_CSC_CERT_SHA1` or `WIN_CSC_SUBJECT_NAME`

The `.p7b` from DigiCert is not used directly by the build. With KeyLocker, the private key remains in DigiCert's service; the GitHub Actions Windows runner signs through DigiCert after the service-user client certificate and code-signing certificate thumbprint are configured.

## Signed macOS package (Developer ID)

To avoid Gatekeeper "unidentified developer" warnings, build with Apple signing + notarization credentials:

```bash
# Code signing certificate (.p12 exported from Keychain Access)
export CSC_LINK="/absolute/path/to/DeveloperIDApplication.p12"
export CSC_KEY_PASSWORD="your-p12-password"

# Notarization (recommended: App Store Connect API key)
export APPLE_API_KEY="/absolute/path/to/AuthKey_XXXXXX.p8"
export APPLE_API_KEY_ID="XXXXXX"
export APPLE_API_ISSUER="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

# Alternative notarization auth:
# export APPLE_ID="name@example.com"
# export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
# export APPLE_TEAM_ID="XXXXXXXXXX"

npm run package -- --mac
```

Quick validation after build:

```bash
codesign --verify --deep --strict --verbose=2 "release/mac/XNAT Workstation.app"
spctl -a -vv -t install "release/XNAT Workstation-*.dmg"
```

If `codesign` fails with `unable to build chain to self-signed root`, restore standard keychain search paths and remove custom trust overrides on `Developer ID Certification Authority`:

```bash
security list-keychains -d user -s \
  ~/Library/Keychains/login.keychain-db \
  /Library/Keychains/System.keychain \
  /System/Library/Keychains/SystemRootCertificates.keychain

security find-certificate -c "Developer ID Certification Authority" -p \
  /Library/Keychains/System.keychain > /tmp/dev-id-ca.pem
security remove-trusted-cert -d /tmp/dev-id-ca.pem
```
