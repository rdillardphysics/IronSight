import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tauriDir = path.resolve(__dirname, '..', 'src-tauri');
const rootDir = path.resolve(__dirname, '..');

const [command, ...restArgs] = process.argv.slice(2);
if (!command) {
  console.error('Usage: node scripts/tauri.mjs <tauri-subcommand> [args...]');
  process.exit(2);
}

// Prefer running the package's JS entrypoint directly via `node`.
// This avoids npm-generated `.bin` shims which can be platform-specific (`.cmd` on Windows)
// or shell scripts (POSIX shim) that will break when executed with node.
const tauriPkgEntrypoint = path.resolve(
  rootDir,
  'node_modules',
  '@tauri-apps',
  'cli',
  'tauri.js'
);

// Legacy fallback: the npm `.bin` shim can exist and be useful on unix.
const tauriBinShim = path.resolve(rootDir, 'node_modules', '.bin', 'tauri');

let execFile;

const supportsConfig = command === 'dev' || command === 'build';
let args = supportsConfig
  ? [command, '--config', 'tauri.conf.json', ...restArgs]
  : [command, ...restArgs];

if (fs.existsSync(tauriPkgEntrypoint)) {
  execFile = process.execPath;
  args = [tauriPkgEntrypoint, ...args];
} else if (process.platform !== 'win32' && fs.existsSync(tauriBinShim)) {
  // On unix, the `.bin/tauri` shim is a node script so it's safe to execute.
  execFile = tauriBinShim;
} else {
  // Fallback to npx if deps aren't installed or entrypoint isn't found.
  execFile = 'npx';
  args = supportsConfig
    ? ['tauri', command, '--config', 'tauri.conf.json', ...restArgs]
    : ['tauri', command, ...restArgs];
}

if (process.env.CI === 'true') {
  console.log(`[tauri.mjs] cwd=${tauriDir}`);
  console.log(`[tauri.mjs] exec=${execFile}`);
}

const result = spawnSync(execFile, args, {
  cwd: tauriDir,
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error('[tauri.mjs] Failed to spawn Tauri CLI:', result.error);
  process.exit(1);
}

if (result.status == null) {
  console.error('[tauri.mjs] Tauri CLI exited without status', {
    signal: result.signal,
  });
  process.exit(1);
}

process.exit(result.status);
