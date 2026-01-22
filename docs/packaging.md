# Packaging & Installers

This document explains how to produce platform installers for IronSight using Tauri.

Prerequisites
- Install Tauri CLI and toolchain (already present as devDependency):

  ```bash
  npm install
  npm run build
  # then from src-tauri/
  cd src-tauri
  cargo tauri build
  ```

- Platform requirements:
  - macOS: Xcode command-line tools; for `.dmg` and notarization you need an Apple Developer account to sign and notarize.
  - Windows: MSVC toolchain to build native binaries; optional code signing certificate for production MSI signing.
  - Linux: AppImage tooling is handled by Tauri; ensure required native libraries are available for target distributions.

Icons
- Place your app icons inside `src-tauri/icons/`.
- Tauri will look for `icons/icon.png` (preferably a 512x512 PNG). For best results provide platform-specific icons:
  - macOS: `icon.icns` (or a high-res PNG that can be converted)
  - Windows: `icon.ico`
  - Linux: PNGs (256x256, 512x512)

Signing & Notarization
- Production installers should be signed. See Tauri docs for platform-specific signing:
  - macOS notarization/signing: Apple Developer account + notarization step after building.
  - Windows code signing: EV code signing certificates and signtool.

Building
- Use the included helper script to build front-end and create installers:

  ```bash
  ./scripts/build-installers.sh
  ```

**Note**: Windows has a couple extra requirements:
  - Install the Visual Studio Installer
  - From the Workloads tab, under the Desktop and Mobile section:
    1. Desktop Development with C++
  - From the Individual Components tab, search for the following:
    2. Windows 11 SDK (any available should be fine)

- Use the included helper script to build front-end and create the Windows `.msi`:

  ```ps1
  .\scripts\build-installers.ps1
  ```
  
Artifacts
- After a successful build, installers and bundles are in:

  - `src-tauri/target/release/bundle/` (contains `dmg`, `msi`, `appimage` subfolders when built on the respective platforms)

Further reading
- Tauri packaging docs: https://tauri.app/v1/guides/distribution

If you want, I can:
- Add placeholder icons (simple PNG) into `src-tauri/icons/` so the bundles have a custom icon.
- Run the build locally in this environment (I can only modify files; I cannot execute your local toolchain for you). 
