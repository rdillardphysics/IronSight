<#
.SYNOPSIS
  Build helper for Windows: builds the frontend and creates platform installers via Tauri.

USAGE
  .\scripts\build-installers.ps1 [-Target linux|macos|windows] [-All]

Notes:
  - This script is a Windows-friendly wrapper around scripts/build-installers.sh.
  - For MSVC linking to work you should run this from a Developer Command Prompt
    (x64) or ensure Visual Studio Build Tools are installed and link.exe is on PATH.
#>

param(
    [string] $Target = "",
    [switch] $All,
    [switch] $Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Print-Usage {
    Write-Output "Usage: .\scripts\build-installers.ps1 [-Target linux|macos|windows] [-All]"
    exit 1
}

if ($Help) { Print-Usage }

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $Root "..")

function Detect-Host {
    return 'windows'
}

$HostOS = Detect-Host
Write-Output "Detected host OS: $HostOS"

function Ensure-Tool($exeName) {
    $cmd = Get-Command $exeName -ErrorAction SilentlyContinue
    return $null -ne $cmd
}

# Try to locate vswhere and run vcvarsall to populate MSVC environment variables in this PowerShell session.
function Ensure-MSVCEnv {
    if (Ensure-Tool 'link.exe') { return $true }

    $progFilesX86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
    $progFiles = [Environment]::GetEnvironmentVariable('ProgramFiles')
    $candidates = @()
    if ($progFilesX86) { $candidates += (Join-Path $progFilesX86 'Microsoft Visual Studio\Installer\vswhere.exe') }
    if ($progFiles) { $candidates += (Join-Path $progFiles 'Microsoft Visual Studio\Installer\vswhere.exe') }
    $vswhere = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $vswhere) { return $false }
    # First try: prefer MSVC toolset requirement
    $inst = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
    if ([string]::IsNullOrEmpty($inst)) {
        # Fallback: query installationPath without the -requires filter
        $inst = & $vswhere -latest -products * -property installationPath 2>$null
    }
    if (-not [string]::IsNullOrEmpty($inst)) {
        $vcvars = Join-Path $inst 'VC\Auxiliary\Build\vcvarsall.bat'
        if (Test-Path $vcvars) {
            Write-Output "Sourcing MSVC environment via: $vcvars (x64)"
            $envLines = cmd /c "call `"$vcvars`" x64 >nul && set"
            foreach ($line in ($envLines -split "`r?`n")) {
                if ($line -match '^(.*?)=(.*)$') {
                    $name = $matches[1]
                    $value = $matches[2]
                    Set-Item -Path Env:$name -Value $value
                }
            }
            if (Ensure-Tool 'link.exe') { return $true }
        }
    }

    # Final fallback: search Program Files for link.exe and add its directory to PATH
    $searchRoots = @()
    $pf = [Environment]::GetEnvironmentVariable('ProgramFiles')
    if ($pf) { $searchRoots += $pf }
    $pf86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
    if ($pf86) { $searchRoots += $pf86 }
    foreach ($root in $searchRoots) {
        try {
            $found = Get-ChildItem -Path $root -Filter link.exe -Recurse -ErrorAction SilentlyContinue -Force | Select-Object -First 1
            if ($found) {
                $dir = $found.DirectoryName
                Write-Output "Found link.exe at: $($found.FullName). Adding $dir to PATH."
                $env:Path = "$dir;$env:Path"
                return (Ensure-Tool 'link.exe')
            }
        }
        catch {
            # ignore access errors and continue
        }
    }

    return $false
}

# Check for presence of Windows SDK libraries (e.g. kernel32.lib)
function Test-WindowsSDK {
    $pf86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
    $roots = @()
    if ($pf86) { $roots += (Join-Path $pf86 'Windows Kits\10\Lib') }
    if ($pf86) { $roots += (Join-Path $pf86 'Windows Kits\8.1\Lib') }

    foreach ($root in $roots) {
        if (Test-Path $root) {
            try {
                $found = Get-ChildItem -Path $root -Filter kernel32.lib -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
                if ($found) { return $true }
            }
            catch {
                # ignore access errors and continue
            }
        }
    }

    return $false
}

# Locate Windows SDK lib directory containing kernel32.lib for x64
function Get-WindowsSDKLibDir {
    # First try registry-installed roots (works on x64 systems)
    $regPaths = @(
        'HKLM:\SOFTWARE\Microsoft\Windows Kits\Installed Roots',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows Kits\Installed Roots'
    )
    foreach ($r in $regPaths) {
        try {
            $props = Get-ItemProperty -Path $r -ErrorAction Stop
            if ($props.PSObject.Properties.Name -contains 'KitsRoot10') {
                $kitsRoot = $props.KitsRoot10
                if ($kitsRoot) {
                    $base10 = Join-Path $kitsRoot 'Lib'
                    if (Test-Path $base10) {
                        $vers = Get-ChildItem -Path $base10 -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending
                        foreach ($v in $vers) {
                            $candidate = Join-Path $v.FullName 'um\x64\kernel32.lib'
                            if (Test-Path $candidate) { return (Split-Path $candidate -Parent) }
                        }
                    }
                }
            }
            if ($props.PSObject.Properties.Name -contains 'KitsRoot81') {
                $kitsRoot8 = $props.KitsRoot81
                if ($kitsRoot8) {
                    $base8 = Join-Path $kitsRoot8 'Lib'
                    if (Test-Path $base8) {
                        $vers = Get-ChildItem -Path $base8 -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending
                        foreach ($v in $vers) {
                            $candidate = Join-Path $v.FullName 'um\x64\kernel32.lib'
                            if (Test-Path $candidate) { return (Split-Path $candidate -Parent) }
                        }
                    }
                }
            }
        }
        catch {
            # ignore and fall back to filesystem probing
        }
    }

    # Fallback: probe common Program Files locations
    $pf = [Environment]::GetEnvironmentVariable('ProgramFiles')
    $pf86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
    $roots = @()
    if ($pf) { $roots += $pf }
    if ($pf86) { $roots += $pf86 }

    foreach ($root in $roots) {
        # Windows Kits v10
        $base10 = Join-Path $root 'Windows Kits\10\Lib'
        if (Test-Path $base10) {
            $vers = Get-ChildItem -Path $base10 -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending
            foreach ($v in $vers) {
                $candidate = Join-Path $v.FullName 'um\x64\kernel32.lib'
                if (Test-Path $candidate) { return (Split-Path $candidate -Parent) }
            }
        }

        # Windows Kits 8.1
        $base8 = Join-Path $root 'Windows Kits\8.1\Lib'
        if (Test-Path $base8) {
            $vers = Get-ChildItem -Path $base8 -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending
            foreach ($v in $vers) {
                $candidate = Join-Path $v.FullName 'um\x64\kernel32.lib'
                if (Test-Path $candidate) { return (Split-Path $candidate -Parent) }
            }
        }
    }

    return $null
}

# Locate Windows SDK UCRT lib directory containing ucrt.lib for x64
function Get-WindowsSDKUcrtDir {
    $regPaths = @(
        'HKLM:\SOFTWARE\Microsoft\Windows Kits\Installed Roots',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows Kits\Installed Roots'
    )
    foreach ($r in $regPaths) {
        try {
            $props = Get-ItemProperty -Path $r -ErrorAction Stop
            if ($props.PSObject.Properties.Name -contains 'KitsRoot10') {
                $kitsRoot = $props.KitsRoot10
                if ($kitsRoot) {
                    $base10 = Join-Path $kitsRoot 'Lib'
                    if (Test-Path $base10) {
                        $vers = Get-ChildItem -Path $base10 -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending
                        foreach ($v in $vers) {
                            $candidate = Join-Path $v.FullName 'ucrt\x64\ucrt.lib'
                            if (Test-Path $candidate) { return (Split-Path $candidate -Parent) }
                        }
                    }
                }
            }
            if ($props.PSObject.Properties.Name -contains 'KitsRoot81') {
                $kitsRoot8 = $props.KitsRoot81
                if ($kitsRoot8) {
                    $base8 = Join-Path $kitsRoot8 'Lib'
                    if (Test-Path $base8) {
                        $vers = Get-ChildItem -Path $base8 -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending
                        foreach ($v in $vers) {
                            $candidate = Join-Path $v.FullName 'ucrt\x64\ucrt.lib'
                            if (Test-Path $candidate) { return (Split-Path $candidate -Parent) }
                        }
                    }
                }
            }
        }
        catch {
            # ignore and fall back
        }
    }

    # Fallback: probe common Program Files locations
    $pf = [Environment]::GetEnvironmentVariable('ProgramFiles')
    $pf86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
    $roots = @()
    if ($pf) { $roots += $pf }
    if ($pf86) { $roots += $pf86 }

    foreach ($root in $roots) {
        $base10 = Join-Path $root 'Windows Kits\10\Lib'
        if (Test-Path $base10) {
            $vers = Get-ChildItem -Path $base10 -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending
            foreach ($v in $vers) {
                $candidate = Join-Path $v.FullName 'ucrt\x64\ucrt.lib'
                if (Test-Path $candidate) { return (Split-Path $candidate -Parent) }
            }
        }
        $base8 = Join-Path $root 'Windows Kits\8.1\Lib'
        if (Test-Path $base8) {
            $vers = Get-ChildItem -Path $base8 -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending
            foreach ($v in $vers) {
                $candidate = Join-Path $v.FullName 'ucrt\x64\ucrt.lib'
                if (Test-Path $candidate) { return (Split-Path $candidate -Parent) }
            }
        }
    }

    return $null
}

# Locate Windows SDK include directories (ucrt, shared, um) for x64
function Get-WindowsSDKIncludeDirs {
    $dirs = @()
    $regPaths = @(
        'HKLM:\SOFTWARE\Microsoft\Windows Kits\Installed Roots',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows Kits\Installed Roots'
    )
    foreach ($r in $regPaths) {
        try {
            $props = Get-ItemProperty -Path $r -ErrorAction Stop
            if ($props.PSObject.Properties.Name -contains 'KitsRoot10') {
                $kitsRoot = $props.KitsRoot10
                if ($kitsRoot) {
                    $base = Join-Path $kitsRoot 'Include'
                    if (Test-Path $base) {
                        $vers = Get-ChildItem -Path $base -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending
                        foreach ($v in $vers) {
                            $cand = @(Join-Path $v.FullName 'ucrt'; Join-Path $v.FullName 'shared'; Join-Path $v.FullName 'um')
                            foreach ($c in $cand) { if (Test-Path $c) { $dirs += $c } }
                        }
                        if ($dirs.Count -gt 0) { return $dirs }
                    }
                }
            }
        }
        catch {
            # ignore
        }
    }

    # Fallback: probe common Program Files locations
    $pf = [Environment]::GetEnvironmentVariable('ProgramFiles')
    $pf86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
    $roots = @()
    if ($pf) { $roots += $pf }
    if ($pf86) { $roots += $pf86 }
    foreach ($root in $roots) {
        $base = Join-Path $root 'Windows Kits\10\Include'
        if (Test-Path $base) {
            $vers = Get-ChildItem -Path $base -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending
            foreach ($v in $vers) {
                $cand = @(Join-Path $v.FullName 'ucrt'; Join-Path $v.FullName 'shared'; Join-Path $v.FullName 'um')
                foreach ($c in $cand) { if (Test-Path $c) { $dirs += $c } }
            }
            if ($dirs.Count -gt 0) { return $dirs }
        }
    }

    return $dirs
}

if (-not (Ensure-Tool 'node') -or -not (Ensure-Tool 'npm')) {
    Write-Error "Node/npm not found on PATH. Install Node.js and try again."
    exit 1
}

Write-Output "Building frontend (vite)..."
npm run build

Write-Output "Ensuring Tauri icons exist..."
npm run tauri:prepare

function Map-TargetTriple($t) {
    switch ($t) {
        'linux' { return 'x86_64-unknown-linux-gnu' }
        'macos' { return 'x86_64-apple-darwin' }
        'windows' { return 'x86_64-pc-windows-msvc' }
        default { return '' }
    }
}

function Run-TauriBuildFor($tgt) {
    if ([string]::IsNullOrEmpty($tgt)) { Write-Output "Skipping empty target"; return }
    Write-Output "`n=== Building installer for: $tgt ==="

    if ($tgt -eq $HostOS) {
        # Check link.exe presence for MSVC builds; try to source vcvarsall if missing
        if (-not (Ensure-Tool 'link.exe')) {
            Write-Output "link.exe not found on PATH; attempting to configure MSVC environment..."
            if (Ensure-MSVCEnv) {
                Write-Output "MSVC environment configured and link.exe is now available."
            }
            else {
                Write-Warning "link.exe still not found. If you have Visual Studio Build Tools installed, run this from the 'x64 Native Tools Command Prompt' or run 'vcvarsall.bat' to set up the environment."
                Write-Warning "You can still try the build, but linking will likely fail for MSVC targets."
            }
        }
        # Ensure Windows SDK libraries exist (kernel32.lib and ucrt.lib are required for linking)
        $sdkLibDir = Get-WindowsSDKLibDir
        $ucrtLibDir = Get-WindowsSDKUcrtDir
        if (-not $sdkLibDir -and -not $ucrtLibDir) {
            Write-Error "Windows SDK libraries (for example kernel32.lib and/or ucrt.lib) were not found in the Windows Kits folders."
            Write-Error "Remedy: install the 'Windows 10 (or 11) SDK' via the Visual Studio Installer or Microsoft download, or run the 'x64 Native Tools Command Prompt' so LIB/INCLUDE are set."
            Write-Error "After installing or running the appropriate Developer Command Prompt, re-run this script."
            # Print quick diagnostics to help debugging
            Write-Output "--- Diagnostics: environment variables ---"
            Write-Output "LIB=$env:LIB"
            Write-Output "INCLUDE=$env:INCLUDE"
            Write-Output "PATH (last entries)=$(($env:Path -split ';') | Select-Object -Last 8 -Join ';')"
            exit 1
        }
        else {
            if ($sdkLibDir) { Write-Output "Found Windows SDK um lib folder: $sdkLibDir" }
            if ($ucrtLibDir) { Write-Output "Found Windows SDK ucrt lib folder: $ucrtLibDir" }
            if ($ucrtLibDir -and ($env:LIB -notlike "*$ucrtLibDir*")) {
                Write-Output "Prepending SDK ucrt lib folder to LIB for this PowerShell session."
                $env:LIB = "$ucrtLibDir;$env:LIB"
            }
            if ($sdkLibDir -and ($env:LIB -notlike "*$sdkLibDir*")) {
                Write-Output "Prepending SDK um lib folder to LIB for this PowerShell session."
                $env:LIB = "$sdkLibDir;$env:LIB"
            }

            # Ensure SDK include dirs are present so headers like windows.h can be found
            $includeDirs = Get-WindowsSDKIncludeDirs
            if ($includeDirs -and $includeDirs.Count -gt 0) {
                foreach ($inc in $includeDirs) {
                    if ($env:INCLUDE -notlike "*$inc*") {
                        Write-Output "Prepending SDK include folder to INCLUDE for this PowerShell session: $inc"
                        $env:INCLUDE = "$inc;$env:INCLUDE"
                    }
                }
            }
        }

        Write-Output "Running: npm run tauri:build"
        npm run tauri:build
    }
    else {
        $triple = Map-TargetTriple $tgt
        if ([string]::IsNullOrEmpty($triple)) { Write-Warning "No known Rust target triple for '$tgt'"; return }

        if (-not (Ensure-Tool 'rustup')) {
            Write-Error "rustup not found on PATH. Install Rust from https://rustup.rs and try again."; return
        }

        $installed = & rustup target list --installed 2>$null
        if ($installed -notmatch "^$triple$") {
            Write-Output "Rust target $triple not installed. Attempting to add it via rustup..."
            & rustup target add $triple
        }

        Write-Output "Running cross build: npm run tauri:build -- --target $triple"
        npm run tauri:build -- --target $triple
    }

    Write-Output "Artifacts for $tgt are in: target/release/bundle (or src-tauri/target/release/bundle depending on context)"
}

if ($All) {
    Run-TauriBuildFor $HostOS
    foreach ($t in @('linux', 'macos', 'windows')) {
        if ($t -ne $HostOS) { Run-TauriBuildFor $t }
    }
    Write-Output "All requested builds attempted. Use CI for reliable cross-platform builds."
    exit 0
}

if (-not [string]::IsNullOrEmpty($Target)) {
    if ($Target -in @('linux', 'macos', 'windows')) {
        Run-TauriBuildFor $Target
    }
    else {
        Write-Error "Unknown -Target value: $Target"; Print-Usage
    }
    exit 0
}

# Default: build for host
Run-TauriBuildFor $HostOS

Write-Output "Build complete. Installer artifacts are in: src-tauri/target/release/bundle"
