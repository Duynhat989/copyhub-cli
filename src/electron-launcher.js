import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

export function getProjectRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), '..');
}

/** Path to electron.exe (Windows) / Electron (macOS) after npm postinstall download. */
export function resolveElectronBinary() {
  const root = getProjectRoot();
  const pathTxt = join(root, 'node_modules', 'electron', 'path.txt');
  if (!fs.existsSync(pathTxt)) return null;
  const rel = fs.readFileSync(pathTxt, 'utf8').trim();
  const abs = join(root, 'node_modules', 'electron', rel);
  if (!fs.existsSync(abs)) return null;
  return abs;
}

/**
 * Spawn the floating history overlay (Electron).
 * @param {{ stdio?: 'inherit' | 'ignore' | 'pipe', envExtra?: Record<string, string> }} [opts]
 */
export function spawnCopyhubOverlay(opts = {}) {
  const stdio = opts.stdio ?? 'inherit';
  const root = getProjectRoot();
  const uiMain = join(root, 'ui', 'main.mjs');
  const env = { ...process.env, ...opts.envExtra };
  const direct = resolveElectronBinary();
  if (direct) {
    return spawn(direct, [uiMain], {
      stdio,
      cwd: root,
      env,
      detached: false,
    });
  }
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return spawn(npx, ['--yes', 'electron', uiMain], {
    stdio,
    cwd: root,
    shell: true,
    env,
    detached: false,
  });
}
