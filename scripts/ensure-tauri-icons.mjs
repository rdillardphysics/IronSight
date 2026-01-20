import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pngToIco from 'png-to-ico';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const tauriDir = path.resolve(rootDir, 'src-tauri');

const iconsDir = path.resolve(tauriDir, 'icons');
const iconPng = path.resolve(iconsDir, 'icon.png');
const iconIco = path.resolve(iconsDir, 'icon.ico');

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

if (await exists(iconIco)) {
  process.exit(0);
}

if (!(await exists(iconPng))) {
  console.error(`[ensure-tauri-icons] Missing ${iconPng}. Cannot generate icon.ico`);
  process.exit(1);
}

const pngBuf = await fs.readFile(iconPng);
const icoBuf = await pngToIco([pngBuf]);
await fs.writeFile(iconIco, icoBuf);
console.log(`[ensure-tauri-icons] Generated ${path.relative(rootDir, iconIco)}`);
