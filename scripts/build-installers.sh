#!/usr/bin/env bash
# Build helper: builds the frontend and creates platform installers via Tauri.
# Usage: ./scripts/build-installers.sh
# Note: run on the target platform (macOS for dmg, Windows for msi, Linux for appimage),
# or use appropriate cross-build toolchains. Some targets require additional tooling
# (e.g., signing, notarization on macOS).
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "Building frontend (vite)..."
npm run build

echo "Running Tauri build..."
cd src-tauri
# Ensure the TAURI_DIST_DIR/DEV_SERVER_URL aren't set in env; tauri build will use the config
cargo tauri build

echo "Build complete. Installer artifacts are in: src-tauri/target/release/bundle"
