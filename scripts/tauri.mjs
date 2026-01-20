import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tauriDir = path.resolve(__dirname, '..', 'src-tauri');

const [command, ...restArgs] = process.argv.slice(2);
if (!command) {
  console.error('Usage: node scripts/tauri.mjs <dev|build> [args...]');
  process.exit(2);
}

const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const args = ['tauri', command, '--config', 'tauri.conf.json', ...restArgs];
const result = spawnSync(npxCmd, args, {
  cwd: tauriDir,
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 1);
