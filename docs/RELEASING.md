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

## Create the tag

```bash
git tag v0.1.1
git push origin v0.1.1
```

## Manual releases

If needed, you can also run the workflow manually from the GitHub Actions UI: `Release` → `Run workflow`.
