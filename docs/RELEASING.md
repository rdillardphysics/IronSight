# Releasing IronSight

This repo uses tag-based releases.

## What happens on release

Pushing a tag like `v0.1.1` triggers the GitHub Actions workflow at `.github/workflows/release.yml`:

- Builds installers on `ubuntu-latest`, `windows-latest`, and `macos-latest`
- Publishes a GitHub Release for the tag
- Uploads bundled artifacts from `src-tauri/target/release/bundle/**`

## Before tagging

Bump versions in all of these files (they should match):

- `package.json` → `version`
- `src-tauri/Cargo.toml` → `[package].version`
- `src-tauri/tauri.conf.json` → `version`

Commit and push those version changes to `main`.

## macOS notarization (CI)

The macOS artifacts are codesigned and notarized in CI. Configure these repository secrets:

- `APPLE_ID` (Apple ID email)
- `APPLE_ID_PASSWORD` (app-specific password)
- `APPLE_TEAM_ID` (Team ID)
- `APPLE_CERTIFICATE` (base64-encoded .p12 Developer ID Application certificate)
- `APPLE_CERTIFICATE_PASSWORD` (password for the .p12)
- `APPLE_SIGNING_IDENTITY` (e.g., `Developer ID Application: Your Org (TEAMID)`)
- `APPLE_KEYCHAIN_PASSWORD` (temporary keychain password for CI)

Notes:

- Create a Developer ID Application certificate in the Apple Developer portal and export it as `.p12`.
- Base64-encode the `.p12` file and store it in `APPLE_CERTIFICATE`.
- Use an app-specific password for `APPLE_ID_PASSWORD`.

## Create the tag

```bash
git tag v0.1.1
git push origin v0.1.1
```

## Manual releases

If needed, you can also run the workflow manually from the GitHub Actions UI: `Release` → `Run workflow`.
