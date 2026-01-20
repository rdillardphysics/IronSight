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

// Prefer the locally installed Tauri CLI entrypoint to avoid PATH/npx resolution issues in CI.
// On Windows, do NOT spawn the `.cmd` shim directly (can fail under bash with EINVAL);
// instead run the JS shim via `node`.
const tauriJsShim = path.resolve(rootDir, 'node_modules', '.bin', 'tauri');
const tauriCmdShim = path.resolve(rootDir, 'node_modules', '.bin', 'tauri.cmd');

let execFile;

const supportsConfig = command === 'dev' || command === 'build';
let args = supportsConfig
  ? [command, '--config', 'tauri.conf.json', ...restArgs]
  : [command, ...restArgs];

// Fallback to npx if the local bin isn't present (e.g. deps not installed).
if (process.platform === 'win32') {
  if (fs.existsSync(tauriJsShim)) {
    execFile = process.execPath;
    args = [tauriJsShim, ...args];
  } else if (fs.existsSync(tauriCmdShim)) {
    // As a last resort, run the .cmd shim via cmd.exe.
    execFile = process.env.ComSpec || 'cmd.exe';
    const cmdLine = `"${tauriCmdShim}" ${args.map((a) => `"${a.replaceAll('"', '\\"')}"`).join(' ')}`;
    args = ['/d', '/s', '/c', cmdLine];
  } else {
    execFile = 'npx';
    args = supportsConfig
      ? ['tauri', command, '--config', 'tauri.conf.json', ...restArgs]
      : ['tauri', command, ...restArgs];
  }
} else if (fs.existsSync(tauriJsShim)) {
  execFile = tauriJsShim;
} else {
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
