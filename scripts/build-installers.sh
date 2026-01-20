#!/usr/bin/env bash
# Build helper: builds the frontend and creates platform installers via Tauri.
# Usage:
#   ./scripts/build-installers.sh             # build installer for current OS
#   ./scripts/build-installers.sh --target linux|macos|windows  # build installer for specific target (requires toolchain)
#   ./scripts/build-installers.sh --all     # attempt to build installers for all platforms (best-effort; use CI for reliability)
#
# NOTE: Building installers for a different OS than the one you are running on
# often requires additional toolchains (cross-compilers, Wine/NSIS for Windows,
# or macOS notarization tooling). The safe and recommended approach is to run
# this script on each target platform or use CI matrix runners.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

print_usage() {
	echo "Usage: $0 [--target linux|macos|windows] [--all]"
	echo "  --target <os>   Build installer for specified OS (may require additional toolchains)"
	echo "  --all           Attempt to build installers for all OSes (best-effort; use CI for reliability)"
	exit 1
}

TARGET_SPEC=""
BUILD_ALL=false
while [[ $# -gt 0 ]]; do
	case "$1" in
		--target)
			shift || print_usage
			TARGET_SPEC="$1"
			shift || true
			;;
		--all)
			BUILD_ALL=true
			shift || true
			;;
		-h|--help)
			print_usage
			;;
		*)
			echo "Unknown arg: $1" >&2
			print_usage
			;;
	esac
done

# Helper: determine host OS
detect_host() {
	local os
	case "$(uname -s)" in
		Darwin) os="macos" ;;
		Linux)  os="linux" ;;
		MINGW*|MSYS*|CYGWIN*|Windows_NT) os="windows" ;;
		*) os="unknown" ;;
	esac
	echo "$os"
}

HOST_OS=$(detect_host)
echo "Detected host OS: $HOST_OS"

if [[ "$BUILD_ALL" = true ]]; then
	echo "Building for all platforms is best done in CI. This script will attempt a best-effort build for each target, but some steps may fail locally due to missing toolchains."
fi

echo "Building frontend (vite)..."
npm run build

# Map logical target names to Rust target triples (used for cross builds).
map_target_triple() {
	case "$1" in
		linux) echo "x86_64-unknown-linux-gnu" ;;
		macos) echo "x86_64-apple-darwin" ;;
		windows) echo "x86_64-pc-windows-gnu" ;;
		*) echo "" ;;
	esac
}

run_tauri_build_for() {
	local tgt="$1"
	if [[ -z "$tgt" ]]; then
		echo "Skipping empty target" && return
	fi
	echo "\n=== Building installer for: $tgt ==="
	if [[ "$tgt" == "$HOST_OS" ]]; then
		# Host build (no explicit target triple)
		echo "Running: npm run tauri:build"
		npm run tauri:build
	else
		# Attempt cross-build using Rust --target if a mapping exists
		local triple
		triple=$(map_target_triple "$tgt")
		if [[ -z "$triple" ]]; then
			echo "No known Rust target triple for '$tgt'" && return
		fi
		# Check if the rust target is installed
		if ! rustup target list --installed | grep -q "^${triple}\$"; then
			echo "Rust target ${triple} not installed. Attempting to add it via rustup..."
			if ! rustup target add "${triple}"; then
				echo "Failed to add rust target ${triple}. Skipping $tgt build." && return
			fi
		fi
		echo "Running cross build: npm run tauri:build -- --target ${triple}"
		if ! npm run tauri:build -- --target "${triple}"; then
			echo "Cross-build for ${tgt} failed. See output above for details." && return
		fi
	fi
	echo "Artifacts for ${tgt} are in: target/release/bundle (or src-tauri/target/release/bundle depending on context)"
}

if [[ "$BUILD_ALL" = true ]]; then
	# Prefer to build host first, then attempt others
	run_tauri_build_for "$HOST_OS"
	for t in linux macos windows; do
		if [[ "$t" != "$HOST_OS" ]]; then run_tauri_build_for "$t"; fi
	done
	echo "All requested builds attempted. Use CI for reliable cross-platform builds."
	exit 0
fi

if [[ -n "$TARGET_SPEC" ]]; then
	# Validate target spec
	case "$TARGET_SPEC" in
		linux|macos|windows)
			run_tauri_build_for "$TARGET_SPEC"
			;;
		*)
			echo "Unknown --target value: $TARGET_SPEC" >&2; print_usage
			;;
	esac
	exit 0
fi

# Default: build for host OS
run_tauri_build_for "$HOST_OS"

echo "Build complete. Installer artifacts are in: src-tauri/target/release/bundle"
